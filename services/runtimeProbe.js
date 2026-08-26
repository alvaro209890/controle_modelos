const { runOnHost, psEncoded, shEncoded } = require('./sshRunner');

/**
 * Descobre, em UMA chamada por host, quando o gateway subiu e quando cada config.yaml foi
 * modificado pela última vez.
 *
 * Serve para responder a pergunta que o painel não sabia responder: "o modelo que está no
 * arquivo é o mesmo que o processo está usando?". Se o config foi salvo DEPOIS que o gateway
 * subiu, o Hermes ainda está rodando com a configuração antiga — o caso que fez o Álvaro
 * trocar o modelo do perfil geoforest e não ver mudança nenhuma.
 *
 * Complementa o `panelState` (que só enxerga gravações feitas pelo próprio painel): aqui
 * qualquer edição do arquivo conta, inclusive as feitas na mão por SSH.
 */

const CACHE_TTL = 15000;
const cache = new Map(); // pc -> { ts, data }

function parseLinux(stdout) {
  const out = { gatewayStartedAt: null, mtimes: {} };
  for (const line of (stdout || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('GW=')) {
      const secs = parseInt(t.slice(3), 10);
      out.gatewayStartedAt = Number.isFinite(secs) && secs > 0 ? secs * 1000 : null;
      continue;
    }
    const sep = t.lastIndexOf('|');
    if (sep > 0) {
      const file = t.slice(0, sep);
      const secs = parseInt(t.slice(sep + 1), 10);
      if (Number.isFinite(secs)) out.mtimes[file] = secs * 1000;
    }
  }
  return out;
}

async function probeLinux(pc, paths) {
  const quoted = paths.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ');
  const script = `
TS=$(systemctl --user show hermes-gateway.service -p ActiveEnterTimestamp --value 2>/dev/null)
EP=$(date -d "$TS" +%s 2>/dev/null || echo 0)
echo "GW=$EP"
stat -c '%n|%Y' ${quoted} 2>/dev/null
`;
  const res = await runOnHost(pc, shEncoded(script), { timeout: 20000 });
  if (!res.success && !res.stdout) return { gatewayStartedAt: null, mtimes: {} };
  return parseLinux(res.stdout);
}

async function probeWindows(paths) {
  const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
  const script = `
    $ErrorActionPreference = 'SilentlyContinue'
    $epoch = [datetime]'1970-01-01T00:00:00Z'
    $info = Get-ScheduledTask -TaskName 'HermesGateway' | Get-ScheduledTaskInfo
    if ($info -and $info.LastRunTime) {
      'GW=' + [int]((($info.LastRunTime).ToUniversalTime() - $epoch).TotalSeconds)
    } else { 'GW=0' }
    foreach ($p in @(${list})) {
      $f = Get-Item -LiteralPath $p
      if ($f) { $p + '|' + [int](($f.LastWriteTimeUtc - $epoch).TotalSeconds) }
    }
  `;
  const res = await runOnHost('windows', psEncoded(script), { timeout: 25000 });
  if (!res.success && !res.stdout) return { gatewayStartedAt: null, mtimes: {} };
  return parseLinux(res.stdout);
}

async function probeHostRuntime(pc, paths) {
  if (pc !== 'server') {
    const { probeHost } = require('./sshRunner');
    const probe = await probeHost(pc);
    if (!probe.online) {
      return { gatewayStartedAt: null, mtimes: {}, hostOffline: true, error: probe.error };
    }
  }

  const cached = cache.get(pc);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  let data;
  try {
    data = pc === 'windows' ? await probeWindows(paths) : await probeLinux(pc, paths);
  } catch (e) {
    console.error('runtimeProbe falhou em', pc, '->', e.message);
    data = { gatewayStartedAt: null, mtimes: {} };
  }
  cache.set(pc, { ts: Date.now(), data });
  return data;
}

function invalidate(pc) {
  if (pc) cache.delete(pc); else cache.clear();
}

module.exports = { probeHostRuntime, invalidate };
