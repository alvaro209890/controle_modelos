const SAFE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const REASONING_LEVELS = new Set(['none', 'low', 'medium', 'high', 'max']);
const KNOWN_PCS = new Set(['server', 'acer', 'windows']);

function safeIdentifier(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 64 || !SAFE_RE.test(v)) return null;
  return v;
}

function safeModel(value) {
  return safeIdentifier(value);
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

module.exports = { safeIdentifier, safeModel, safeReasoning, safeBaseUrl, safePc, safeBatchTarget };