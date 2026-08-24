const SAFE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
// Ids de modelo podem ser namespaced (OpenRouter: `deepseek/deepseek-v4-flash`).
// Sem a `/` liberada aqui, TODO modelo do OpenRouter era recusado com 400 no salvar.
const MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
const REASONING_LEVELS = new Set(['none', 'low', 'medium', 'high', 'max']);
const KNOWN_PCS = new Set(['server', 'acer', 'windows']);

function safeIdentifier(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 64 || !SAFE_RE.test(v)) return null;
  return v;
}

function safeModel(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 96) return null;
  if (!MODEL_RE.test(v)) return null;
  // `..` e `//` não aparecem em id legítimo e são o vetor clássico de path traversal
  if (v.includes('..') || v.includes('//') || v.endsWith('/')) return null;
  return v;
}

function safeReasoning(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return REASONING_LEVELS.has(v) ? v : null;
}

function safeBaseUrl(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 512) return null;
  try {
    const u = new URL(v);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

function safePc(value) {
  const v = safeIdentifier(value);
  return v && KNOWN_PCS.has(v) ? v : null;
}

function safeBatchTarget(value) {
  if (value === null || value === undefined || value === '' || value === 'all') return 'all';
  return safePc(value);
}

function safeBool(value, fallback = false) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

module.exports = { safeIdentifier, safeModel, safeReasoning, safeBaseUrl, safePc, safeBatchTarget, safeBool, KNOWN_PCS };
