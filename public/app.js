// Estado global da aplicação
let fleetData = {
  agents: [],
  providers: [],
  hosts: {},
  currentLogHost: null,
  loading: false,
  lastUpdate: null
};

// ==================== UTILITÁRIOS ====================

// Todo dado que vem do servidor passa por aqui antes de virar HTML.
// Sem isso, um `&`, `<` ou aspas numa descrição/erro quebrava o card inteiro.
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtRelative(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

// ==================== ESTADO RETRÁTIL (mobile-first, 2026-08-23) ====================
// Persistência local do que está recolhido: hosts e cards de agente.
const LS_HOSTS_KEY = 'cm-collapsed-hosts';
const LS_AGENTS_KEY = 'cm-collapsed-agents';
const LS_AUTORESTART_KEY = 'cm-auto-restart';

function loadCollapsedSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); }
  catch { return new Set(); }
}

function saveCollapsedSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch {}
}

let collapsedHosts = loadCollapsedSet(LS_HOSTS_KEY);
let collapsedAgents = loadCollapsedSet(LS_AGENTS_KEY);

// Reiniciar o gateway após salvar. Ligado por padrão: sem reinício o Hermes continua com o
// modelo antigo em memória e a troca "não pega" — foi exatamente o bug relatado em 24/08.
function autoRestartEnabled() {
  const stored = localStorage.getItem(LS_AUTORESTART_KEY);
  return stored === null ? true : stored === '1';
}

function setAutoRestart(on) {
  try { localStorage.setItem(LS_AUTORESTART_KEY, on ? '1' : '0'); } catch {}
}

function toggleHost(pc) {
  const isOpen = !collapsedHosts.has(pc);
  setHostCollapsed(pc, isOpen, true);
}

function setHostCollapsed(pc, collapsed, persist) {
  const col = document.getElementById('col-' + pc);
  const chev = document.getElementById('chev-' + pc);
  const header = document.getElementById('header-' + pc);
  if (!col) return;
  col.classList.toggle('collapsed', collapsed);
  if (chev) chev.textContent = collapsed ? '▸' : '▾';
  if (header) header.setAttribute('aria-expanded', String(!collapsed));
  if (persist) {
    if (collapsed) collapsedHosts.add(pc); else collapsedHosts.delete(pc);
    saveCollapsedSet(LS_HOSTS_KEY, collapsedHosts);
  }
}

function toggleAgent(agentId) {
  const card = document.getElementById('card-' + agentId);
  if (!card) return;
  setAgentCollapsed(agentId, !card.classList.contains('collapsed'), true);
}

function setAgentCollapsed(agentId, collapsed, persist) {
  const card = document.getElementById('card-' + agentId);
  if (!card) return;
  card.classList.toggle('collapsed', collapsed);
  const body = card.querySelector('.agent-card-body');
  const chip = card.querySelector('.agent-current-chip');
  const chev = card.querySelector('.agent-chevron');
  const header = card.querySelector('.agent-card-header');
  if (body) body.classList.toggle('hidden', collapsed);
  if (chip) chip.classList.toggle('hidden', !collapsed);
  if (chev) chev.textContent = collapsed ? '▸' : '▾';
  if (header) header.setAttribute('aria-expanded', String(!collapsed));
  if (persist) {
    if (collapsed) collapsedAgents.add(agentId); else collapsedAgents.delete(agentId);
    saveCollapsedSet(LS_AGENTS_KEY, collapsedAgents);
  }
}

function applySavedCollapse() {
  ['server', 'acer', 'windows'].forEach((pc) => setHostCollapsed(pc, collapsedHosts.has(pc), false));
  fleetData.agents.forEach((a) => {
    if (collapsedAgents.has(a.id)) setAgentCollapsed(a.id, true, false);
  });
}

// Chip compacto com a configuração atual (visível quando o card está recolhido)
function updateAgentChip(agentId) {
  const card = document.getElementById('card-' + agentId);
  const chip = card ? card.querySelector('.agent-current-chip') : null;
  if (!chip) return;
  const mSel = document.getElementById('sel-model-' + agentId);
  const rSel = document.getElementById('sel-reasoning-' + agentId);
  const pSel = document.getElementById('sel-provider-' + agentId);
  const parts = [];
  if (pSel && pSel.selectedOptions[0]) parts.push(pSel.selectedOptions[0].textContent.split('(')[0].trim());
  if (mSel && mSel.value) parts.push(mSel.value + (rSel && rSel.value ? ' · ' + rSel.value : ''));
  chip.textContent = parts.length ? '⚙️ ' + parts.join(' → ') : '⚙️ configuração não definida';
}

/**
 * Marca o card quando a seleção na tela difere do que está gravado no config.yaml.
 * Evita o mal-entendido de "eu troquei o modelo" com o valor só escolhido no select.
 */
