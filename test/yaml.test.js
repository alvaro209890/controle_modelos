/**
 * Testes do editor cirúrgico de YAML e do catálogo de provedores.
 * Rodar com: npm test
 *
 * Cobre os defeitos corrigidos em 2026-08-24:
 *  - chave ausente no config saía sem alteração e a API respondia "sucesso";
 *  - ids namespaced do OpenRouter (`fornecedor/modelo`) eram recusados;
 *  - `openrouter` não existia no catálogo usado pela validação do backend.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { applyModelChangesToYaml, parseAgentConfig } = require('../services/configManager');
const { safeModel } = require('../services/validation');
const models = require('../routes/models');

const FIXTURE = path.join(__dirname, 'fixtures', 'perfil-exemplo.yaml');
let failures = 0;

function check(name, cond, extra) {
  if (cond) {
    console.log('  ok   ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + extra : ''));
  }
}

function apply(raw, updates) {
  const before = yaml.parse(raw);
  const r = applyModelChangesToYaml(raw, updates);
  check('resultado válido', r.ok, r.warnings.join('; '));
  if (!r.content) return r;
  const after = yaml.parse(r.content);
  check('model.default', after.model.default === updates.model, after.model.default);
  check('model.provider', after.model.provider === updates.provider, after.model.provider);
  check('model.base_url', after.model.base_url === updates.baseUrl, after.model.base_url);
  check('agent.reasoning_effort', after.agent.reasoning_effort === updates.reasoningEffort, after.agent.reasoning_effort);
  check('override do modelo novo',
    after.agent.reasoning_overrides[updates.model] === updates.reasoningEffort,
    JSON.stringify(after.agent.reasoning_overrides));
  if (updates.previousModel && updates.previousModel !== updates.model) {
    check('override órfão removido', !(updates.previousModel in after.agent.reasoning_overrides),
      JSON.stringify(after.agent.reasoning_overrides));
  }
  const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.model; delete c.agent; delete c.delegation; return c; };
  check('resto do YAML intacto', JSON.stringify(strip(before)) === JSON.stringify(strip(after)));
  check('bloco literal intacto', after.agent.personalities.noir === before.agent.personalities.noir);
  const comments = (s) => (s.match(/^\s*#/gm) || []).length;
  check('comentários preservados', comments(raw) === comments(r.content), comments(r.content));
  return r;
}

const raw = fs.readFileSync(FIXTURE, 'utf8');

console.log('\n== troca simples (opencode-go)');
apply(raw, { model: 'kimi-k2.6', provider: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1', reasoningEffort: 'high', previousModel: 'ox-alpha-free' });

console.log('\n== troca para provedor gratuito (opencode-zen)');
apply(raw, { model: 'hy3-free', provider: 'opencode-zen', baseUrl: 'https://opencode.ai/zen/v1', reasoningEffort: 'high', previousModel: 'ox-alpha-free' });

console.log('\n== modelo com barra (OpenRouter)');
apply(raw, { model: 'deepseek/deepseek-v4-flash', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', reasoningEffort: 'medium', previousModel: 'ox-alpha-free' });

console.log('\n== config sem as seções model/agent');
const bare = 'toolsets:\n  - hermes-cli\nmax_live_sessions: 4\n';
const r1 = applyModelChangesToYaml(bare, { model: 'glm-5.2', provider: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1', reasoningEffort: 'high' });
check('resultado válido', r1.ok, r1.warnings.join('; '));
check('criou as seções model e agent', r1.inserted.includes('model') && r1.inserted.includes('agent'), JSON.stringify(r1.inserted));
const parsedBare = parseAgentConfig(r1.content);
check('parse confirma o modelo', parsedBare.data.model === 'glm-5.2' && parsedBare.data.reasoningEffort === 'high');

console.log('\n== seção model existente, sem base_url');
const partial = 'model:\n  default: hy3\n  provider: opencode-go\nagent:\n  max_turns: 10\n';
const r2 = applyModelChangesToYaml(partial, { model: 'glm-5.2', provider: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1', reasoningEffort: 'max' });
check('resultado válido', r2.ok, r2.warnings.join('; '));
check('inseriu base_url e reasoning_effort',
  r2.inserted.includes('model.base_url') && r2.inserted.includes('agent.reasoning_effort'), JSON.stringify(r2.inserted));

console.log('\n== idempotência');
const p1 = applyModelChangesToYaml(raw, { model: 'kimi-k2.6', provider: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1', reasoningEffort: 'high', previousModel: 'ox-alpha-free' });
const p2 = applyModelChangesToYaml(p1.content, { model: 'kimi-k2.6', provider: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1', reasoningEffort: 'high', previousModel: 'kimi-k2.6' });
check('segunda aplicação não altera nada', p2.changed === false, 'changed=' + p2.changed);

console.log('\n== parseAgentConfig não inventa valores');
const semModelo = parseAgentConfig('toolsets:\n  - hermes-cli\n');
check('model = null', semModelo.data.model === null, semModelo.data.model);
check('reporta o que falta', semModelo.data.missing.includes('model') && semModelo.data.missing.includes('agent'), JSON.stringify(semModelo.data.missing));

console.log('\n== validação de id de modelo');
check('aceita id simples', safeModel('glm-5.2') === 'glm-5.2');
check('aceita id namespaced', safeModel('deepseek/deepseek-v4-flash') === 'deepseek/deepseek-v4-flash');
check('recusa path traversal', safeModel('../../etc/passwd') === null);
check('recusa barra dupla', safeModel('a//b') === null);
check('recusa barra no fim', safeModel('a/') === null);

console.log('\n== catálogo de provedores');
const provs = models._fallbackProviders();
check('5 provedores no catálogo estático', provs.length === 5, provs.map((p) => p.id).join(','));
check('openrouter presente na validação', provs.some((p) => p.id === 'openrouter'));
check('preset de modelo OpenRouter resolve', (models.findModelPreset('deepseek/deepseek-v4-flash') || {}).provider === 'openrouter');
check('id ambíguo respeita o provider informado',
  models.findModelPreset('deepseek-v4-pro', 'deepseek-standard').provider === 'deepseek-standard');

console.log('\n' + (failures === 0 ? '✅ todos os testes passaram' : `❌ ${failures} falha(s)`));
process.exit(failures === 0 ? 0 : 1);
