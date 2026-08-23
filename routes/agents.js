const express = require('express');
const router = express.Router();
const { FLEET_AGENTS } = require('../services/agentDirectory');
const { readRawConfig, writeRawConfig, parseAgentConfig, applyModelChangesToYaml } = require('../services/configManager');

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
  const { pc, profile } = req.params;
  const { model, provider, baseUrl, reasoningEffort } = req.body;

  if (!model) {
    return res.status(400).json({ success: false, error: 'O parâmetro "model" é obrigatório.' });
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

  // Aplica as alterações no YAML
  const newContent = applyModelChangesToYaml(readRes.content, {
    model,
    provider: provider || (model === 'grok-4.6' ? 'xai-oauth' : 'opencode-go'),
    baseUrl: baseUrl || (model === 'grok-4.6' ? 'https://api.x.ai/v1' : 'https://opencode.ai/zen/go/v1'),
    reasoningEffort: reasoningEffort || (model === 'ox-alpha-free' ? 'max' : 'medium')
  });

  // Grava com backup
  const writeRes = await writeRawConfig(agent.pc, agent.configPath, newContent);
  if (!writeRes.success) {
    return res.status(500).json({ success: false, error: `Falha ao gravar arquivo: ${writeRes.error}` });
  }

  res.json({
    success: true,
    message: `Modelo atualizado com sucesso para "${model}" (${reasoningEffort || 'max'}) no agente ${agent.name}`,
    agent: agent.id,
    backupPath: writeRes.backupPath
  });
});

/**
 * POST /api/agents/batch
 * Atualiza o modelo em lote por computador ou em toda a frota
 */
router.post('/batch', async (req, res) => {
  const { target, model, provider, baseUrl, reasoningEffort } = req.body;

  if (!model) {
    return res.status(400).json({ success: false, error: 'O parâmetro "model" é obrigatório.' });
  }

  const targetsToUpdate = FLEET_AGENTS.filter((a) => {
    if (!target || target === 'all') return true;
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

      const newContent = applyModelChangesToYaml(readRes.content, {
        model,
        provider: provider || (model === 'grok-4.6' ? 'xai-oauth' : 'opencode-go'),
        baseUrl: baseUrl || (model === 'grok-4.6' ? 'https://api.x.ai/v1' : 'https://opencode.ai/zen/go/v1'),
        reasoningEffort: reasoningEffort || (model === 'ox-alpha-free' ? 'max' : 'medium')
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
