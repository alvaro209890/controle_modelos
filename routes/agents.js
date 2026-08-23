const express = require('express');
const router = express.Router();
const { FLEET_AGENTS } = require('../services/agentDirectory');
const { readRawConfig, writeRawConfig, parseAgentConfig, applyModelChangesToYaml } = require('../services/configManager');
const { MODEL_PRESETS } = require('./models');
const { safeIdentifier, safeModel, safeReasoning, safeBaseUrl, safePc, safeBatchTarget } = require('../services/validation');

function resolveModelDefaults(model, reasoningEffort) {
  const preset = MODEL_PRESETS.find((p) => p.id === model);
  const effort = reasoningEffort || (preset ? preset.defaultReasoning : 'max');
  if (preset && !preset.allowedReasoning.includes(effort)) {
    return { error: `O modelo "${model}" aceita apenas: ${preset.allowedReasoning.join(', ')}.` };
  }
  return {
    preset,
    reasoningEffort: effort,
    provider: preset ? preset.provider : (model === 'grok-4.6' ? 'xai-oauth' : 'opencode-go'),
    baseUrl: preset ? preset.baseUrl : (model === 'grok-4.6' ? 'https://api.x.ai/v1' : 'https://opencode.ai/zen/go/v1')
  };
}

/**
 * GET /api/agents
 * Retorna os 13 agentes com seus dados de configuração lidos em tempo real
 */
router.get('/', async (req, res) => {
  const results = await Promise.all(
    FLEET_AGENTS.map(async (agent) => {
      const readRes = await readRawConfig(agent.pc, agent.configPath);
      if (!readRes.success) {
        return {
          ...agent,
          online: false,
          error: readRes.error,
          model: 'indisponível',
          provider: 'indisponível',
          baseUrl: '',
          reasoningEffort: 'n/d',
          reasoningOverrides: {},
          delegation: {}
        };
      }

      const parsed = parseAgentConfig(readRes.content);
      if (!parsed.success) {
        return {
          ...agent,
          online: true,
          error: `Erro de parse YAML: ${parsed.error}`,
          model: 'indisponível',
          provider: 'indisponível',
          baseUrl: '',
          reasoningEffort: 'n/d',
          reasoningOverrides: {},
          delegation: {}
        };
      }

      return {
        ...agent,
        online: true,
        error: null,
        model: parsed.data.model,
        provider: parsed.data.provider,
        baseUrl: parsed.data.baseUrl,
        reasoningEffort: parsed.data.reasoningEffort,
        reasoningOverrides: parsed.data.reasoningOverrides,
        delegation: parsed.data.delegation,
        maxTurns: parsed.data.maxTurns
      };
    })
  );

  res.json({ success: true, count: results.length, agents: results });
});

/**
 * POST /api/agents/:pc/:profile/model
 * Atualiza o modelo de um único agente
 */
router.post('/:pc/:profile/model', async (req, res) => {
  const pc = safePc(req.params.pc);
  const profile = safeIdentifier(req.params.profile);

  if (!pc || !profile) {
    return res.status(400).json({ success: false, error: 'Parâmetros "pc" ou "profile" inválidos.' });
  }

  const model = safeModel(req.body.model);
  if (!model) {
    return res.status(400).json({ success: false, error: 'O parâmetro "model" é obrigatório e inválido.' });
  }

  let reasoningEffort = null;
  if (req.body.reasoningEffort !== undefined && req.body.reasoningEffort !== null && req.body.reasoningEffort !== '') {
    reasoningEffort = safeReasoning(req.body.reasoningEffort);
    if (!reasoningEffort) {
      return res.status(400).json({ success: false, error: 'Nível de reasoning inválido. Use: none, low, medium, high, max.' });
    }
  }

  const defaults = resolveModelDefaults(model, reasoningEffort);
  if (defaults.error) {
    return res.status(400).json({ success: false, error: defaults.error });
  }
  reasoningEffort = defaults.reasoningEffort;

  let provider = defaults.provider;
  if (req.body.provider !== undefined && req.body.provider !== null && req.body.provider !== '') {
    provider = safeIdentifier(req.body.provider);
    if (!provider) return res.status(400).json({ success: false, error: 'Provider inválido.' });
  }

  let baseUrl = defaults.baseUrl;
  if (req.body.baseUrl !== undefined && req.body.baseUrl !== null && req.body.baseUrl !== '') {
    baseUrl = safeBaseUrl(req.body.baseUrl);
    if (!baseUrl) return res.status(400).json({ success: false, error: 'Base URL inválida.' });
  }

  const agent = FLEET_AGENTS.find((a) => a.pc === pc && a.profile === profile);
  if (!agent) {
    return res.status(404).json({ success: false, error: `Agente não encontrado: ${pc} / ${profile}` });
  }

  // Lê o config atual
  const readRes = await readRawConfig(agent.pc, agent.configPath);
  if (!readRes.success) {
    return res.status(500).json({ success: false, error: `Falha ao ler configuração: ${readRes.error}` });
  }

  const parsedOld = parseAgentConfig(readRes.content);
  const previousModel = parsedOld.success ? parsedOld.data.model : null;

  // Aplica as alterações no YAML
  const newContent = applyModelChangesToYaml(readRes.content, {
    model,
    provider,
    baseUrl,
    reasoningEffort,
    previousModel
  });

  // Grava com backup
  const writeRes = await writeRawConfig(agent.pc, agent.configPath, newContent);
  if (!writeRes.success) {
    return res.status(500).json({ success: false, error: `Falha ao gravar arquivo: ${writeRes.error}` });
  }

  res.json({
    success: true,
    message: `Modelo atualizado com sucesso para "${model}" (${reasoningEffort}) no agente ${agent.name}`,
    agent: agent.id,
    backupPath: writeRes.backupPath
  });
});

