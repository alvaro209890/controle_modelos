const express = require('express');
const router = express.Router();

// Catálogo de modelos suportados e homologados na frota
const MODEL_PRESETS = [
  {
    id: 'ox-alpha-free',
    name: 'Ox Alpha Free (Unlimited)',
    provider: 'opencode-go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    allowedReasoning: ['low', 'high', 'max'],
    defaultReasoning: 'max',
    badge: 'Grátis & Ilimitado',
    requiresPatch: true,
    description: 'Modelo gratuito sem limite de tokens via OpenCode Go. Aceita apenas low, high e max.'
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'opencode-go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    allowedReasoning: ['none', 'low', 'medium', 'high'],
    defaultReasoning: 'medium',
    badge: 'Rápido & Estável',
    requiresPatch: false,
    description: 'Excelente equilíbrio de velocidade e raciocínio para uso geral e automações.'
  },
  {
    id: 'hy3',
    name: 'Hy3 (OpenCode Go)',
    provider: 'opencode-go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    allowedReasoning: ['low', 'high'],
    defaultReasoning: 'high',
    badge: '8x Cota Go',
    requiresPatch: false,
    description: 'Alto raciocínio matemático e código. Consome 8x da cota no plano OpenCode Go.'
  },
  {
    id: 'grok-4.6',
    name: 'Grok 4.6 (xAI SuperGrok)',
    provider: 'xai-oauth',
    baseUrl: 'https://api.x.ai/v1',
    allowedReasoning: ['low', 'high'],
    defaultReasoning: 'high',
    badge: 'xAI OAuth',
    requiresPatch: false,
    description: 'Acesso via sessão SuperGrok autenticada.'
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'deepseek-standard',
    baseUrl: 'https://api.deepseek.com/v1',
    allowedReasoning: ['none', 'low', 'medium', 'high'],
    defaultReasoning: 'high',
    badge: 'DeepSeek Oficial',
    requiresPatch: false,
    description: 'Modelo oficial com tarifação por token na API da DeepSeek.'
  }
];

/**
 * GET /api/models/presets
 * Retorna os modelos homologados
 */
router.get('/presets', (req, res) => {
  res.json({ success: true, presets: MODEL_PRESETS });
});

module.exports = router;
module.exports.MODEL_PRESETS = MODEL_PRESETS;
