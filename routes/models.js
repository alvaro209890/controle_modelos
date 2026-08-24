const express = require('express');
const router = express.Router();

/**
 * CATÁLOGO HIERÁRQUICO: Provider → Model → (allowedReasoning, defaultReasoning)
 *
 * Fiel às credenciais que EXISTEM em cada PC (verificado ao vivo em 2026-08-23):
 *   - opencode-go       → OPENCODE_GO_API_KEY nos 3 PCs (server, acer, windows)
 *   - xai-oauth         → sessão SuperGrok / XAI_API_KEY em server e acer
 *   - deepseek-standard → DEEPSEEK_API_KEY nos 3 PCs
 *   - openrouter        → OPENROUTER_API_KEY em server e acer
 *
 * Modelos opencode-go SÃO TODOS os 29 que o relay lista em GET /models
 * (2026-08-23). O reasoning de cada um segue a família que o plugin
 * `opencode-zen` (Hermes) mapeia:
 *   - hy3            → none|low|high
 *   - ox-alpha       → low|high|max   (não desligável)
 *   - glm-5.2        → high|max       (knob nativo 2 níveis)
 *   - kimi-k2*       → low|medium|high (thinking toggle)
 *   - deepseek-v4*   → none..max      (thinking toggle)
 *   - outros         → full (relay decide; reasoning não injetado pelo plugin)
 *
 * Modelos openrouter: curados — SÓ os bons e baratos para código, preços reais
 * da API oficial (USD/M tokens, 2026-08-23).
 *
 * `availableOn` controla quais PCs são elegíveis a cada provedor no frontend,
 * impedindo de setar um modelo de um provedor sem chave naquela máquina.
 */

const OP = 'https://opencode.ai/zen/go/v1';