function updateDirtyState(agentId) {
  const card = document.getElementById('card-' + agentId);
  const agent = fleetData.agents.find((a) => a.id === agentId);
  if (!card || !agent) return;
  const mSel = document.getElementById('sel-model-' + agentId);
  const rSel = document.getElementById('sel-reasoning-' + agentId);
  const pSel = document.getElementById('sel-provider-' + agentId);
  const dirty =
    (mSel && mSel.value && mSel.value !== agent.model) ||
    (rSel && rSel.value && rSel.value !== agent.reasoningEffort) ||
    (pSel && pSel.value && agent.provider && pSel.value !== agent.provider);
  card.classList.toggle('dirty', !!dirty);
  const flag = card.querySelector('.unsaved-flag');
  if (flag) flag.classList.toggle('hidden', !dirty);
}

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
  startAutoRefresh();
});

async function initApp() {
  setLoading(true);
  try {
    await Promise.all([loadProviders(), loadFleetStatus(), loadAgents()]);
    renderApp();
    fleetData.lastUpdate = Date.now();
    updateLastUpdateLabel();
  } finally {
    setLoading(false);
  }
}

function setLoading(on) {
  fleetData.loading = on;
  document.body.classList.toggle('is-loading', on);
  const btn = document.getElementById('btn-refresh');
  if (btn) btn.disabled = on;
}

function updateLastUpdateLabel() {
  const el = document.getElementById('last-update');
  if (el) el.textContent = fleetData.lastUpdate ? 'atualizado ' + fmtRelative(fleetData.lastUpdate) : '';
}

// Recarrega o status da frota sozinho, sem atrapalhar quem está mexendo nos selects
function startAutoRefresh() {
  setInterval(() => {
    updateLastUpdateLabel();
    if (document.hidden || fleetData.loading) return;
    if (document.querySelector('.modal-overlay:not(.hidden)')) return;
    if (document.querySelector('.agent-card.dirty')) return;
    loadFleetStatus();
  }, 45000);
}

function setupEventListeners() {
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    await initApp();
    showToast('Dados atualizados.', 'info');
  });

  document.getElementById('btn-open-batch').addEventListener('click', () => {
    openModal('modal-batch');
    if (fleetData.providers.length && document.getElementById('batch-model').options.length === 0) {
      populateBatchCatalog();
    }
  });

  document.getElementById('btn-restart-all').addEventListener('click', restartAllFleet);
  document.getElementById('btn-heal-all').addEventListener('click', healAllFleet);
  document.getElementById('btn-execute-batch').addEventListener('click', executeBatchModel);

  document.getElementById('btn-refresh-log').addEventListener('click', () => {
    if (fleetData.currentLogHost) openLogs(fleetData.currentLogHost);
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    filterAgents(e.target.value.toLowerCase().trim());
  });

  document.getElementById('batch-provider').addEventListener('change', (e) => onBatchProviderChange(e.target.value));
  document.getElementById('batch-model').addEventListener('change', (e) => onBatchModelChange(e.target.value));
  document.getElementById('batch-target').addEventListener('change', updateBatchTargetWarning);

  const autoChk = document.getElementById('opt-auto-restart');
  if (autoChk) {
    autoChk.checked = autoRestartEnabled();
    autoChk.addEventListener('change', (e) => {
      setAutoRestart(e.target.checked);
      const batchChk = document.getElementById('batch-auto-restart');
      if (batchChk) batchChk.checked = e.target.checked;
      showToast(e.target.checked
        ? 'Salvar passará a reiniciar o gateway do PC (troca entra em vigor na hora).'
        : 'Salvar só gravará o arquivo — a troca só vale após reiniciar o gateway.', 'info');
    });
  }

  // Fechar modais/drawer com ESC ou clique fora
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach((m) => m.classList.add('hidden'));
    const drawer = document.getElementById('drawer-logs');
    if (drawer && !drawer.classList.contains('hidden')) closeLogs();
  });

  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  const drawer = document.getElementById('drawer-logs');
  if (drawer) {
    drawer.addEventListener('mousedown', (e) => {
      if (e.target === drawer) closeLogs();
    });
  }
}

// ==================== CARREGAMENTO DE DADOS ====================

