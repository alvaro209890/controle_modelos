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
 * `availableOn` controla quais PCs são elegíveis a cada provedor no frontend,
 * impedindo de setar um modelo de um provedor sem chave naquela máquina.
 */

const PROVIDERS = [
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    keyEnv: 'OPENCODE_GO_API_KEY',
    availableOn: ['server', 'acer', 'windows'],
    badge: 'Padrão da frota',
    description: 'Provedor padrão da frota Hermes via OpenCode Go (SKU gratuito). Chave presente nos 3 PCs.',
    models: [
      {
        id: 'ox-alpha-free',
        name: 'Ox Alpha Free (Unlimited)',
        allowedReasoning: ['low', 'high', 'max'],
        defaultReasoning: 'max',
        badge: 'Grátis & Ilimitado',
        requiresPatch: true,
        description: 'Modelo gratuito sem limite de tokens via OpenCode Go. Aceita apenas low, high e max.'
      },
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        allowedReasoning: ['none', 'low', 'medium', 'high'],
        defaultReasoning: 'medium',
        badge: 'Rápido & Estável',
        requiresPatch: false,
        description: 'Excelente equilíbrio de velocidade e raciocínio para uso geral e automações.'
      },
      {
        id: 'hy3',
        name: 'Hy3 (OpenCode Go)',
        allowedReasoning: ['low', 'high'],
        defaultReasoning: 'high',
        badge: '8x Cota Go',
        requiresPatch: false,
        description: 'Alto raciocínio matemático e código. Consome 8x da cota no plano OpenCode Go.'
      }
    ]
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
        name: 'DeepSeek V4 Pro',
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
    description: 'Acesso a muitos modelos por uma única API. Chave presente em server e acer.',
    models: [
      {
        id: 'xiaomi/mimo-v2.5',
        name: 'Xiaomi MiMo 2.5',
        allowedReasoning: ['none', 'low', 'medium', 'high'],
        defaultReasoning: 'medium',
        badge: 'OpenRouter',
        requiresPatch: false,
        description: 'Modelo via OpenRouter. Útil como provedor multi-modelo alternativo.'
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