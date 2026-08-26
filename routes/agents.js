const express = require('express');
const router = express.Router();
const { FLEET_AGENTS } = require('../services/agentDirectory');
const { readRawConfig, writeRawConfig, parseAgentConfig, applyModelChangesToYaml } = require('../services/configManager');
const { findModelPreset, findProviderById } = require('./models');
const { restartHermesGateway } = require('../services/sshRunner');
const panelState = require('../services/panelState');
const { probeHostRuntime, invalidate: invalidateRuntime } = require('../services/runtimeProbe');
const { safeIdentifier, safeModel, safeReasoning, safeBaseUrl, safePc, safeBatchTarget, safeBool } = require('../services/validation');

// Envolve handler async: sem isso, uma exceção dentro de um `await` some no Express 4 e a
// requisição fica pendurada até o navegador desistir.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function resolveModelDefaults(model, reasoningEffort, providerHint) {
  const preset = findModelPreset(model, providerHint);
  const effort = reasoningEffort || (preset ? preset.defaultReasoning : 'max');
  if (preset && !preset.allowedReasoning.includes(effort)) {
    return { error: 'O modelo "' + model + '" aceita apenas: ' + preset.allowedReasoning.join(', ') + '.' };
  }
  return {
    preset,
    reasoningEffort: effort,
    provider: preset ? preset.provider : 'opencode-go',
    baseUrl: preset ? preset.baseUrl : 'https://opencode.ai/zen/go/v1'
  };
}

// Valida a coerência entre provider e modelo se ambos forem informados
function validateProviderModel(provider, model) {
  if (!provider) return null;
  const providerDef = findProviderById(provider);
  if (!providerDef) return null; // provider fora do catálogo: passa (config manual)
  if (!providerDef.models.some((m) => m.id === model)) {
    const owner = findModelPreset(model);
    return owner
      ? 'O modelo "' + model + '" pertence ao provedor "' + owner.provider + '", não a "' + provider + '".'
      : 'O provedor "' + provider + '" não oferece o modelo "' + model + '".';
  }
  return null;
}

/**
 * Lê o corpo comum dos endpoints de troca de modelo e devolve os valores já validados.
 */
function readModelPayload(body) {
  const model = safeModel(body.model);
  if (!model) {
    return { error: 'O parâmetro "model" é obrigatório e inválido.' };
  }

  let providerHint = null;
  if (body.provider !== undefined && body.provider !== null && body.provider !== '') {
    providerHint = safeIdentifier(body.provider);
    if (!providerHint) return { error: 'Provider inválido.' };
  }

  let reasoningEffort = null;
  if (body.reasoningEffort !== undefined && body.reasoningEffort !== null && body.reasoningEffort !== '') {
    reasoningEffort = safeReasoning(body.reasoningEffort);
    if (!reasoningEffort) {
      return { error: 'Nível de reasoning inválido. Use: none, low, medium, high, max.' };
    }
  }

  const defaults = resolveModelDefaults(model, reasoningEffort, providerHint);
  if (defaults.error) return { error: defaults.error };

  const provider = providerHint || defaults.provider;

  const providerModelErr = validateProviderModel(provider, model);
  if (providerModelErr) return { error: providerModelErr };

  let baseUrl = defaults.baseUrl;
  if (body.baseUrl !== undefined && body.baseUrl !== null && body.baseUrl !== '') {
    baseUrl = safeBaseUrl(body.baseUrl);
    if (!baseUrl) return { error: 'Base URL inválida.' };
  }
  // Se o provider veio explícito e a baseUrl não, usa a do provider escolhido
  if (providerHint && (body.baseUrl === undefined || body.baseUrl === null || body.baseUrl === '')) {
    const pd = findProviderById(providerHint);
    if (pd) baseUrl = pd.baseUrl;
  }

  return {
    model,
    provider,
    baseUrl,
    reasoningEffort: defaults.reasoningEffort,
    preset: defaults.preset,
    restart: safeBool(body.restart, false)
  };
}

/**
 * Aplica a mudança em um agente: lê, edita, confere e grava.
 */
async function applyToAgent(agent, payload) {
  const readRes = await readRawConfig(agent.pc, agent.configPath);
  if (!readRes.success) {
    return { success: false, error: 'Falha ao ler configuração: ' + readRes.error };
  }

  const parsedOld = parseAgentConfig(readRes.content);
  const previousModel = parsedOld.success ? parsedOld.data.model : null;

  const result = applyModelChangesToYaml(readRes.content, {
    model: payload.model,
    provider: payload.provider,
    baseUrl: payload.baseUrl,
    reasoningEffort: payload.reasoningEffort,
    previousModel
  });

  // Nada de gravar um arquivo que não ficou com o que foi pedido — antes o painel respondia
  // "sucesso" mesmo quando o YAML saía intacto (chave ausente no arquivo).
  if (!result.ok || !result.content) {
    return { success: false, error: 'A edição do YAML não produziu o resultado esperado: ' + result.warnings.join('; ') };
  }

  if (!result.changed) {
    return { success: true, unchanged: true, previousModel, backupPath: null, inserted: [] };
  }

  const writeRes = await writeRawConfig(agent.pc, agent.configPath, result.content);
  if (!writeRes.success) {
    return { success: false, error: 'Falha ao gravar arquivo: ' + writeRes.error };
  }

  panelState.markWritten(agent.id);
  invalidateRuntime(agent.pc);
  return { success: true, unchanged: false, previousModel, backupPath: writeRes.backupPath, inserted: result.inserted };
}

