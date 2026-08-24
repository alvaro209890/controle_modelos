const fs = require('fs');
const path = require('path');

/**
 * Estado local do painel (2026-08-24).
 *
 * Motivo: o Hermes lê o config.yaml só na subida do gateway. O painel gravava o YAML e
 * respondia "sucesso", mas o agente continuava com o modelo antigo até alguém reiniciar o
 * gateway na mão — foi exatamente o caso do perfil `geoforest` (config trocado às 08:27 com o
 * gateway no ar desde as 22:36 do dia anterior). Para o painel poder dizer "gravado, mas ainda
 * NÃO aplicado", ele registra aqui quando gravou cada agente e quando reiniciou cada host.
 *
 * Comparar carimbos do próprio painel é mais confiável do que ler o uptime do serviço em cada
 * host (relógios diferentes, Windows sem systemd).
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

let cache = null;

function emptyState() {
  return { lastWrite: {}, lastRestart: {} };
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = {
      lastWrite: parsed.lastWrite && typeof parsed.lastWrite === 'object' ? parsed.lastWrite : {},
      lastRestart: parsed.lastRestart && typeof parsed.lastRestart === 'object' ? parsed.lastRestart : {}
    };
  } catch {
    cache = emptyState();
  }
  return cache;
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    console.error('panelState: falha ao persistir estado:', e.message);
  }
}

/** Registra que o painel gravou o config de um agente agora */
function markWritten(agentId) {
  const st = load();
  st.lastWrite[agentId] = Date.now();
  persist();
}

/** Registra que o painel reiniciou o gateway de um host agora */
function markRestarted(pc) {
  const st = load();
  st.lastRestart[pc] = Date.now();
  persist();
}

/**
 * true quando existe gravação posterior ao último reinício conhecido daquele host,
 * ou seja: o arquivo já tem o modelo novo, mas o processo em execução ainda não.
 */
function isPendingRestart(agentId, pc) {
  const st = load();
  const written = st.lastWrite[agentId];
  if (!written) return false;
  const restarted = st.lastRestart[pc] || 0;
  return written > restarted;
}

function getWrittenAt(agentId) {
  return load().lastWrite[agentId] || null;
}

function getRestartedAt(pc) {
  return load().lastRestart[pc] || null;
}

module.exports = { markWritten, markRestarted, isPendingRestart, getWrittenAt, getRestartedAt };
