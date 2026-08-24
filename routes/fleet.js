const express = require('express');
const router = express.Router();
const { HOSTS_INFO } = require('../services/agentDirectory');
const { runOnHost, probeHost, restartHermesGateway } = require('../services/sshRunner');
const { safeIdentifier, safePc, safeBatchTarget } = require('../services/validation');

/**
 * GET /api/fleet/status
 * Verifica a saúde e conectividade dos 3 computadores e dos serviços gateway
 */
router.get('/status', async (req, res) => {
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
          latencyMs: null,
          error: probe.error || 'Host inalcançável via SSH'
        };
        return;
      }

      // Checa se o serviço gateway está rodando
      let gatewayRunning = false;
      if (hostKey === 'server') {
        const check = await runOnHost('server', 'systemctl --user is-active hermes-gateway.service');
        gatewayRunning = check.stdout.trim() === 'active';
      } else if (hostKey === 'acer') {
        const check = await runOnHost('acer', 'systemctl --user is-active hermes-gateway.service');
        gatewayRunning = check.stdout.trim() === 'active';
      } else if (hostKey === 'windows') {
        const check = await runOnHost('windows', 'tasklist /FI "IMAGENAME eq python.exe" /NH');
        gatewayRunning = check.stdout.toLowerCase().includes('python.exe');
      }

      hostsStatus[hostKey] = {
        ...hostInfo,
        online: true,
        gatewayRunning,
        latencyMs: probe.latencyMs,
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
});

/**
 * POST /api/fleet/restart/:pc
 * Reinicia o gateway Hermes no computador indicado ou em todos
 */
router.post('/restart/:pc', async (req, res) => {
  const pc = safeBatchTarget(req.params.pc);

  if (pc === 'all') {
    const results = {};
    for (const h of ['server', 'acer', 'windows']) {
      results[h] = await restartHostGateway(h);
    }
    return res.json({ success: true, message: 'Reinício disparado em todos os hosts', results });
  }

  if (!HOSTS_INFO[pc]) {
    return res.status(400).json({ success: false, error: `Host inválido: ${pc}` });
  }

  const result = await restartHostGateway(pc);
  res.json({
    success: result.success,
    message: result.success ? `Gateway reiniciado com sucesso no host ${pc}` : `Falha ao reiniciar gateway no host ${pc}`,
    details: result
  });
});

async function restartHostGateway(host) {
  return restartHermesGateway(host);
}

/**
 * POST /api/fleet/test-provider
 * Executa testar-provider-perfil.py no host e perfil informados
 */
router.post('/test-provider', async (req, res) => {
  const pc = safePc(req.body.pc);
  const profile = safeIdentifier(req.body.profile);

  if (!pc || !profile) {
    return res.status(400).json({ success: false, error: 'Parâmetros "pc" e "profile" são obrigatórios.' });
  }

  let cmd = '';
  const targetProfile = profile === 'default' ? 'raiz' : profile;

  if (pc === 'server') {
    cmd = `python3 ~/.hermes/scripts/testar-provider-perfil.py ${targetProfile}`;
  } else if (pc === 'acer') {
    cmd = `python3 ~/.hermes/scripts/testar-provider-perfil.py ${targetProfile}`;
  } else if (pc === 'windows') {
    cmd = `powershell -Command "& 'C:\\Users\\Usuario\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\python.exe' 'C:\\Users\\Usuario\\AppData\\Local\\hermes\\scripts\\testar-provider-perfil.py' ${targetProfile}"`;
  }

  const execRes = await runOnHost(pc, cmd, { timeout: 25000 });

  res.json({
    success: execRes.success,
    pc,
    profile,
    output: execRes.stdout || execRes.stderr || execRes.error,
    durationMs: execRes.durationMs
  });
});

/**
 * POST /api/fleet/heal/:pc
 * Dispara o script de cura checar-perfis no host
 */
router.post('/heal/:pc', async (req, res) => {
  const pc = safeBatchTarget(req.params.pc);
  if (!pc) {
    return res.status(400).json({ success: false, error: 'Host inválido' });
  }

  let cmd = '';
  if (pc === 'server' || pc === 'acer') {
    cmd = 'bash ~/.hermes/scripts/checar-perfis.sh';
  } else if (pc === 'windows') {
    cmd = 'powershell -ExecutionPolicy Bypass -File C:\\Users\\Usuario\\AppData\\Local\\hermes\\scripts\\checar-perfis.ps1';
  } else if (pc === 'all') {
    const rServer = await runOnHost('server', 'bash ~/.hermes/scripts/checar-perfis.sh');
    const rAcer = await runOnHost('acer', 'bash ~/.hermes/scripts/checar-perfis.sh');
    const rWin = await runOnHost('windows', 'powershell -ExecutionPolicy Bypass -File C:\\Users\\Usuario\\AppData\\Local\\hermes\\scripts\\checar-perfis.ps1');
    return res.json({
      success: true,
      message: 'Cura disparada em toda a frota',
      results: { server: rServer.stdout, acer: rAcer.stdout, windows: rWin.stdout }
    });
  } else {
    return res.status(400).json({ success: false, error: 'Host inválido' });
  }

  const execRes = await runOnHost(pc, cmd, { timeout: 20000 });
  res.json({
    success: execRes.success,
    pc,
    output: execRes.stdout || execRes.stderr
  });
});

/**
 * GET /api/fleet/logs/:pc
 * Obtém as últimas 50 linhas de log do gateway
 */
router.get('/logs/:pc', async (req, res) => {
  const { pc } = req.params;

  let cmd = '';
  if (pc === 'server') {
    cmd = 'journalctl --user -u hermes-gateway.service -n 60 --no-pager';
  } else if (pc === 'acer') {
    cmd = 'journalctl --user -u hermes-gateway.service -n 60 --no-pager';
  } else if (pc === 'windows') {
    cmd = 'powershell -Command "if (Test-Path C:\\Users\\Usuario\\AppData\\Local\\hermes\\logs\\gateway.log) { Get-Content C:\\Users\\Usuario\\AppData\\Local\\hermes\\logs\\gateway.log -Tail 60 } else { echo \'Log não encontrado\' }"';
  } else {
    return res.status(400).json({ success: false, error: 'Host inválido' });
  }

  const execRes = await runOnHost(pc, cmd, { timeout: 15000 });
  res.json({
    success: execRes.success,
    pc,
    logs: execRes.stdout || execRes.stderr || 'Nenhum log retornado.'
  });
});

module.exports = router;