async function apiFetch(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Resposta inesperada do servidor (HTTP ${res.status})`);
  }
  if (!res.ok && data.error) throw new Error(data.error);
  return data;
}

function findProviderByModel(modelId) {
  return fleetData.providers.find((p) => p.models.some((m) => m.id === modelId)) || null;
}

function findModelPresetLocal(modelId, providerId) {
  const list = providerId
    ? fleetData.providers.slice().sort((a, b) => (a.id === providerId ? -1 : b.id === providerId ? 1 : 0))
    : fleetData.providers;
  for (const p of list) {
    const m = p.models.find((mm) => mm.id === modelId);
    if (m) return { ...m, provider: p.id, providerName: p.name, baseUrl: p.baseUrl, keyEnv: p.keyEnv, availableOn: p.availableOn };
  }
  return null;
}

async function loadProviders() {
  try {
    const data = await apiFetch('/api/models/providers');
    if (data.success) {
      fleetData.providers = data.providers;
      if (data.degraded) showToast('Catálogo servido em modo base (relay indisponível).', 'info');
      populateBatchCatalog();
    }
  } catch (e) {
    showToast('Erro ao carregar provedores: ' + e.message, 'error');
  }
}

async function loadFleetStatus() {
  try {
    const data = await apiFetch('/api/fleet/status');
    if (data.success) {
      fleetData.hosts = data.hosts;
      updateHostStatusUI();
    }
  } catch (e) {
    showToast('Erro ao consultar status da frota: ' + e.message, 'error');
  }
}

async function loadAgents() {
  try {
    const data = await apiFetch('/api/agents');
    if (data.success) {
      fleetData.agents = data.agents;
      document.getElementById('stat-agents-count').textContent = data.agents.length;
      const pend = data.agents.filter((a) => a.pendingRestart).length;
      const el = document.getElementById('stat-pending');
      if (el) {
        el.textContent = pend;
        el.parentElement.classList.toggle('hidden', pend === 0);
      }
    }
  } catch (e) {
    showToast('Erro ao carregar agentes: ' + e.message, 'error');
  }
}

// ==================== RENDERIZAÇÃO ====================

function renderApp() {
  renderAgentsByHost('server');
  renderAgentsByHost('acer');
  renderAgentsByHost('windows');
  const term = document.getElementById('search-input').value.toLowerCase().trim();
  if (term) filterAgents(term);
}

function updateHostStatusUI() {
  let onlineCount = 0;
  ['server', 'acer', 'windows'].forEach((hostKey) => {
    const h = fleetData.hosts[hostKey];
    if (!h) return;

    if (h.online) onlineCount++;

    const badge = document.getElementById('status-badge-' + hostKey);
    const gwEl = document.getElementById('gw-' + hostKey);

    if (badge) {
      badge.className = 'host-status-badge ' + (h.online ? '' : 'offline');
      badge.title = h.error || '';
      badge.innerHTML = '<span class="dot ' + (h.online ? 'dot-online' : 'dot-offline') + '"></span> ' +
        (h.online ? 'Online' + (h.latencyMs !== null ? ' (' + esc(h.latencyMs) + 'ms)' : '') : 'Offline');
    }

    if (gwEl) {
      gwEl.textContent = h.gatewayRunning ? 'Ativo 🟢' : (h.online ? 'Inativo 🔴' : 'Indisponível');
      gwEl.title = h.gatewayDetail ? 'Detalhe: ' + h.gatewayDetail : '';
    }
  });

  document.getElementById('stat-online-hosts').textContent = onlineCount + '/3';
}

// Options de providers válidos para um dado PC (tem credencial naquela máquina)
function providerOptionsForPC(pc) {
  return fleetData.providers
    .filter((p) => p.availableOn.includes(pc))
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.badge)})</option>`)
    .join('');
}

// Helper: formata contexto para exibição (ex.: 1M, 262K)
function fmtCtx(ctx) {
  if (!ctx) return '';
  if (ctx >= 1000000) {
    const v = ctx / 1000000;
    return (v >= 10 ? Math.round(v) : v % 1 === 0 ? v : v.toFixed(2)) + 'M';
  }
  return Math.round(ctx / 1000) + 'K';
}

// Rótulo compacto de modelo: nome + (ctx) + indicador free/custo
function modelLabel(m) {
  let s = m.name;
  if (m.contextLength) s += ` · ${fmtCtx(m.contextLength)}`;
  if (m.free) s += ' · ⭐GRÁTIS';
  return s;
}

function reasonHintLevel(modelId) {
  const p = findModelPresetLocal(modelId);
  if (!p) return '';
  const bits = [];
  if (p.free) bits.push('⭐ GRÁTIS');
  if (p.contextLength) bits.push('ctx ' + fmtCtx(p.contextLength));
  if (p.costInput != null && !p.free) bits.push('US$' + fmtCost(p.costInput) + '/M in');
  return bits.length ? ' · ' + bits.join(' · ') : '';
}

function fmtCost(v) {
  if (v == null) return '';
  return v >= 0.01 ? String(v) : String(Math.round(v * 10000) / 10000);
}

// Modelos de um provider
function modelOptionsForProvider(providerId) {
  const p = fleetData.providers.find((pp) => pp.id === providerId);
  if (!p) return '';
  return p.models.map((m) => `<option value="${esc(m.id)}">${esc(modelLabel(m))}</option>`).join('');
}

