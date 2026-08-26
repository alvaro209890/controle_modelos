const express = require('express');
const router = express.Router();

/**
 * CATÁLOGO HIERÁRQUICO: Provider → Model → (allowedReasoning, defaultReasoning, contexto, custo, free)
 *
 * oprocotocolo opencode-go consulta o relay AO VIVO (GET /models) a cada N minutos para que a
 * lista se atualize sozinha quando novos modelos aparecerem. Caso a consulta falhe, cai na
 * lista base embutida abaixo. Os metadados (contexto/custo/free/reasoning) vêm do catálogo do
 * CLI opencode e do plugin opencode-zen do Hermes (verificado 2026-08-23).
 *
 * free = custo $0 (provedor opencode-go). No catálogo atual só `ox-alpha-free` é free.
 */

const OP = 'https://opencode.ai/zen/go/v1';

// ── metadados por modelo (base) ──────────────────────────────────────────────
// ctx: contexto máxima (tokens) · out: saída máxima · in/outCost: $/M tokens · free: bool
const MODEL_META = {
  // família hy3
  'hy3':            { ctx: 256000,  out: 64000,  in: 0.0175,  outCost: 0.0725, free: false },
  'hy3-preview':    { ctx: 256000,  out: 64000,  in: 0.0175,  outCost: 0.0725, free: false },
  // ox-alpha (o único free do go)
  'ox-alpha-free':  { ctx: 1000000, out: 131072, in: 0,       outCost: 0,      free: true  },
  // glm (5.2 tem knob nativo)
  'glm-5':          { ctx: 202752,  out: 32768,  in: 1,       outCost: 3.2,    free: false },
  'glm-5.1':        { ctx: 202752,  out: 32768,  in: 1.4,     outCost: 4.4,    free: false },
  'glm-5.2':        { ctx: 1000000, out: 131072, in: 1.4,     outCost: 4.4,    free: false },
  'glm-5.3':        { ctx: 1000000, out: 131072, in: 1.4,     outCost: 4.4,    free: false },
  // kimi
  'kimi-k2.5':      { ctx: 262144,  out: 65536,  in: 0.6,     outCost: 3,      free: false },
  'kimi-k2.6':      { ctx: 262144,  out: 65536,  in: 0.95,    outCost: 4,      free: false },
  'kimi-k2.7-code': { ctx: 262144,  out: 262144, in: 0.95,    outCost: 4,      free: false },
  'kimi-k3':        { ctx: 1048576, out: 131072, in: 3,       outCost: 15,     free: false },
  // deepseek
  'deepseek-v4-pro':            { ctx: 1000000, out: 384000, in: 0.66,    outCost: 1.98,  free: false },
  'deepseek-v4-flash':          { ctx: 1000000, out: 384000, in: 0.22,    outCost: 0.66,  free: false },
  'deepseek-v4-flash-vision-exp': { ctx: 1000000, out: 384000, in: 0.22,  outCost: 0.66,  free: false },
  // qwen
  'qwen3.5-plus':   { ctx: 262144, out: 65536,  in: 0.2,  outCost: 1.2,  free: false },
  'qwen3.6-plus':   { ctx: 1000000, out: 65536,  in: 0.5,  outCost: 3,    free: false },
  'qwen3.7-plus':   { ctx: 1000000, out: 65536,  in: 0.4,  outCost: 1.6,  free: false },
  'qwen3.7-max':    { ctx: 1000000, out: 65536,  in: 2.5,  outCost: 7.5,  free: false },
  'qwen3.8-max':    { ctx: 1000000, out: 131072, in: 2,    outCost: 6,    free: false },
  // xiaomi mimo
  'mimo-v2-pro':    { ctx: 1048576, out: 128000, in: 1,       outCost: 3,    free: false },
  'mimo-v2-omni':   { ctx: 262144,  out: 128000, in: 0.4,     outCost: 2,    free: false },
  'mimo-v2.5':      { ctx: 1000000, out: 128000, in: 0.14,    outCost: 0.28, free: false },
  'mimo-v2.5-pro':  { ctx: 1048576, out: 128000, in: 0.435,   outCost: 0.87, free: false },
  // minimax
  'minimax-m2.5':   { ctx: 204800,  out: 65536,  in: 0.3,  outCost: 1.2, free: false },
  'minimax-m2.7':   { ctx: 204800,  out: 131072, in: 0.3,  outCost: 1.2, free: false },
  'minimax-m3':     { ctx: 1000000, out: 131072, in: 0.3,  outCost: 1.2, free: false },
  // misc
  'gpt-5.6-luna':   { ctx: 1050000, out: 128000, in: 0.2,    outCost: 1.2, free: false },
  'grok-4.5':       { ctx: 500000,  out: 500000, in: 2,      outCost: 6,   free: false },
  'muse-spark-1.2-contributor': { ctx: 1048576, out: 131072, in: 0.1, outCost: 0.2, free: false },

  // ── opencode normal (ZEN /zen/v1) — modelos GRATUITOS validados em HTTP 200 (2026-08-24) ──
  'hy3-free':       { ctx: 190000,  out: 64000,  in: 0, outCost: 0, free: true },
  'mimo-v2.5-free': { ctx: 200000,  out: 32000,  in: 0, outCost: 0, free: true },
  'laguna-s-2.1-free': { ctx: 256000, out: 32000, in: 0, outCost: 0, free: true },
  'nemotron-3.5-lightning-free': { ctx: 262144, out: 262144, in: 0, outCost: 0, free: true },
  'nemotron-3-ultra-free': { ctx: 1000000, out: 128000, in: 0, outCost: 0, free: true },
  'big-pickle': { ctx: 200000, out: 32000, in: 0, outCost: 0, free: true }
};