/**
 * GET /api/agents
 * Retorna os 13 agentes com seus dados de configuração lidos em tempo real
 */
router.get('/', wrap(async (req, res) => {
  // Uma sondagem por host: quando o gateway subiu + mtime de cada config.yaml.
  const pcs = [...new Set(FLEET_AGENTS.map((a) => a.pc))];
  const runtimeByPc = {};
  await Promise.all(pcs.map(async (pc) => {
    const paths = FLEET_AGENTS.filter((a) => a.pc === pc).map((a) => a.configPath);
    runtimeByPc[pc] = await probeHostRuntime(pc, paths);
  }));

  const results = await Promise.all(
    FLEET_AGENTS.map(async (agent) => {
      const rt = runtimeByPc[agent.pc] || { gatewayStartedAt: null, mtimes: {} };
      const configMtime = rt.mtimes[agent.configPath] || null;
      // Pendente = arquivo mais novo que o processo em execução. O carimbo do próprio painel
      // (`panelState`) cobre o caso em que não dá para ler o horário de subida do gateway.
      const staleProcess = !!(configMtime && rt.gatewayStartedAt && configMtime > rt.gatewayStartedAt);
      const base = {
        ...agent,
        // O runtimeProbe e a verdade: quando da para ler a hora em que o gateway subiu, ela
        // decide sozinha. O carimbo do painel (panelState) so conhece os restarts feitos POR
        // AQUI \u2014 um `systemctl --user restart` na mao nunca o limpava, e o selo "pendente"
        // ficava aceso para sempre (server/geoforest, acompanhamento e wms em 2026-08-24:
        // config de 22:57:12, gateway de 22:57:17, ainda assim marcados como pendentes).
        pendingRestart: rt.gatewayStartedAt ? staleProcess : panelState.isPendingRestart(agent.id, agent.pc),
        configMtime,
        gatewayStartedAt: rt.gatewayStartedAt,
        lastWriteAt: panelState.getWrittenAt(agent.id) || configMtime,
        // Reinicio mais recente entre o que o painel fez e o que o host reporta
        lastRestartAt: Math.max(panelState.getRestartedAt(agent.pc) || 0, rt.gatewayStartedAt || 0) || null
      };

      const readRes = await readRawConfig(agent.pc, agent.configPath);
      if (!readRes.success) {
        return {
          ...base,
          online: false,
          hostOffline: !!readRes.hostOffline,
          error: readRes.error,
          model: null,
          provider: null,
          baseUrl: '',
          reasoningEffort: null,
          reasoningOverrides: {},
          delegation: {},
          missing: []
        };
      }

      const parsed = parseAgentConfig(readRes.content);
      if (!parsed.success) {
        return {
          ...base,
          online: true,
          error: 'Erro de parse YAML: ' + parsed.error,
          model: null,
          provider: null,
          baseUrl: '',
          reasoningEffort: null,
          reasoningOverrides: {},
          delegation: {},
          missing: []
        };
      }

      return {
        ...base,
        online: true,
        error: null,
        model: parsed.data.model,
        provider: parsed.data.provider,
        baseUrl: parsed.data.baseUrl,
        reasoningEffort: parsed.data.reasoningEffort,
        reasoningOverrides: parsed.data.reasoningOverrides,
        delegation: parsed.data.delegation,
        maxTurns: parsed.data.maxTurns,
        missing: parsed.data.missing
      };
    })
  );

  res.json({ success: true, count: results.length, agents: results });
}));

/**
 * POST /api/agents/:pc/:profile/model
 * Atualiza o modelo de um único agente. Com `restart: true`, reinicia o gateway do host —
 * o Hermes só lê o config.yaml na subida, então SEM reinício a troca fica só no arquivo.
 */