function renderAgentsByHost(pc) {
  const container = document.getElementById('agents-' + pc);
  if (!container) return;

  const agents = fleetData.agents.filter((a) => a.pc === pc);
  container.innerHTML = '';

  if (agents.length === 0) {
    container.innerHTML = '<div class="agents-empty">Nenhum agente carregado para este PC.</div>';
    updateHostCounts();
    return;
  }

  agents.forEach((agent) => {
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.id = 'card-' + agent.id;
    card.dataset.name = (agent.name + ' ' + agent.channel + ' ' + agent.profile + ' ' + (agent.model || '')).toLowerCase();

    // O provider exibido vem do que está GRAVADO no config. Antes era deduzido do modelo, e
    // como o mesmo id existe em mais de um provedor (ex.: deepseek-v4-pro está no opencode-go
    // e no deepseek-standard), o painel mostrava o provedor errado.
    const providerFromConfig = agent.provider && fleetData.providers.some((p) => p.id === agent.provider)
      ? fleetData.providers.find((p) => p.id === agent.provider)
      : null;
    const knownProvider = providerFromConfig || findProviderByModel(agent.model);
    const providerOptions = providerOptionsForPC(pc);
    const providerMissingKey = knownProvider && !providerOptions.includes(`value="${knownProvider.id}"`);

    const providerSel = `
      <div class="selector-group">
        <label for="sel-provider-${esc(agent.id)}">Provedor:</label>
        <select id="sel-provider-${esc(agent.id)}" class="form-control" onchange="onAgentProviderChange('${esc(agent.id)}')">
          ${providerOptions}
          ${providerMissingKey ? `<option value="${esc(knownProvider.id)}">${esc(knownProvider.name)} (sem chave neste PC)</option>` : ''}
          ${!knownProvider && agent.provider ? `<option value="${esc(agent.provider)}">${esc(agent.provider)} (fora do catálogo)</option>` : ''}
        </select>
      </div>`;

    const statusRow = buildAgentStatusRow(agent);

    card.innerHTML = `
      <div class="agent-card-header" onclick="toggleAgent('${esc(agent.id)}')" role="button" tabindex="0" aria-expanded="true" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleAgent('${esc(agent.id)}');}">
        <div class="agent-channel-info">
          <div class="agent-channel-title"><span class="agent-chevron">▾</span> <span>${esc(agent.channel)}</span></div>
          <div class="agent-channel-desc">${esc(agent.description)}</div>
          <span class="agent-current-chip hidden"></span>
        </div>
        <span class="channel-id-badge" title="Clique para copiar o ID do canal" onclick="event.stopPropagation();copyToClipboard('${esc(agent.channelId)}')">ID: ${esc(agent.channelId.slice(0, 7))}...</span>
      </div>

      <div class="agent-card-body">
      ${statusRow}
      <div class="agent-selectors agent-selectors-3col">
        ${providerSel}
        <div class="selector-group">
          <label for="sel-model-${esc(agent.id)}">Modelo:</label>
          <select id="sel-model-${esc(agent.id)}" class="form-control" onchange="onAgentModelChange('${esc(agent.id)}')">
            <option value="">Selecione o modelo...</option>
          </select>
        </div>
        <div class="selector-group">
          <label for="sel-reasoning-${esc(agent.id)}">Reasoning:</label>
          <select id="sel-reasoning-${esc(agent.id)}" class="form-control" onchange="onAgentReasoningChange('${esc(agent.id)}')">
            <option value="">Selecione o modelo...</option>
          </select>
        </div>
      </div>

      <div class="agent-card-actions">
        <button class="btn-xs btn-test" onclick="testAgent('${esc(agent.pc)}', '${esc(agent.profile)}')" title="Testar chamada real do modelo">🧪 Testar</button>
        <button class="btn-xs btn-save" id="btn-save-${esc(agent.id)}" onclick="saveAgentModel('${esc(agent.pc)}', '${esc(agent.profile)}', '${esc(agent.id)}')" title="Grava no config.yaml (com backup) e aplica no gateway">💾 Salvar</button>
      </div>
      </div><!-- /.agent-card-body -->
    `;

    container.appendChild(card);

    // Popula os selects em cascata para o estado atual
    const pSel = document.getElementById('sel-provider-' + agent.id);
    const providerId = (knownProvider && knownProvider.id) || agent.provider || (fleetData.providers[0] && fleetData.providers[0].id);
    if (pSel && [...pSel.options].some((o) => o.value === providerId)) pSel.value = providerId;

    refreshAgentModelOptions(agent.id, pSel ? pSel.value : providerId);

    const mSel = document.getElementById('sel-model-' + agent.id);
    if (mSel && agent.model) {
      if (![...mSel.options].some((o) => o.value === agent.model)) {
        const opt = document.createElement('option');
        opt.value = agent.model;
        opt.textContent = agent.model + ' (fora do catálogo)';
        mSel.appendChild(opt);
      }
      mSel.value = agent.model;
      refreshAgentReasoningOptions(agent.id);
      const rSel = document.getElementById('sel-reasoning-' + agent.id);
      if (rSel && agent.reasoningEffort) {
        if (![...rSel.options].some((o) => o.value === agent.reasoningEffort)) {
          const opt = document.createElement('option');
          opt.value = agent.reasoningEffort;
          opt.textContent = agent.reasoningEffort + ' (atual, fora da lista do modelo)';
          rSel.appendChild(opt);
        }
        rSel.value = agent.reasoningEffort;
      }
    }
    updateAgentChip(agent.id);
    updateDirtyState(agent.id);
  });

  applySavedCollapse();
  updateHostCounts();
}