const opencodeGoModels = [
  // família hy3 (none|low|high)
  { id: 'hy3', name: 'Hy3 (OpenCode Go)', allowedReasoning: ['none', 'low', 'high'], defaultReasoning: 'high', badge: '8x Cota Go', requiresPatch: false, family: 'hy3', description: 'Alto raciocínio matemático e código. Consome 8x da cota no plano OpenCode Go.' },
  { id: 'hy3-preview', name: 'Hy3 Preview', allowedReasoning: ['none', 'low', 'high'], defaultReasoning: 'high', badge: 'Preview', requiresPatch: false, family: 'hy3', description: 'Prévia do Hy3. Reasoning none|low|high.' },

  // família ox-alpha (low|high|max)
  { id: 'ox-alpha-free', name: 'Ox Alpha Free', allowedReasoning: ['low', 'high', 'max'], defaultReasoning: 'max', badge: 'Grátis & Ilimitado', requiresPatch: true, family: 'ox-alpha', description: 'Modelo gratuito sem limite de tokens via OpenCode Go. Aceita apenas low, high e max.' },

  // família glm-5.2 (high|max)
  { id: 'glm-5.2', name: 'GLM-5.2 (OpenCode Go)', allowedReasoning: ['high', 'max'], defaultReasoning: 'high', badge: 'GLM', requiresPatch: false, family: 'glm-5.2', description: 'Knob nativo de reasoning com 2 níveis: high e max.' },

  // família kimi-k2 (low|medium|high)
  { id: 'kimi-k2.5', name: 'Kimi K2.5', allowedReasoning: ['low', 'medium', 'high'], defaultReasoning: 'high', badge: 'Kimi', requiresPatch: false, family: 'kimi-k2', description: 'Código e matemática. Thinking toggle + reasoning low|medium|high.' },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', allowedReasoning: ['low', 'medium', 'high'], defaultReasoning: 'high', badge: 'Kimi', requiresPatch: false, family: 'kimi-k2', description: 'Evolução do K2.5. Reasoning low|medium|high.' },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', allowedReasoning: ['low', 'medium', 'high'], defaultReasoning: 'high', badge: 'Kimi Code', requiresPatch: false, family: 'kimi-k2', description: 'Variante voltada a código. Reasoning low|medium|high.' },

  // família deepseek thinking (none..max)
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'high', badge: 'DeepSeek', requiresPatch: false, family: 'deepseek', description: 'Modelo oficial de alto raciocínio. Thinking toggle + reasoning completo.' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'Rápido & Estável', requiresPatch: false, family: 'deepseek', description: 'Excelente equilíbrio de velocidade e raciocínio para uso geral e automações.' },
  { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'Visão', requiresPatch: false, family: 'deepseek', description: 'Variante com visão (também usada como auxiliary vision da frota).' },

  // outros (sem tratamento específico no plugin → reasoning full, relay decide)
  { id: 'glm-5', name: 'GLM-5', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'GLM', requiresPatch: false, family: null, description: 'Modelo geral GLM. Reasoning não injetado pelo plugin (relay usa default).' },
  { id: 'glm-5.1', name: 'GLM-5.1', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'GLM', requiresPatch: false, family: null, description: 'Modelo geral GLM. Reasoning não injetado pelo plugin (relay usa default).' },
  { id: 'glm-5.3', name: 'GLM-5.3', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'GLM', requiresPatch: false, family: null, description: 'Modelo geral GLM mais recente. Reasoning não injetado pelo plugin (relay usa default).' },
  { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'Qwen', requiresPatch: false, family: null, description: 'Modelo geral Qwen. Reasoning não injetado pelo plugin.' },
  { id: 'qwen3.6-plus', name: 'Qwen 3.6 Plus', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'Qwen', requiresPatch: false, family: null, description: 'Modelo geral Qwen. Reasoning não injetado pelo plugin.' },
  { id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'Qwen', requiresPatch: false, family: null, description: 'Modelo geral Qwen. Reasoning não injetado pelo plugin.' },
  { id: 'qwen3.7-max', name: 'Qwen 3.7 Max', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'high', badge: 'Qwen Max', requiresPatch: false, family: null, description: 'Modelo topo de linha Qwen. Reasoning não injetado pelo plugin.' },
  { id: 'qwen3.8-max', name: 'Qwen 3.8 Max', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'high', badge: 'Qwen Max', requiresPatch: false, family: null, description: 'Modelo topo de linha Qwen mais recente. Reasoning não injetado pelo plugin.' },
  { id: 'mimo-v2-pro', name: 'MiMo V2 Pro', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'Xiaomi', requiresPatch: false, family: null, description: 'Xiaomi MiMo Pro. Reasoning não injetado pelo plugin.' },
  { id: 'mimo-v2-omni', name: 'MiMo V2 Omni', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'Xiaomi', requiresPatch: false, family: null, description: 'Xiaomi MiMo Omni (multimodal). Reasoning não injetado pelo plugin.' },
  { id: 'mimo-v2.5', name: 'MiMo V2.5', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'Xiaomi', requiresPatch: false, family: null, description: 'Xiaomi MiMo 2.5. Reasoning não injetado pelo plugin.' },
  { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'Xiaomi', requiresPatch: false, family: null, description: 'Xiaomi MiMo 2.5 Pro. Max tokens limitado a 131072 pelo plugin.' },
  { id: 'minimax-m2.5', name: 'MiniMax M2.5', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'MiniMax', requiresPatch: false, family: null, description: 'MiniMax. Reasoning não injetado pelo plugin.' },
  { id: 'minimax-m2.7', name: 'MiniMax M2.7', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'MiniMax', requiresPatch: false, family: null, description: 'MiniMax. Reasoning não injetado pelo plugin.' },
  { id: 'minimax-m3', name: 'MiniMax M3', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'MiniMax', requiresPatch: false, family: null, description: 'MiniMax mais recente. Reasoning não injetado pelo plugin.' },
  { id: 'kimi-k3', name: 'Kimi K3', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'Kimi', requiresPatch: false, family: null, description: 'Kimi K3. Reasoning não injetado pelo plugin (fora da família k2).' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'OpenAI', requiresPatch: false, family: null, description: 'Modelo via OpenCode Go. Reasoning não injetado pelo plugin.' },
  { id: 'grok-4.5', name: 'Grok 4.5', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'xAI', requiresPatch: false, family: null, description: 'Grok via OpenCode Go. Reasoning não injetado pelo plugin.' },
  { id: 'muse-spark-1.2-contributor', name: 'Muse Spark 1.2', allowedReasoning: ['none', 'low', 'medium', 'high', 'max'], defaultReasoning: 'medium', badge: 'Muse', requiresPatch: false, family: null, description: 'Modelo contribuinte via OpenCode Go. Reasoning não injetado pelo plugin.' }
];