router.post('/:pc/:profile/model', wrap(async (req, res) => {
  const pc = safePc(req.params.pc);
  const profile = safeIdentifier(req.params.profile);

  if (!pc || !profile) {
    return res.status(400).json({ success: false, error: 'Parâmetros "pc" ou "profile" inválidos.' });
  }

  const payload = readModelPayload(req.body || {});
  if (payload.error) {
    return res.status(400).json({ success: false, error: payload.error });
  }

  if (payload.preset && payload.preset.availableOn && !payload.preset.availableOn.includes(pc)) {
    return res.status(400).json({
      success: false,
      error: 'O provedor "' + payload.preset.provider + '" não tem credencial (' + payload.preset.keyEnv + ') no PC "' + pc + '".'
    });
  }

  const agent = FLEET_AGENTS.find((a) => a.pc === pc && a.profile === profile);
  if (!agent) {
    return res.status(404).json({ success: false, error: 'Agente não encontrado: ' + pc + ' / ' + profile });
  }

  // Rastro no journal: sem ele, "cliquei e não mudou" não tem como ser investigado depois.
  console.log(`[modelo] ${pc}/${profile} <- ${payload.model} (${payload.reasoningEffort}) provider=${payload.provider} restart=${payload.restart}`);

  const applied = await applyToAgent(agent, payload);
  if (!applied.success) {
    console.log(`[modelo] ${pc}/${profile} FALHOU: ${applied.error}`);
    return res.status(500).json({ success: false, error: applied.error });
  }
  console.log(`[modelo] ${pc}/${profile} ok (${applied.unchanged ? 'sem alteração' : 'gravado, backup ' + applied.backupPath})`);

  let restart = null;
  if (payload.restart) {
    const r = await restartHermesGateway(agent.pc);
    if (r.success) panelState.markRestarted(agent.pc);
    invalidateRuntime(agent.pc);
    restart = { requested: true, success: !!r.success, output: r.stdout || r.stderr || r.error || '' };
  }

  const pending = panelState.isPendingRestart(agent.id, agent.pc);
  const baseMsg = applied.unchanged
    ? 'Configuração já estava em "' + payload.model + '" (' + payload.reasoningEffort + ') no agente ' + agent.name
    : 'Modelo gravado como "' + payload.model + '" (' + payload.reasoningEffort + ') no agente ' + agent.name;
  const tail = restart
    ? (restart.success ? ' — gateway reiniciado, já em vigor.' : ' — ATENÇÃO: o reinício do gateway falhou, a troca ainda não está em vigor.')
    : (pending ? ' — reinicie o gateway de ' + agent.pc + ' para entrar em vigor.' : '');

  res.json({
    success: true,
    message: baseMsg + tail,
    agent: agent.id,
    previousModel: applied.previousModel,
    unchanged: applied.unchanged,
    insertedKeys: applied.inserted,
    backupPath: applied.backupPath,
    restart,
    pendingRestart: pending
  });
}));

/**
 * POST /api/agents/batch
 * Atualiza o modelo em lote por computador ou em toda a frota
 */
router.post('/batch', wrap(async (req, res) => {
  const target = safeBatchTarget(req.body.target);
  if (!target) {
    return res.status(400).json({ success: false, error: 'Alvo inválido. Use: all, server, acer ou windows.' });
  }

  const payload = readModelPayload(req.body || {});
  if (payload.error) {
    return res.status(400).json({ success: false, error: payload.error });
  }

  const targetsToUpdate = FLEET_AGENTS.filter((a) => (target === 'all' ? true : a.pc === target));
  if (targetsToUpdate.length === 0) {
    return res.status(404).json({ success: false, error: 'Nenhum agente encontrado para o alvo especificado.' });
  }

  // Se o alvo inclui um PC sem a chave do provedor, impede a operação
  const affectedPCs = [...new Set(targetsToUpdate.map((a) => a.pc))];
  if (payload.preset && payload.preset.availableOn) {
    const missingPCs = affectedPCs.filter((pc) => !payload.preset.availableOn.includes(pc));
    if (missingPCs.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'O provedor "' + payload.preset.provider + '" não tem credencial (' + payload.preset.keyEnv + ') nos PCs: ' + missingPCs.join(', ') + '. Remova-os do alvo ou escolha outro modelo.'
      });
    }
  }

  const updates = [];
  const errors = [];

  for (const agent of targetsToUpdate) {
    try {
      const applied = await applyToAgent(agent, payload);
      if (!applied.success) {
        errors.push({ agent: agent.id, name: agent.name, error: applied.error });
      } else {
        updates.push({ agent: agent.id, name: agent.name, unchanged: applied.unchanged, backupPath: applied.backupPath });
      }
    } catch (e) {
      errors.push({ agent: agent.id, name: agent.name, error: e.message });
    }
  }

  // Reinício automático dos hosts que de fato receberam gravação
  const restarts = {};
  if (payload.restart && updates.length > 0) {
    const pcsToRestart = [...new Set(targetsToUpdate.filter((a) => updates.some((u) => u.agent === a.id)).map((a) => a.pc))];
    for (const pc of pcsToRestart) {
      const r = await restartHermesGateway(pc);
      if (r.success) panelState.markRestarted(pc);
      invalidateRuntime(pc);
      restarts[pc] = { success: !!r.success, output: r.stdout || r.stderr || r.error || '' };
    }
  }

  res.json({
    // `success` reflete "gravou em todos"; `updatedCount` mostra o parcial quando houve falha.
    success: errors.length === 0,
    partial: errors.length > 0 && updates.length > 0,
    totalAttempted: targetsToUpdate.length,
    updatedCount: updates.length,
    model: payload.model,
    reasoningEffort: payload.reasoningEffort,
    provider: payload.provider,
    updates,
    errors,
    restarts
  });
}));

module.exports = router;