/**
 * Faixa de estado do agente: erro de leitura, chaves faltando no YAML e — o principal —
 * o aviso de "gravado mas ainda não aplicado" com o botão de reiniciar o gateway.
 */
function buildAgentStatusRow(agent) {
  const rows = [];

  if (agent.error) {
    rows.push(`<div class="agent-alert alert-error">⚠️ ${esc(agent.error)}</div>`);
  }

  if (agent.missing && agent.missing.length) {
    rows.push(`<div class="agent-alert alert-warn">📄 Faltam no config.yaml: <code>${esc(agent.missing.join(', '))}</code> — serão criadas ao salvar.</div>`);
  }

  if (agent.pendingRestart) {
    rows.push(`
      <div class="agent-alert alert-pending">
        <span>⏳ Gravado ${esc(fmtRelative(agent.lastWriteAt))}, <strong>ainda não aplicado</strong> — o Hermes só lê o config ao subir.</span>
        <button class="btn-xs btn-apply" onclick="restartHost('${esc(agent.pc)}')">🔄 Aplicar agora (reiniciar ${esc(agent.pc)})</button>
      </div>`);
  }

  rows.push(`<div class="agent-saved-line">
      No arquivo: <code>${esc(agent.model || 'não definido')}</code>
      ${agent.reasoningEffort ? '· <code>' + esc(agent.reasoningEffort) + '</code>' : ''}
      ${agent.provider ? '· ' + esc(agent.provider) : ''}
      <span class="unsaved-flag hidden">• alteração não salva</span>
    </div>`);

  return rows.join('');
}

function updateHostCounts() {
  ['server', 'acer', 'windows'].forEach((pc) => {
    const el = document.getElementById('count-' + pc);
    if (!el) return;
    const n = fleetData.agents.filter((a) => a.pc === pc).length;
    el.textContent = n > 0 ? `(${n} agente${n > 1 ? 's' : ''}) ·` : '';
  });
}

function toggleAllHosts(expand) {
  ['server', 'acer', 'windows'].forEach((pc) => setHostCollapsed(pc, !expand, true));
}

function refreshAgentModelOptions(agentId, providerId) {
  const mSel = document.getElementById('sel-model-' + agentId);
  const rSel = document.getElementById('sel-reasoning-' + agentId);
  if (!mSel) return;
  const opts = modelOptionsForProvider(providerId);
  mSel.innerHTML = '<option value="">Selecione o modelo...</option>' + opts;
  if (rSel) rSel.innerHTML = '<option value="">Selecione o modelo...</option>';
}

function refreshAgentReasoningOptions(agentId) {
  const mSel = document.getElementById('sel-model-' + agentId);
  const rSel = document.getElementById('sel-reasoning-' + agentId);
  const pSel = document.getElementById('sel-provider-' + agentId);
  if (!mSel || !rSel) return;
  const preset = findModelPresetLocal(mSel.value, pSel ? pSel.value : null);
  if (!preset) {
    rSel.innerHTML = '<option value="">Selecione o modelo...</option>';
    rSel.title = '';
    return;
  }
  rSel.innerHTML = preset.allowedReasoning.map((lvl) => `<option value="${esc(lvl)}">${esc(lvl)}</option>`).join('');
  rSel.value = preset.defaultReasoning;
  const info = [];
  if (preset.free) info.push('⭐ GRÁTIS');
  if (preset.contextLength) info.push('ctx ' + fmtCtx(preset.contextLength));
  if (preset.costInput != null && !preset.free) info.push('US$' + fmtCost(preset.costInput) + '/M in');
  mSel.title = info.length ? mSel.value + ' — ' + info.join(' • ') : mSel.value;
  if (pSel) pSel.title = pSel.value;
}

function onAgentProviderChange(agentId) {
  const pSel = document.getElementById('sel-provider-' + agentId);
  refreshAgentModelOptions(agentId, pSel.value);
  updateAgentChip(agentId);
  updateDirtyState(agentId);
}

function onAgentModelChange(agentId) {
  refreshAgentReasoningOptions(agentId);
  updateAgentChip(agentId);
  updateDirtyState(agentId);
}