// Ordena: famílias com tratamento próprio primeiro (mais usadas), depois o resto por nome
opencodeGoModels.sort((a, b) => {
  const fa = a.family ? 0 : 1;
  const fb = b.family ? 0 : 1;
  if (fa !== fb) return fa - fb;
  return a.id.localeCompare(b.id);
});

const PROVIDERS = [
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    baseUrl: OP,
    keyEnv: 'OPENCODE_GO_API_KEY',
    availableOn: ['server', 'acer', 'windows'],
    badge: 'Padrão da frota',
    description: 'Provedor padrão da frota Hermes via OpenCode Go (SKU gratuito). 29 modelos disponíveis.',
    models: opencodeGoModels
  },
  {
    id: 'xai-oauth',
    name: 'xAI SuperGrok',
    baseUrl: 'https://api.x.ai/v1',
    keyEnv: 'XAI_API_KEY (ou sessão SuperGrok)',
    availableOn: ['server', 'acer'],
    badge: 'xAI OAuth',
    description: 'Acesso via sessão SuperGrok autenticada (auth.json) ou XAI_API_KEY. Disponível em server e acer.',
    models: [
      {
        id: 'grok-4.6',
        name: 'Grok 4.6 (xAI SuperGrok)',
        allowedReasoning: ['low', 'high'],
        defaultReasoning: 'high',
        badge: 'xAI OAuth',
        requiresPatch: false,
        description: 'Acesso via sessão SuperGrok autenticada.'
      }
    ]
  },
  {
    id: 'deepseek-standard',
    name: 'DeepSeek API (Oficial)',
    baseUrl: 'https://api.deepseek.com/v1',
    keyEnv: 'DEEPSEEK_API_KEY',
    availableOn: ['server', 'acer', 'windows'],
    badge: 'DeepSeek Oficial',
    description: 'API oficial da DeepSeek com tarifação por token. Chave DEEPSEEK_API_KEY presente nos 3 PCs.',
    models: [
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro (Oficial)',
        allowedReasoning: ['none', 'low', 'medium', 'high'],
        defaultReasoning: 'high',
        badge: 'DeepSeek Oficial',
        requiresPatch: false,
        description: 'Modelo oficial com tarifação por token na API da DeepSeek.'
      },
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash (Oficial)',
        allowedReasoning: ['none', 'low', 'medium', 'high'],
        defaultReasoning: 'medium',
        badge: 'DeepSeek Oficial',
        requiresPatch: false,
        description: 'Variante Flash na API oficial da DeepSeek, mais rápida e econômica.'
      }
    ]
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    availableOn: ['server', 'acer'],
    badge: 'Multi-modelos',
    description: 'Acesso a dezenas de modelos por uma única API. Curadoria: apenas modelos BONS e BARATOS para código. Preços em USD/M tokens (2026-08-23).',
    models: [
      {
        id: 'deepseek/deepseek-v4-flash',
        name: 'DeepSeek V4 Flash (OR)',
        allowedReasoning: ['none', 'low', 'medium', 'high'],
        defaultReasoning: 'medium',
        badge: '$0.06 / $0.12',
        requiresPatch: false,
        description: 'Excelente para código, 1M ctx. $0.059/M in, $0.117/M out.'
      },
      {
        id: 'qwen/qwen3.7-flash',
        name: 'Qwen 3.7 Flash (OR)',
        allowedReasoning: ['none', 'low', 'medium', 'high'],
        defaultReasoning: 'medium',
        badge: '$0.03 / $0.13',
        requiresPatch: false,
        description: 'Muito barato, 1M ctx. $0.03/M in, $0.13/M out.'
      },
      {
        id: 'qwen/qwen3-coder-next',
        name: 'Qwen3 Coder Next (OR)',
        allowedReasoning: ['none', 'low', 'medium', 'high'],
        defaultReasoning: 'high',
        badge: '$0.12 / $0.80',
        requiresPatch: false,
        description: 'Especializado em código, 262K ctx. $0.12/M in, $0.80/M out.'
      },
      {
        id: 'openai/gpt-5-nano',
        name: 'GPT-5 Nano (OR)',
        allowedReasoning: ['none', 'low', 'medium', 'high'],
        defaultReasoning: 'high',
        badge: '$0.05 / $0.40',
        requiresPatch: false,
        description: 'OpenAI barato, 400K ctx. $0.05/M in, $0.40/M out.'
      },
      {
        id: 'tencent/hy3',
        name: 'Hy3 (Tencent/OR)',
        allowedReasoning: ['none', 'low', 'high'],
        defaultReasoning: 'high',
        badge: '$0.13 / $0.53',
        requiresPatch: false,
        description: 'Hy3 via OpenRouter, 262K ctx. $0.132/M in, $0.528/M out.'
      },
      {
        id: 'google/gemini-2.5-flash',
        name: 'Gemini 2.5 Flash (OR)',
        allowedReasoning: ['none', 'low', 'medium', 'high'],
        defaultReasoning: 'medium',
        badge: '$0.30 / $2.50',
        requiresPatch: false,
        description: 'Google Gemini Flash, 1M ctx. $0.30/M in, $2.50/M out.'
      },
      {
        id: 'anthropic/claude-haiku-4.5',
        name: 'Claude Haiku 4.5 (OR)',
        allowedReasoning: ['none', 'low', 'medium', 'high'],
        defaultReasoning: 'medium',
        badge: '$1.00 / $5.00',
        requiresPatch: false,
        description: 'Claude leve e rápido, 200K ctx. $1.00/M in, $5.00/M out. (mais caro da curadoria)'
      },
      {
        id: 'moonshotai/kimi-k2.5',
        name: 'Kimi K2.5 (OR)',
        allowedReasoning: ['none', 'low', 'medium', 'high'],
        defaultReasoning: 'high',
        badge: '$0.45 / $2.25',
        requiresPatch: false,
        description: 'Kimi em OpenRouter, 262K ctx. $0.45/M in, $2.25/M out.'
      }
    ]
  }
];