// reasoning por família (plugin opencode-zen)
function reasoningForModel(id) {
  if (id.startsWith('ox-alpha')) return { allowed: ['low', 'high', 'max'], def: 'max', family: 'ox-alpha' };
  if (id === 'hy3' || id.startsWith('hy3-')) return { allowed: ['none', 'low', 'high'], def: 'high', family: 'hy3' };
  if (id.startsWith('glm-5.2')) return { allowed: ['high', 'max'], def: 'high', family: 'glm-5.2' };
  if (id.startsWith('kimi-k2')) return { allowed: ['low', 'medium', 'high'], def: 'high', family: 'kimi-k2' };
  if (id.startsWith('deepseek-v')) return { allowed: ['none', 'low', 'medium', 'high', 'max'], def: id.includes('pro') ? 'high' : 'medium', family: 'deepseek' };
  return { allowed: ['none', 'low', 'medium', 'high', 'max'], def: /max$/.test(id) ? 'high' : 'medium', family: null };
}

function buildModel(id) {
  const meta = MODEL_META[id] || {};
  const r = reasoningForModel(id);
  return {
    id,
    name: prettyName(id),
    allowedReasoning: r.allowed,
    defaultReasoning: r.def,
    badge: meta.free ? 'GRÁTIS 🟢' : (meta.in !== undefined ? `$${fmt(meta.in)}/$${fmt(meta.outCost)}` : ''),
    free: !!meta.free,
    contextLength: meta.ctx || null,
    costInput: meta.in ?? null,
    costOutput: meta.outCost ?? null,
    requiresPatch: id.startsWith('ox-alpha'),
    family: r.family,
    description: describeModel(id, meta)
  };
}

function fmt(v) { return v >= 0.1 ? String(v) : v >= 0.01 ? String(v) : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''); }

function prettyName(id) {
  const map = {
    'hy3': 'Hy3', 'hy3-preview': 'Hy3 Preview',
    'ox-alpha-free': 'Ox Alpha Free',
    'glm-5': 'GLM-5', 'glm-5.1': 'GLM-5.1', 'glm-5.2': 'GLM-5.2', 'glm-5.3': 'GLM-5.3',
    'kimi-k2.5': 'Kimi K2.5', 'kimi-k2.6': 'Kimi K2.6', 'kimi-k2.7-code': 'Kimi K2.7 Code', 'kimi-k3': 'Kimi K3',
    'deepseek-v4-pro': 'DeepSeek V4 Pro', 'deepseek-v4-flash': 'DeepSeek V4 Flash', 'deepseek-v4-flash-vision-exp': 'DeepSeek V4 Flash Vision',
    'qwen3.5-plus': 'Qwen 3.5 Plus', 'qwen3.6-plus': 'Qwen 3.6 Plus', 'qwen3.7-plus': 'Qwen 3.7 Plus', 'qwen3.7-max': 'Qwen 3.7 Max', 'qwen3.8-max': 'Qwen 3.8 Max',
    'mimo-v2-pro': 'MiMo V2 Pro', 'mimo-v2-omni': 'MiMo V2 Omni', 'mimo-v2.5': 'MiMo V2.5', 'mimo-v2.5-pro': 'MiMo V2.5 Pro',
    'minimax-m2.5': 'MiniMax M2.5', 'minimax-m2.7': 'MiniMax M2.7', 'minimax-m3': 'MiniMax M3',
    'gpt-5.6-luna': 'GPT-5.6 Luna', 'grok-4.5': 'Grok 4.5', 'muse-spark-1.2-contributor': 'Muse Spark 1.2',
    'hy3-free': 'Hy3 Free', 'mimo-v2.5-free': 'MiMo V2.5 Free', 'laguna-s-2.1-free': 'Laguna S2.1 Free',
    'nemotron-3.5-lightning-free': 'Nemotron 3.5 Lightning Free', 'nemotron-3-ultra-free': 'Nemotron 3 Ultra Free', 'big-pickle': 'Big Pickle'
  };
  return map[id] || id;
}