function onAgentReasoningChange(agentId) {
  updateAgentChip(agentId);
  updateDirtyState(agentId);
}

// ==================== CATÁLOGO LOTE (Cascata) ====================

function populateBatchCatalog() {
  const pSel = document.getElementById('batch-provider');
  if (!pSel || fleetData.providers.length === 0) return;
  pSel.innerHTML = fleetData.providers.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.badge)})</option>`).join('');
  onBatchProviderChange(pSel.value);
  const batchChk = document.getElementById('batch-auto-restart');
  if (batchChk) batchChk.checked = autoRestartEnabled();
}

function onBatchProviderChange(providerId) {
  const mSel = document.getElementById('batch-model');
  if (!mSel) return;
  const opts = modelOptionsForProvider(providerId);
  mSel.innerHTML = opts ? '<option value="">Selecione o modelo...</option>' + opts : '<option value="">Nenhum modelo</option>';
  const hint = document.getElementById('batch-provider-hint');
  const p = fleetData.providers.find((pp) => pp.id === providerId);
  if (hint && p) {
    hint.textContent = 'Disponível em: ' + p.availableOn.join(', ') + ' • (chave: ' + p.keyEnv + ')';
  }
  updateBatchTargetWarning();
  onBatchModelChange(mSel.value);
}

function onBatchModelChange(modelId) {
  const rSel = document.getElementById('batch-reasoning');
  const hint = document.getElementById('batch-reasoning-hint');
  if (!rSel || !modelId) {
    if (rSel) rSel.innerHTML = '<option value="">Selecione o modelo...</option>';
    if (hint) hint.textContent = 'Selecione o modelo para ver os níveis aceitos.';
    return;
  }
  const pSel = document.getElementById('batch-provider');
  const preset = findModelPresetLocal(modelId, pSel ? pSel.value : null);
  if (!preset) return;
  rSel.innerHTML = preset.allowedReasoning.map((lvl) => `<option value="${esc(lvl)}">${esc(lvl + explainReasoning(lvl))}</option>`).join('');
  rSel.value = preset.defaultReasoning;
  if (hint) hint.textContent = 'Níveis aceitos por ' + modelId + ': ' + preset.allowedReasoning.join(', ') + reasonHintLevel(modelId) + '.';
  updateBatchTargetWarning();
}

// Avisa ANTES de mandar: o backend recusa lote em PC sem a credencial do provedor
function updateBatchTargetWarning() {
  const warn = document.getElementById('batch-target-warning');
  if (!warn) return;
  const provider = fleetData.providers.find((p) => p.id === document.getElementById('batch-provider').value);
  const target = document.getElementById('batch-target').value;
  if (!provider) { warn.classList.add('hidden'); return; }
  const pcs = target === 'all' ? ['server', 'acer', 'windows'] : [target];
  const missing = pcs.filter((pc) => !provider.availableOn.includes(pc));
  if (missing.length) {
    warn.textContent = `⚠️ ${provider.name} não tem credencial em: ${missing.join(', ')}. Escolha outro alvo ou outro provedor.`;
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }
}

function explainReasoning(level) {
  const map = {
    none: ' (sem raciocínio)',
    low: ' (baixo/rápido)',
    medium: ' (médio)',
    high: ' (alto)',
    max: ' (máximo/profundo)'
  };
  return map[level] || '';
}

function filterAgents(term) {
  const cards = document.querySelectorAll('.agent-card');
  cards.forEach((card) => {
    const id = card.id.replace('card-', '');
    const text = card.dataset.name || '';
    const match = !term || text.includes(term);
    card.classList.toggle('filtered-out', !match);
    if (term && match) {
      setAgentCollapsed(id, false, false);
      const col = card.closest('.host-column');
      if (col) setHostCollapsed(col.id.replace('col-', ''), false, false);
    }
  });
  // Esconde a coluna cujo host ficou sem nenhum card visível
  ['server', 'acer', 'windows'].forEach((pc) => {
    const col = document.getElementById('col-' + pc);
    if (!col) return;
    const visible = col.querySelectorAll('.agent-card:not(.filtered-out)').length;
    col.classList.toggle('no-match', !!term && visible === 0);
  });
}

// ==================== AÇÕES E APIS ====================

function setButtonBusy(btn, busy, busyLabel) {
  if (!btn) return;
  if (busy) {
    btn.dataset.originalLabel = btn.dataset.originalLabel || btn.innerHTML;
    btn.innerHTML = busyLabel || '⏳ Aguarde...';
    btn.disabled = true;
  } else {
    if (btn.dataset.originalLabel) btn.innerHTML = btn.dataset.originalLabel;
    btn.disabled = false;
  }
}

async function saveAgentModel(pc, profile, agentId) {
  const modelSelect = document.getElementById('sel-model-' + agentId);
  const reasoningSelect = document.getElementById('sel-reasoning-' + agentId);
  const providerSelect = document.getElementById('sel-provider-' + agentId);
  const btn = document.getElementById('btn-save-' + agentId);

  const model = modelSelect ? modelSelect.value : null;
  const reasoningEffort = reasoningSelect ? reasoningSelect.value : null;
  const provider = providerSelect ? providerSelect.value : null;

  if (!model) {
    showToast('Selecione um modelo antes de salvar.', 'error');
    return;
  }

  const restart = autoRestartEnabled();
  if (restart && !confirm(
    `Salvar "${model}" (${reasoningEffort || 'padrão'}) neste agente e REINICIAR o gateway de "${pc}"?\n\n` +
    `O reinício é o que faz a troca valer — mas derruba momentaneamente todos os agentes desse PC.`
  )) return;

  const preset = findModelPresetLocal(model, provider) || {};
  const baseUrl = preset.baseUrl || '';

  setButtonBusy(btn, true, restart ? '⏳ Salvando e aplicando...' : '⏳ Salvando...');
  try {
    const data = await apiFetch('/api/agents/' + pc + '/' + profile + '/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, provider, baseUrl, reasoningEffort, restart })
    });

    if (data.success) {
      const level = data.restart && !data.restart.success ? 'error' : (data.pendingRestart ? 'info' : 'success');
      showToast(data.message, level);
      if (data.insertedKeys && data.insertedKeys.length) {
        showToast('Chaves criadas no YAML: ' + data.insertedKeys.join(', '), 'info');
      }
      await Promise.all([loadAgents(), loadFleetStatus()]);
      renderApp();
    } else {
      showToast('Erro ao salvar: ' + (data.error || 'desconhecido'), 'error');
    }
  } catch (e) {
    showToast('Falha ao salvar: ' + e.message, 'error');
  } finally {
    setButtonBusy(btn, false);
  }
}

async function executeBatchModel() {
  const target = document.getElementById('batch-target').value;
  const model = document.getElementById('batch-model').value;
  const reasoningEffort = document.getElementById('batch-reasoning').value;
  const provider = document.getElementById('batch-provider').value;
  const restart = document.getElementById('batch-auto-restart').checked;
  const btn = document.getElementById('btn-execute-batch');

  if (!model) {
    showToast('Selecione um modelo para aplicar em lote.', 'error');
    return;
  }

  const alvo = target === 'all' ? 'TODA a frota (13 agentes nos 3 PCs)' : `todos os agentes de "${target}"`;
  if (!confirm(`Aplicar "${model}" (${reasoningEffort}) em ${alvo}?` + (restart ? '\n\nOs gateways afetados serão reiniciados em seguida.' : '\n\nSem reinício: a troca só valerá quando os gateways subirem de novo.'))) return;

  const preset = findModelPresetLocal(model, provider) || {};
  const baseUrl = preset.baseUrl || '';

  setButtonBusy(btn, true, '⏳ Aplicando...');
  try {
    const data = await apiFetch('/api/agents/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, model, provider, baseUrl, reasoningEffort, restart })
    });

    if (data.success) {
      closeModal('modal-batch');
      showToast(`Lote concluído: ${data.updatedCount}/${data.totalAttempted} agentes gravados.`, 'success');
    } else if (data.partial) {
      showToast(`Lote parcial: ${data.updatedCount}/${data.totalAttempted} gravados.`, 'error');
      (data.errors || []).forEach((err) => showToast(`${err.name || err.agent}: ${err.error}`, 'error'));
    } else {
      showToast('Lote não aplicado: ' + (data.error || (data.errors || []).map((e) => e.error).join('; ')), 'error');
    }

    if (data.restarts) {
      Object.entries(data.restarts).forEach(([pc, r]) => {
        showToast(`Gateway ${pc}: ${r.success ? 'reiniciado ✅' : 'FALHA ao reiniciar ❌ ' + (r.output || '')}`, r.success ? 'success' : 'error');
      });
    }

    await initApp();
  } catch (e) {
    showToast('Falha ao executar lote: ' + e.message, 'error');
  } finally {
    setButtonBusy(btn, false);
  }
}

async function testAgent(pc, profile) {
  openModal('modal-test');
  document.getElementById('test-modal-title').textContent = '🧪 Teste de Conexão: ' + pc + ' / ' + profile;
  document.getElementById('test-spinner').classList.remove('hidden');
  document.getElementById('test-result-box').classList.add('hidden');

  try {
    const data = await apiFetch('/api/fleet/test-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pc, profile })
    });
    document.getElementById('test-output').textContent = data.output || 'Nenhuma saída retornada.';
  } catch (e) {
    document.getElementById('test-output').textContent = 'Erro ao executar teste: ' + e.message;
  } finally {
    document.getElementById('test-spinner').classList.add('hidden');
    document.getElementById('test-result-box').classList.remove('hidden');
  }
}

async function restartHost(pc) {
  if (!confirm('Reiniciar o Hermes Gateway no host "' + pc + '"?\n\nTodos os agentes desse PC ficam alguns segundos fora do ar e voltam já com a configuração nova.')) return;

  try {
    showToast('Reiniciando gateway em ' + pc + '...', 'info');
    const data = await apiFetch('/api/fleet/restart/' + pc, { method: 'POST' });
    if (data.success) {
      showToast(data.message, 'success');
    } else {
      showToast('Falha ao reiniciar: ' + (data.error || (data.details && data.details.error) || 'erro desconhecido'), 'error');
    }
    setTimeout(async () => {
      await Promise.all([loadFleetStatus(), loadAgents()]);
      renderApp();
    }, 2500);
  } catch (e) {
    showToast('Erro na requisição: ' + e.message, 'error');
  }
}

async function restartAllFleet() {
  if (!confirm('Reiniciar o Hermes Gateway em TODOS os 3 computadores da frota?')) return;

  const btn = document.getElementById('btn-restart-all');
  setButtonBusy(btn, true, '⏳ Reiniciando...');
  try {
    const data = await apiFetch('/api/fleet/restart/all', { method: 'POST' });
    showToast(data.message || 'Reinício disparado.', data.success ? 'success' : 'error');
    Object.entries(data.results || {}).forEach(([pc, r]) => {
      if (!r.success) showToast(`Gateway ${pc}: falha — ${r.output || 'sem detalhe'}`, 'error');
    });
    setTimeout(async () => {
      await Promise.all([loadFleetStatus(), loadAgents()]);
      renderApp();
    }, 3000);
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  } finally {
    setButtonBusy(btn, false);
  }
}

async function healHost(pc) {
  try {
    showToast('Executando cura de perfis em ' + pc + '...', 'info');
    const data = await apiFetch('/api/fleet/heal/' + pc, { method: 'POST' });
    showToast(data.success ? 'Cura concluída em ' + pc + '.' : 'Erro na cura: ' + (data.error || 'desconhecido'), data.success ? 'success' : 'error');
  } catch (e) {
    showToast('Falha na requisição: ' + e.message, 'error');
  }
}

async function healAllFleet() {
  const btn = document.getElementById('btn-heal-all');
  setButtonBusy(btn, true, '⏳ Curando...');
  try {
    const data = await apiFetch('/api/fleet/heal/all', { method: 'POST' });
    showToast(data.message || 'Cura executada.', data.success ? 'success' : 'error');
    Object.entries(data.results || {}).forEach(([pc, r]) => {
      if (!r.success) showToast(`Cura em ${pc}: falhou — ${r.output || 'sem detalhe'}`, 'error');
    });
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  } finally {
    setButtonBusy(btn, false);
  }
}

async function openLogs(pc) {
  fleetData.currentLogHost = pc;
  const drawer = document.getElementById('drawer-logs');
  const title = document.getElementById('drawer-logs-title');
  const content = document.getElementById('drawer-logs-content');

  drawer.classList.remove('hidden');
  title.textContent = '📋 Logs do Gateway — ' + pc;
  content.textContent = 'Carregando últimas linhas de log...';

  try {
    const data = await apiFetch('/api/fleet/logs/' + pc);
    content.textContent = data.logs || 'Sem registros de log recentes.';
    content.scrollTop = content.scrollHeight;
  } catch (e) {
    content.textContent = 'Erro ao carregar logs: ' + e.message;
  }
}

function closeLogs() {
  document.getElementById('drawer-logs').classList.add('hidden');
}

// ==================== MODALS & UTILS ====================

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

let lastToast = { msg: null, ts: 0 };

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const text = String(message == null ? '' : message);

  // Mesma mensagem repetida em menos de 3s não empilha (o lote disparava dezenas)
  if (lastToast.msg === text && Date.now() - lastToast.ts < 3000) return;
  lastToast = { msg: text, ts: Date.now() };

  while (container.children.length >= 5) container.removeChild(container.firstChild);

  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  const icon = document.createElement('span');
  icon.textContent = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  const body = document.createElement('span');
  body.textContent = text; // textContent: mensagem do servidor nunca vira HTML
  toast.append(icon, body);
  toast.addEventListener('click', () => toast.remove());

  container.appendChild(toast);
  const ttl = type === 'error' ? 9000 : 4500;
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, ttl);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('ID copiado: ' + text, 'info');
  } catch {
    // clipboard API exige contexto seguro; fallback para seleção manual
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('ID copiado: ' + text, 'info'); }
    catch { showToast('Não foi possível copiar automaticamente: ' + text, 'error'); }
    ta.remove();
  }
}
