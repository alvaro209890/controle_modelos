const { exec } = require('child_process');
const os = require('os');
const path = require('path');

/**
 * Multiplexação de conexões SSH (2026-08-24).
 *
 * Um refresh do painel dispara ~15 comandos remotos (13 leituras de config + probes + status).
 * Sem ControlMaster, cada um abre um handshake SSH novo — era o que fazia a tela levar dezenas
 * de segundos para montar. Com ControlPersist, a primeira conexão de cada host é reaproveitada
 * pelas seguintes durante 60s.
 */
const CONTROL_DIR = path.join(os.tmpdir(), 'controle-modelos-ssh');
try { require('fs').mkdirSync(CONTROL_DIR, { recursive: true, mode: 0o700 }); } catch {}

const SSH_MUX = [
  '-o BatchMode=yes',
  '-o StrictHostKeyChecking=accept-new',
  '-o ControlMaster=auto',
  `-o ControlPath=${path.join(CONTROL_DIR, 'cm-%r@%h:%p')}`,
  '-o ControlPersist=60s'
].join(' ');

/**
 * Empacota um script PowerShell em -EncodedCommand (UTF-16LE + base64).
 * Evita que aspas simples/duplas do script sejam mastigadas pelo shell local e pelo SSH.
 */
function psEncoded(script) {
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  return `powershell -NoProfile -NonInteractive -EncodedCommand ${b64}`;
}

/**
 * Empacota um script sh em base64. O comando resultante só tem caracteres do alfabeto base64,
 * então atravessa intacto o `sh -c` local E o `ssh host "..."` remoto — sem precisar prever
 * quantas camadas de escape as aspas do script vão sofrer no caminho.
 */
function shEncoded(script) {
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return `echo ${b64} | base64 -d | sh`;
}

/**
 * Executa um comando no sistema local
 */
function runLocalCommand(cmd, options = {}) {
  return new Promise((resolve) => {
    const timeout = options.timeout || 15000;
    const startTime = Date.now();

    exec(cmd, { timeout, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      if (error) {
        return resolve({
          success: false,
          code: error.code || 1,
          timedOut: error.killed === true || error.signal === 'SIGTERM',
          error: error.message,
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim(),
          durationMs
        });
      }
      resolve({
        success: true,
        code: 0,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        durationMs
      });
    });
  });
}

/**
 * Executa um comando em um host específico (local se 'server', ou via SSH se 'acer'/'windows')
 */
async function runOnHost(host, cmd, options = {}) {
  if (host === 'server' || host === 'localhost' || host === 'server-desktop') {
    return runLocalCommand(cmd, options);
  }

  const totalTimeout = options.timeout || 15000;
  const connectTimeout = Math.max(4, Math.min(10, Math.floor(totalTimeout / 2000)));
  const escapedCmd = cmd.replace(/"/g, '\\"');
  const sshCmd = `ssh ${SSH_MUX} -o ConnectTimeout=${connectTimeout} ${host} "${escapedCmd}"`;

  return runLocalCommand(sshCmd, { ...options, timeout: totalTimeout + 2000 });
}

/**
 * Testa conectividade SSH com um host
 */
async function probeHost(host) {
  if (host === 'server' || host === 'localhost') {
    return { online: true, latencyMs: 0 };
  }
  const start = Date.now();
  const res = await runLocalCommand(`ssh ${SSH_MUX} -o ConnectTimeout=3 ${host} "echo ok"`, { timeout: 4000 });
  const latencyMs = Date.now() - start;
  return {
    online: res.success && res.stdout.includes('ok'),
    latencyMs: res.success ? latencyMs : null,
    error: res.success ? null : (res.stderr || res.error)
  };
}

/**
 * Verifica se o gateway Hermes está de pé no host.
 *
 * No Windows a checagem anterior era `tasklist | grep python.exe`: qualquer Python aberto
 * (ArcGIS, script solto, venv de outro projeto) marcava o gateway como ativo. Agora pergunta
 * ao Agendador de Tarefas pelo estado da tarefa `HermesGateway`, que é o que de fato sobe o
 * gateway naquela máquina.
 */
async function gatewayStatus(host) {
  if (host === 'server' || host === 'acer') {
    const check = await runOnHost(host, 'systemctl --user is-active hermes-gateway.service', { timeout: 12000 });
    const state = (check.stdout || '').trim();
    return { running: state === 'active', detail: state || (check.stderr || check.error || 'desconhecido') };
  }

  if (host === 'windows') {
    // -EncodedCommand evita a guerra de aspas entre bash local, SSH e PowerShell remoto.
    const script = `
      $task = Get-ScheduledTask -TaskName 'HermesGateway' -ErrorAction SilentlyContinue
      if ($task -and $task.State -eq 'Running') { 'running:tarefa HermesGateway'; exit }
      $procs = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
                 Where-Object { $_.CommandLine -like '*hermes*' })
      if ($procs.Count -gt 0) { 'running:' + $procs.Count + ' processo(s) hermes'; exit }
      if ($task) { 'stopped:tarefa ' + $task.State } else { 'stopped:tarefa HermesGateway ausente' }
    `;
    const check = await runOnHost('windows', psEncoded(script), { timeout: 20000 });
    const out = (check.stdout || '').trim();
    if (!out) return { running: false, detail: check.stderr || check.error || 'sem resposta' };
    const [state, ...rest] = out.split(':');
    return { running: state === 'running', detail: rest.join(':') || state };
  }

  return { running: false, detail: 'host desconhecido' };
}

/**
 * Reinicia o serviço de gateway Hermes em um host.
 *
 * Correções de robustez (2026-08-23):
 *  - server (local): o processo Node do painel roda como systemd --user service e NÃO herda
 *    DBUS_SESSION_BUS_ADDRESS/XDG_RUNTIME_DIR; sem eles `systemctl --user` falha com
 *    "Failed to connect to bus". Injeta as variáveis do bus do dono (uid efetivo) antes do comando.
 *  - windows: o shell padrão do Windows OpenSSH é PowerShell 5.1, que NÃO suporta o operador
 *    `&&` da cadeia original; a cadeia passa a ser envolta em `cmd /c "..."` para que o `cmd.exe`
 *    a interprete corretamente.
 *  - acer: já funcionava (shell de login via SSH seta o bus); mantém o comando, agora com o env
 *    padrão explícito por consistência.
 */
async function restartHermesGateway(host) {
  const busEnv = 'XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus';

  if (host === 'server' || host === 'localhost' || host === 'server-desktop') {
    return runLocalCommand(`${busEnv} systemctl --user restart hermes-gateway.service`, { timeout: 60000 });
  }

  if (host === 'acer') {
    // Shell de login via SSH já injeta o bus; por segurança aponta o XDG_RUNTIME_DIR.
    return runOnHost('acer', `${busEnv} systemctl --user restart hermes-gateway.service`, { timeout: 60000 });
  }

  if (host === 'windows') {
    // PowerShell 5.1 não entende `&&`; envolve a cadeia em cmd /c.
    const winCmd = 'cmd /c "hermes gateway stop && schtasks /Run /TN HermesGateway"';
    return runOnHost('windows', winCmd, { timeout: 60000 });
  }

  return { success: false, error: 'Host desconhecido' };
}

module.exports = { runLocalCommand, runOnHost, probeHost, gatewayStatus, restartHermesGateway, psEncoded, shEncoded };