function describeModel(id, meta) {
  const parts = [];
  if (meta.free) parts.push('⭐ GRÁTIS (US$0).');
  if (meta.ctx) parts.push(`Contexto ${meta.ctx >= 1000000 ? Math.round(meta.ctx/100000)/10 + 'M' : Math.round(meta.ctx/1000) + 'K'} tokens; saída máx ${meta.out ? Math.round(meta.out/1000) + 'K' : '?'}.`);
  else parts.push('Contexto como definido pelo relay.');
  if (meta.in !== undefined && !meta.free) parts.push(`Custo US$${fmt(meta.in)}/M in, US$${fmt(meta.outCost)}/M out.`);
  return parts.join(' ');
}

// ids gratuitos do OpenCode "normal" (/zen/v1), validados em HTTP 200
const ZEN_FREE_IDS = ['hy3-free', 'mimo-v2.5-free', 'laguna-s-2.1-free', 'nemotron-3.5-lightning-free', 'nemotron-3-ultra-free', 'big-pickle'];

// Catálogo medido no endpoint do 9Router do server-desktop. Não inclui uma
// lista teórica: cada id abaixo foi retornado por GET /v1/models em 26/08/2026.
// O serviço fica acessível apenas pela malha Tailscale da frota.
const NINEROUTER_URL = 'http://100.65.138.58:20128/v1';
const NINEROUTER_IDS = [
  'ag/gemini-3.7-flash-high', 'ag/gemini-3.7-flash-medium', 'ag/gemini-3.7-flash-low',
  'ag/gemini-3.6-flash-high', 'ag/gemini-3.6-flash-medium', 'ag/gemini-3.5-flash-high',
  'ag/gemini-3-flash-agent', 'ag/gemini-3.5-flash-low', 'ag/gemini-3.5-flash-extra-low',
  'ag/gemini-pro-agent', 'ag/gemini-3.1-pro-low', 'ag/claude-sonnet-4-6',
  'ag/claude-opus-4-6-thinking', 'ag/gpt-oss-120b-medium', 'ag/gemini-3-flash',
  'gc/gemini-3.1-pro-preview', 'gc/gemini-3-pro-preview', 'gc/gemini-3-flash-preview',
  'gc/gemini-3.1-flash-lite-preview', 'gc/gemini-2.5-pro', 'gc/gemini-2.5-flash',
  'gc/gemini-2.5-flash-lite', 'kc/anthropic/claude-sonnet-4-20250514',
  'kc/anthropic/claude-opus-4-20250514', 'kc/google/gemini-2.5-pro',
  'kc/google/gemini-2.5-flash', 'kc/openai/gpt-4.1', 'kc/openai/o3',
  'kc/deepseek/deepseek-chat', 'kc/deepseek/deepseek-reasoner',
  'cx/gpt-5.6-sol', 'cx/gpt-5.6-sol-review', 'cx/gpt-5.6-terra',
  'cx/gpt-5.6-terra-review', 'cx/gpt-5.6-luna', 'cx/gpt-5.6-luna-review',
  'cx/gpt-5.5', 'cx/gpt-5.5-review', 'cx/gpt-5.4', 'cx/gpt-5.4-review',
  'cx/gpt-5.4-mini', 'cx/gpt-5.4-mini-review', 'cx/gpt-5.3-codex-spark',
  'cx/gpt-5.3-codex-spark-review', 'ollama/gpt-oss:120b', 'ollama/kimi-k2.5',
  'ollama/glm-5', 'ollama/minimax-m2.5', 'ollama/glm-4.7-flash', 'ollama/qwen3.5',
  'ollama/minimax-m3'
];