// Lista plana derivada (para retrocompatibilidade com endpoints antigos)
function flattenPresets() {
  const out = [];
  for (const p of PROVIDERS) {
    for (const m of p.models) {
      out.push({
        ...m,
        id: m.id,
        name: m.name,
        provider: p.id,
        baseUrl: p.baseUrl,
        keyEnv: p.keyEnv,
        availableOn: p.availableOn,
        providerName: p.name,
        providerBadge: p.badge
      });
    }
  }
  return out;
}

/**
 * GET /api/models/providers
 * Retorna o catálogo hierárquico Provider → Model → reasoning.
 */
router.get('/providers', (req, res) => {
  res.json({ success: true, providers: PROVIDERS });
});

/**
 * GET /api/models/presets
 * Retorna a lista plana de presets (retrocompatível).
 */
router.get('/presets', (req, res) => {
  res.json({ success: true, presets: flattenPresets() });
});

// Resolve o provider a partir de um id de modelo
function findProviderForModel(modelId) {
  for (const p of PROVIDERS) {
    if (p.models.some((m) => m.id === modelId)) return p;
  }
  return null;
}

// Resolve um modelo (preset) pelo id
function findModelPreset(modelId) {
  for (const p of PROVIDERS) {
    const m = p.models.find((mm) => mm.id === modelId);
    if (m) {
      return { ...m, provider: p.id, baseUrl: p.baseUrl, availableOn: p.availableOn, keyEnv: p.keyEnv };
    }
  }
  return null;
}

module.exports = router;
module.exports.PROVIDERS = PROVIDERS;
module.exports.findProviderForModel = findProviderForModel;
module.exports.findModelPreset = findModelPreset;