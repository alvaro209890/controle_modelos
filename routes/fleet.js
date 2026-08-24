const express = require('express');
const router = express.Router();
const { HOSTS_INFO } = require('../services/agentDirectory');
const { runOnHost, probeHost, gatewayStatus, restartHermesGateway } = require('../services/sshRunner');
const panelState = require('../services/panelState');
const { invalidate: invalidateRuntime } = require('../services/runtimeProbe');
const { safeIdentifier, safePc, safeBatchTarget } = require('../services/validation');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * GET /api/fleet/status
 * Verifica a saúde e conectividade dos 3 computadores e dos serviços gateway
 */
router.get('/status', wrap(async (req, res) => {
  const hostsStatus = {};

  await Promise.all(
    Object.keys(HOSTS_INFO).map(async (hostKey) => {
      const hostInfo = HOSTS_INFO[hostKey];
      const probe = await probeHost(hostKey);

      if (!probe.online) {
        hostsStatus[hostKey] = {
          ...hostInfo,
          online: false,
          gatewayRunning: false,
          gatewayDetail: null,
          latencyMs: null,
          lastRestartAt: panelState.getRestartedAt(hostKey),
          error: probe.error || 'Host inalcançável via SSH'
        };
        return;
      }

      const gw = await gatewayStatus(hostKey);

      hostsStatus[hostKey] = {
        ...hostInfo,
        online: true,
        gatewayRunning: gw.running,
        gatewayDetail: gw.detail,
        latencyMs: probe.latencyMs,
        lastRestartAt: panelState.getRestartedAt(hostKey),
        error: null
      };
    })
  );

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    domain: 'modelos.cursar.space',
    hosts: hostsStatus
  });
}));

/**
 * POST /api/fleet/restart/:pc
 * Reinicia o gateway Hermes no computador indicado ou em todos
 */
router.post('/restart/:pc', wrap(async (req, res) => {
  const pc = safeBatchTarget(req.params.pc);

  if (pc === 'all') {
    const results = {};
    for (const h of ['server', 'acer', 'windows']) {
      const r = await restartHermesGateway(h);
      if (r.success) panelState.markRestarted(h);
      invalidateRuntime(h);
      results[h] = { success: !!r.success, output: r.stdout || r.stderr || r.error || '' };
    }
    const okCount = Object.values(results).filter((r) => r.success).length;
    // Antes esta rota respondia `success: true` mesmo com os 3 hosts falhando.
    return res.status(okCount === 0 ? 500 : 200).json({
      success: okCount === 3,
      partial: okCount > 0 && okCount < 3,
      message: `Reinício concluído em ${okCount}/3 computadores`,
      results
    });
  }

  if (!pc || !HOSTS_INFO[pc]) {
    return res.status(400).json({ success: false, error: `Host inválido: ${req.params.pc}` });
  }

  const result = await restartHermesGateway(pc);
  if (result.success) panelState.markRestarted(pc);
  invalidateRuntime(pc);

  res.status(result.success ? 200 : 500).json({
    success: !!result.success,
    message: result.success ? `Gateway reiniciado com sucesso no host ${pc}` : `Falha ao reiniciar gateway no host ${pc}`,
    error: result.success ? null : (result.stderr || result.error || 'erro desconhecido'),
    details: result
  });
}));

/**
 * POST /api/fleet/test-provider
 * Executa testar-provider-perfil.py no host e perfil informados
 */
router.post('/test-provider', wrap(async (req, res) => {
  const pc = safePc(req.body.pc);
  const profile = safeIdentifier(req.body.profile);

  if (!pc || !profile) {
    return res.status(400).json({ success: false, error: 'Parâmetros "pc" e "profile" são obrigatórios.' });
  }

  let cmd = '';
  const targetProfile = profile === 'default' ? 'raiz' : profile;

  if (pc === 'server' || pc === 'acer') {
    cmd = `python3 ~/.hermes/scripts/testar-provider-perfil.py ${targetProfile}`;
  } else if (pc === 'windows') {
    cmd = `powershell -Command "& 'C:\\Users\\Usuario\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\python.exe' 'C:\\Users\\Usuario\\AppData\\Local\\hermes\\scripts\\testar-provider-perfil.py' ${targetProfile}"`;
  }

  const execRes = await runOnHost(pc, cmd, { timeout: 40000 });

  res.json({
    success: execRes.success,
    pc,
    profile,
    output: execRes.stdout || execRes.stderr || execRes.error || 'Nenhuma saída retornada.',
    durationMs: execRes.durationMs
  });
}));

/**
 * POST /api/fleet/heal/:pc
 * Dispara o script de cura checar-perfis no host
 */
router.post('/heal/:pc', wrap(async (req, res) => {
  const pc = safeBatchTarget(req.params.pc);
  if (!pc) {
    return res.status(400).json({ success: false, error: 'Host inválido' });
  }

  const LINUX = 'bash ~/.hermes/scripts/checar-perfis.sh';
  const WIN = 'powershell -ExecutionPolicy Bypass -File C:\\Users\\Usuario\\AppData\\Local\\hermes\\scripts\\checar-perfis.ps1';
  const cmdFor = (h) => (h === 'windows' ? WIN : LINUX);

  if (pc === 'all') {
    const results = {};
    await Promise.all(['server', 'acer', 'windows'].map(async (h) => {
      const r = await runOnHost(h, cmdFor(h), { timeout: 30000 });
      results[h] = { success: r.success, output: r.stdout || r.stderr || r.error || '' };
    }));
    const okCount = Object.values(results).filter((r) => r.success).length;
    return res.json({
      success: okCount === 3,
      partial: okCount > 0 && okCount < 3,
      message: `Cura executada em ${okCount}/3 computadores`,
      results
    });
  }

  const execRes = await runOnHost(pc, cmdFor(pc), { timeout: 30000 });
  res.json({
    success: execRes.success,
    pc,
    error: execRes.success ? null : (execRes.stderr || execRes.error),
    output: execRes.stdout || execRes.stderr || execRes.error || ''
  });
}));

/**
 * GET /api/fleet/logs/:pc
 * Obtém as últimas linhas de log do gateway
 */
router.get('/logs/:pc', wrap(async (req, res) => {
  const pc = safePc(req.params.pc);
  if (!pc) {
    return res.status(400).json({ success: false, error: 'Host inválido' });
  }

  const cmd = pc === 'windows'
    ? 'powershell -Command "if (Test-Path C:\\Users\\Usuario\\AppData\\Local\\hermes\\logs\\gateway.log) { Get-Content C:\\Users\\Usuario\\AppData\\Local\\hermes\\logs\\gateway.log -Tail 60 } else { echo \'Log não encontrado\' }"'
    : 'journalctl --user -u hermes-gateway.service -n 60 --no-pager';

  const execRes = await runOnHost(pc, cmd, { timeout: 20000 });
  res.json({
    success: execRes.success,
    pc,
    logs: execRes.stdout || execRes.stderr || execRes.error || 'Nenhum log retornado.'
  });
}));

module.exports = router;
