const { exec } = require('child_process');

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

  // Sanitiza e formata para chamada SSH com BatchMode e ConnectTimeout
  const timeoutSec = Math.ceil((options.timeout || 15000) / 1000);
  const escapedCmd = cmd.replace(/"/g, '\\"');
  const sshCmd = `ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new ${host} "${escapedCmd}"`;

  return runLocalCommand(sshCmd, { ...options, timeout: (timeoutSec + 2) * 1000 });
}

/**
 * Testa conectividade SSH com um host
 */
async function probeHost(host) {
  if (host === 'server' || host === 'localhost') {
    return { online: true, latencyMs: 0 };
  }
  const start = Date.now();
  const res = await runLocalCommand(`ssh -o BatchMode=yes -o ConnectTimeout=4 ${host} "echo ok"`, { timeout: 6000 });
  const latencyMs = Date.now() - start;
  return {
    online: res.success && res.stdout.includes('ok'),
    latencyMs: res.success ? latencyMs : null,
    error: res.success ? null : res.error
  };
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
  if (host === 'server' || host === 'localhost' || host === 'server-desktop') {
    const busEnv = 'XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus';
    return runLocalCommand(`${busEnv} systemctl --user restart hermes-gateway.service`, { timeout: 60000 });
  }

  if (host === 'acer') {
    // Shell de login via SSH já injeta o bus; por segurança aponta o XDG_RUNTIME_DIR.
    const busEnv = 'XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus';
    return runOnHost('acer', `${busEnv} systemctl --user restart hermes-gateway.service`, { timeout: 60000 });
  }

  if (host === 'windows') {
    // PowerShell 5.1 não entende `&&`; envolve a cadeia em cmd /c.
    const winCmd = 'cmd /c "hermes gateway stop && schtasks /Run /TN HermesGateway"';
    return runOnHost('windows', winCmd, { timeout: 60000 });
  }

  return { success: false, error: 'Host desconhecido' };
}

module.exports = { runLocalCommand, runOnHost, probeHost, restartHermesGateway };