/**
 * POST /api/agents/batch
 * Atualiza o modelo em lote por computador ou em toda a frota
 */
router.post('/batch', async (req, res) => {
  const model = safeModel(req.body.model);
  if (!model) {
    return res.status(400).json({ success: false, error: 'O parâmetro "model" é obrigatório e inválido.' });
  }

  const target = safeBatchTarget(req.body.target);
  if (!target) {
    return res.status(400).json({ success: false, error: 'Alvo inválido. Use: all, server, acer ou windows.' });
  }

  let reasoningEffort = null;
  if (req.body.reasoningEffort !== undefined && req.body.reasoningEffort !== null && req.body.reasoningEffort !== '') {
    reasoningEffort = safeReasoning(req.body.reasoningEffort);
    if (!reasoningEffort) {
      return res.status(400).json({ success: false, error: 'Nível de reasoning inválido. Use: none, low, medium, high, max.' });
    }
  }

  const defaults = resolveModelDefaults(model, reasoningEffort);
  if (defaults.error) {
    return res.status(400).json({ success: false, error: defaults.error });
  }
  reasoningEffort = defaults.reasoningEffort;

  let provider = defaults.provider;
  if (req.body.provider !== undefined && req.body.provider !== null && req.body.provider !== '') {
    provider = safeIdentifier(req.body.provider);
    if (!provider) return res.status(400).json({ success: false, error: 'Provider inválido.' });
  }

  let baseUrl = defaults.baseUrl;
  if (req.body.baseUrl !== undefined && req.body.baseUrl !== null && req.body.baseUrl !== '') {
    baseUrl = safeBaseUrl(req.body.baseUrl);
    if (!baseUrl) return res.status(400).json({ success: false, error: 'Base URL inválida.' });
  }

  const targetsToUpdate = FLEET_AGENTS.filter((a) => {
    if (target === 'all') return true;
    return a.pc === target;
  });

  if (targetsToUpdate.length === 0) {
    return res.status(404).json({ success: false, error: 'Nenhum agente encontrado para o alvo especificado.' });
  }

  const updates = [];
  const errors = [];

  for (const agent of targetsToUpdate) {
    try {
      const readRes = await readRawConfig(agent.pc, agent.configPath);
      if (!readRes.success) {
        errors.push({ agent: agent.id, error: readRes.error });
        continue;
      }

      const parsedOld = parseAgentConfig(readRes.content);
      const previousModel = parsedOld.success ? parsedOld.data.model : null;

      const newContent = applyModelChangesToYaml(readRes.content, {
        model,
        provider,
        baseUrl,
        reasoningEffort,
        previousModel
      });

      const writeRes = await writeRawConfig(agent.pc, agent.configPath, newContent);
      if (!writeRes.success) {
        errors.push({ agent: agent.id, error: writeRes.error });
      } else {
        updates.push({ agent: agent.id, name: agent.name, backupPath: writeRes.backupPath });
      }
    } catch (e) {
      errors.push({ agent: agent.id, error: e.message });
    }
  }

  res.json({
    success: errors.length === 0,
    totalAttempted: targetsToUpdate.length,
    updatedCount: updates.length,
    updates,
    errors
  });
});

module.exports = router;