function ninerouterName(id) {
  const [prefix, ...parts] = id.split('/');
  const source = {
    ag: 'Antigravity', gc: 'Gemini CLI', kc: 'KiloCode', cx: 'Codex', ollama: 'Ollama'
  }[prefix] || prefix;
  return source + ' — ' + parts.join('/');
}

function buildNineRouterModel(id) {
  const model = buildModel(id);
  return {
    ...model,
    name: ninerouterName(id),
    badge: '9Router',
    free: false,
    requiresPatch: false,
    description: 'Disponível pelo 9Router do server-desktop; catálogo lido do endpoint autenticado da frota.'
  };
}

// ── consulta viva ao relay opencode-go ───────────────────────────────────────
let liveCache = { ts: 0, ids: [] };
let lastAttemptTs = 0;
const LIVE_TTL = 5 * 60 * 1000;   // 5 min de validade do catálogo vivo
const RETRY_TTL = 30 * 1000;      // espera 30s antes de tentar de novo depois de uma falha

function readKey() {
  if (process.env.OPENCODE_GO_API_KEY) return process.env.OPENCODE_GO_API_KEY;
  try {
    const fs = require('fs');
    const home = process.env.HOME || '/home/server';
    const env = fs.readFileSync(home + '/.hermes/.env', 'utf8');
    const m = env.match(/^OPENCODE_GO_API_KEY=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

async function fetchLiveIds() {
  const key = readKey();
  if (!key) return null;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch('https://opencode.ai/zen/go/v1/models?full=true', {
      headers: { 'Authorization': 'Bearer ' + key },
      signal: controller.signal
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const ids = (data.data || []).map((m) => m.id).filter((x) => x);
    return ids;
  } catch {
    return null;
  }
}

// Lista de ids: viva (cacheada) com fallback na base
async function goModelIds() {
  const now = Date.now();
  // Sem o `lastAttemptTs`, um relay fora do ar fazia TODA request de /providers pagar 12s de
  // timeout — o painel demorava a abrir justamente quando a rede estava ruim.
  const stale = now - liveCache.ts > LIVE_TTL;
  const mayRetry = now - lastAttemptTs > RETRY_TTL;
  if (stale && mayRetry) {
    lastAttemptTs = now;
    const live = await fetchLiveIds();
    if (live && live.length > 0) {
      liveCache = { ts: now, ids: live };
    }
  }
  return liveCache.ids.length > 0 ? liveCache.ids : baseGoIds();
}

function baseGoIds() {
  return [
    'minimax-m3','minimax-m2.7','minimax-m2.5','kimi-k3','kimi-k2.7-code','kimi-k2.6',
    'kimi-k2.5','glm-5.2','glm-5.3','ox-alpha-free','glm-5.1','glm-5','deepseek-v4-pro',
    'deepseek-v4-flash','deepseek-v4-flash-vision-exp','qwen3.7-max','qwen3.8-max','qwen3.7-plus',
    'qwen3.6-plus','qwen3.5-plus','mimo-v2-pro','mimo-v2-omni','mimo-v2.5-pro','mimo-v2.5',
    'hy3','hy3-preview','gpt-5.6-luna','grok-4.5','muse-spark-1.2-contributor'
  ];
}

// ── build dos providers ──────────────────────────────────────────────────────
/**
 * Fonte ÚNICA do catálogo (2026-08-24).
 *
 * Antes existiam duas listas: `buildProviders()` (5 provedores, usada pelo front) e
 * `_fallbackProviders()` (4 provedores, usada pela VALIDAÇÃO do backend). O `openrouter` só
 * existia na primeira — então todo modelo do OpenRouter que o front oferecia era desconhecido
 * na hora de salvar: sem preset, sem checagem de reasoning e sem checagem de credencial por PC.
 * Agora as duas nascem daqui, mudando só a lista de ids do opencode-go.
 */
function providerList(goIds) {
  return [
    {
      id: 'opencode-go',
      name: 'OpenCode Go',
      baseUrl: OP,
      keyEnv: 'OPENCODE_GO_API_KEY',
      availableOn: ['server', 'acer', 'windows'],
      badge: 'Padrão da frota',
      description: 'Provedor padrão da frota Hermes via OpenCode Go. Lista atualizada automaticamente do relay (cache 5 min).',
      models: goIds.map(buildModel)
    },
    {
      id: 'opencode-zen',
      name: 'OpenCode Zen (grátis)',
      baseUrl: 'https://opencode.ai/zen/v1',
      keyEnv: 'OPENCODE_ZEN_API_KEY',
      availableOn: ['server', 'acer', 'windows'],
      badge: '6 grátis',
      description: 'Modelos GRATUITOS do OpenCode normal (endpoint /zen/v1), todos validados em HTTP 200 (2026-08-24).',
      models: ZEN_FREE_IDS.map((id) => {
        const m = buildModel(id);
        // reasoning: hy3-free segue a família hy3 (none|low|high); laguna aceita low|medium|high
        if (id === 'hy3-free') {
          m.allowedReasoning = ['none', 'low', 'high'];
          m.defaultReasoning = 'high';
        } else if (id === 'laguna-s-2.1-free') {
          m.allowedReasoning = ['low', 'medium', 'high'];
          m.defaultReasoning = 'high';
        }
        m.badge = 'GRÁTIS 🟢';
        m.name = prettyName(id);
        return m;
      })
    },
    {
      id: 'xai-oauth',
      name: 'xAI SuperGrok',
      baseUrl: 'https://api.x.ai/v1',
      keyEnv: 'XAI_API_KEY (ou sessão SuperGrok)',
      availableOn: ['server', 'acer'],
      badge: 'xAI OAuth',
      description: 'Acesso via sessão SuperGrok autenticada (auth.json) ou XAI_API_KEY.',
      models: [
        {
          ...buildModel('grok-4.6'),
          id: 'grok-4.6',
          name: 'Grok 4.6 (xAI SuperGrok)',
          allowedReasoning: ['low', 'high'],
          defaultReasoning: 'high',
          badge: 'xAI OAuth',
          contextLength: 131072,
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
      description: 'API oficial da DeepSeek com tarifação por token. Chave nos 3 PCs.',
      models: [
        { ...buildModel('deepseek-v4-pro'), name: 'DeepSeek V4 Pro (Oficial)', badge: 'DeepSeek Oficial', description: 'Modelo oficial com tarifação por token na API da DeepSeek.' },
        { ...buildModel('deepseek-v4-flash'), name: 'DeepSeek V4 Flash (Oficial)', badge: 'DeepSeek Oficial', description: 'Variante Flash na API oficial da DeepSeek, mais rápida e econômica.' }
      ]
    },
    {
      id: 'ninerouter',
      name: '9Router (Frota)',
      baseUrl: NINEROUTER_URL,
      keyEnv: 'NINEROUTER_API_KEY',
      availableOn: ['server', 'acer', 'windows'],
      badge: 'Tailscale · ' + NINEROUTER_IDS.length + ' modelos',
      description: 'Gateway OpenAI-compatible do server-desktop, disponível nos 13 perfis Hermes pela malha privada Tailscale. Mostra somente os modelos atualmente liberados pelo 9Router.',
      models: NINEROUTER_IDS.map(buildNineRouterModel)
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      keyEnv: 'OPENROUTER_API_KEY',
      availableOn: ['server', 'acer'],
      badge: 'Multi-modelos',
      description: 'Curadoria de bons e baratos para código. Preços USD/M (2026-08-23).',
      models: [
        { ...buildModel('deepseek-v4-flash'), id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash (OR)', badge: '$0.06 / $0.12', costInput: 0.059, costOutput: 0.117, description: 'Excelente para código, 1M ctx. $0.059/M in, $0.117/M out.' },
        { id: 'qwen/qwen3.7-flash', name: 'Qwen 3.7 Flash (OR)', allowedReasoning: ['none','low','medium','high'], defaultReasoning: 'medium', badge: '$0.03 / $0.13', contextLength: 1000000, costInput: 0.03, costOutput: 0.13, free: false, description: 'Muito barato, 1M ctx. $0.03/M in, $0.13/M out.' },
        { id: 'qwen/qwen3-coder-next', name: 'Qwen3 Coder Next (OR)', allowedReasoning: ['none','low','medium','high'], defaultReasoning: 'high', badge: '$0.12 / $0.80', contextLength: 262144, costInput: 0.12, costOutput: 0.80, free: false, description: 'Especializado em código, 262K ctx. $0.12/M in, $0.80/M out.' },
        { id: 'openai/gpt-5-nano', name: 'GPT-5 Nano (OR)', allowedReasoning: ['none','low','medium','high'], defaultReasoning: 'high', badge: '$0.05 / $0.40', contextLength: 400000, costInput: 0.05, costOutput: 0.40, free: false, description: 'OpenAI barato, 400K ctx. $0.05/M in, $0.40/M out.' },
        { id: 'tencent/hy3', name: 'Hy3 (Tencent/OR)', allowedReasoning: ['none','low','high'], defaultReasoning: 'high', badge: '$0.13 / $0.53', contextLength: 262144, costInput: 0.132, costOutput: 0.528, free: false, description: 'Hy3 via OpenRouter, 262K ctx. $0.132/M in, $0.528/M out.' },
        { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash (OR)', allowedReasoning: ['none','low','medium','high'], defaultReasoning: 'medium', badge: '$0.30 / $2.50', contextLength: 1000000, costInput: 0.30, costOutput: 2.50, free: false, description: 'Google Gemini Flash, 1M ctx. $0.30/M in, $2.50/M out.' },
        { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (OR)', allowedReasoning: ['none','low','medium','high'], defaultReasoning: 'medium', badge: '$1.00 / $5.00', contextLength: 200000, costInput: 1.00, costOutput: 5.00, free: false, description: 'Claude leve e rápido, 200K ctx. $1/M in, $5/M out.' },
        { id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5 (OR)', allowedReasoning: ['none','low','medium','high'], defaultReasoning: 'high', badge: '$0.45 / $2.25', contextLength: 262144, costInput: 0.45, costOutput: 2.25, free: false, description: 'Kimi em OpenRouter, 262K ctx. $0.45/M in, $2.25/M out.' }
      ]
    }
  ];
}

async function buildProviders() {
  return providerList(await goModelIds());
}

// Catálogo estático (sem rede) — usado pela validação do backend e como fallback do endpoint
function _fallbackProviders() {
  return providerList(baseGoIds());
}

function flattenPresets(providers) {
  const out = [];
  for (const p of providers) {
    for (const m of p.models) {
      out.push({ ...m, id: m.id, name: m.name, provider: p.id, baseUrl: p.baseUrl, keyEnv: p.keyEnv, availableOn: p.availableOn, providerName: p.name });
    }
  }
  return out;
}

/**
 * GET /api/models/providers — catálogo hierárquico (opencode-go atualizado ao vivo)
 */
router.get('/providers', async (req, res) => {
  try {
    const providers = await buildProviders();
    res.json({ success: true, providers });
  } catch (e) {
    console.error('/api/models/providers falhou, servindo catálogo base:', e.message);
    res.json({ success: true, providers: _fallbackProviders(), degraded: true });
  }
});

/**
 * GET /api/models/presets — lista plana
 */
router.get('/presets', async (req, res) => {
  try {
    const providers = await buildProviders();
    res.json({ success: true, presets: flattenPresets(providers) });
  } catch (e) {
    console.error('/api/models/presets falhou, servindo catálogo base:', e.message);
    res.json({ success: true, presets: flattenPresets(_fallbackProviders()), degraded: true });
  }
});

// Preset de um modelo: procura primeiro no provider informado (o mesmo id pode existir em mais
// de um provedor — `deepseek-v4-pro` está no opencode-go E no deepseek-standard).
function findModelPreset(modelId, providerId) {
  const providers = _fallbackProviders();
  const ordered = providerId ? providers.slice().sort((a, b) => (a.id === providerId ? -1 : b.id === providerId ? 1 : 0)) : providers;
  for (const p of ordered) {
    const m = p.models.find((mm) => mm.id === modelId);
    if (m) return { ...m, provider: p.id, baseUrl: p.baseUrl, availableOn: p.availableOn, keyEnv: p.keyEnv, providerName: p.name };
  }
  return null;
}

function findProviderForModel(modelId) {
  for (const p of _fallbackProviders()) {
    if (p.models.some((m) => m.id === modelId)) return p;
  }
  return null;
}

function findProviderById(providerId) {
  return _fallbackProviders().find((p) => p.id === providerId) || null;
}

module.exports = router;
module.exports.PROVIDERS = _fallbackProviders;
module.exports.findProviderForModel = findProviderForModel;
module.exports.findProviderById = findProviderById;
module.exports.findModelPreset = findModelPreset;
module.exports.buildProviders = buildProviders;
module.exports._fallbackProviders = _fallbackProviders;
