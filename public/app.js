// Estado global da aplicação
let fleetData = {
  agents: [],
  providers: [],
  hosts: {},
  currentLogHost: null
};

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
});

async function initApp() {
  await Promise.all([loadProviders(), loadFleetStatus(), loadAgents()]);
  renderApp();
}

function setupEventListeners() {
  document.getElementById('btn-refresh').addEventListener('click', () => {
    initApp();
    showToast('Dados atualizados com sucesso!', 'info');
  });

  document.getElementById('btn-open-batch').addEventListener('click', () => {
    openModal('modal-batch');
    // Popula o catálogo no modal se ainda não tiver sido carregado
    if (fleetData.providers.length && document.getElementById('batch-model').options.length === 0) {
      populateBatchCatalog();
    }
  });

  document.getElementById('btn-restart-all').addEventListener('click', () => {
    restartAllFleet();
  });

  document.getElementById('btn-heal-all').addEventListener('click', () => {
    healAllFleet();
  });

  document.getElementById('btn-execute-batch').addEventListener('click', () => {
    executeBatchModel();
  });

  document.getElementById('btn-refresh-log').addEventListener('click', () => {
    if (fleetData.currentLogHost) {
      openLogs(fleetData.currentLogHost);
    }
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    filterAgents(e.target.value.toLowerCase());
  });

  document.getElementById('batch-provider').addEventListener('change', (e) => {
    onBatchProviderChange(e.target.value);
  });

  document.getElementById('batch-model').addEventListener('change', (e) => {
    onBatchModelChange(e.target.value);
  });
}

// ==================== CARREGAMENTO DE DADOS ====================

function findProviderByModel(modelId) {
  return fleetData.providers.find((p) => p.models.some((m) => m.id === modelId)) || null;
}

function findModelPresetLocal(modelId) {
  for (const p of fleetData.providers) {
    const m = p.models.find((mm) => mm.id === modelId);
    if (m) return { ...m, provider: p.id, providerName: p.name, baseUrl: p.baseUrl, keyEnv: p.keyEnv, availableOn: p.availableOn };
  }
  return null;
}

async function loadProviders() {
  try {
    const res = await fetch('/api/models/providers');
    const data = await res.json();
    if (data.success) {
      fleetData.providers = data.providers;
      populateBatchCatalog();
    }
  } catch (e) {
    showToast('Erro ao carregar provedores: ' + e.message, 'error');
  }
}

async function loadFleetStatus() {
  try {
    const res = await fetch('/api/fleet/status');
    const data = await res.json();
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
    const res = await fetch('/api/agents');
    const data = await res.json();
    if (data.success) {
      fleetData.agents = data.agents;
      document.getElementById('stat-agents-count').textContent = data.agents.length;
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
      badge.innerHTML = '<span class="dot ' + (h.online ? 'dot-online' : 'dot-offline') + '"></span> ' + (h.online ? 'Online' + (h.latencyMs !== null ? ' (' + h.latencyMs + 'ms)' : '') : 'Offline');
    }

    if (gwEl) {
      gwEl.textContent = h.gatewayRunning ? 'Ativo 🟢' : (h.online ? 'Inativo 🔴' : 'Indisponível');
    }
  });

  document.getElementById('stat-online-hosts').textContent = onlineCount + '/3';
}

// Options de providers válidos para um dado PC (tem credencial naquela máquina)
function providerOptionsForPC(pc) {
  return fleetData.providers
    .filter((p) => p.availableOn.includes(pc))
    .map((p) => `<option value="${p.id}">${p.name} (${p.badge})</option>`)
    .join('');
}

// Helper: formata contexto para exibição (ex.: 1M, 262K, 105M -> 1.05M)
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

// Rótulo de reasoning com dica do contexto do modelo
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
  return v >= 0.1 ? String(v) : v >= 0.01 ? String(v) : String(Math.round(v * 10000) / 10000);
}

// Modelos de um provider (filtrados por PC, se informado)
function modelOptionsForProvider(providerId, pc) {
  const p = fleetData.providers.find((pp) => pp.id === providerId);
  if (!p) return '';
  return p.models.map((m) => {
    const label = modelLabel(m).replace(/'/g, "\\'");
    return `<option value="${m.id}">${label}</option>`;
  }).join('');
}

function renderAgentsByHost(pc) {
  const container = document.getElementById('agents-' + pc);
  if (!container) return;

  const agents = fleetData.agents.filter((a) => a.pc === pc);
  container.innerHTML = '';

  agents.forEach((agent) => {
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.id = 'card-' + agent.id;
    card.dataset.name = (agent.name + ' ' + agent.channel + ' ' + agent.profile).toLowerCase();

    const providerOptions = providerOptionsForPC(pc);
    // Se o provider atual do agente não tem credencial no PC, ainda mostra como opção custom
    const knownProvider = findProviderByModel(agent.model);

    const providerSel = `
      <div class="selector-group">
        <label>Provedor:</label>
        <select id="sel-provider-${agent.id}" class="form-control" onchange="onAgentProviderChange('${agent.id}')">
          ${providerOptions}
          ${knownProvider && !providerOptions.includes(`value="${knownProvider.id}"`) ? `<option value="${knownProvider.id}" selected>${knownProvider.name} (sem chave)</option>` : ''}
        </select>
      </div>`;

    card.innerHTML = `
      <div class="agent-card-header">
        <div class="agent-channel-info">
          <div class="agent-channel-title"><span>${agent.channel}</span></div>
          <div class="agent-channel-desc">${agent.description}</div>
        </div>
        <span class="channel-id-badge" title="Clique para copiar o ID do canal" onclick="copyToClipboard('${agent.channelId}')">ID: ${agent.channelId.slice(0, 7)}...</span>
      </div>

      <div class="agent-selectors agent-selectors-3col">
        ${providerSel}
        <div class="selector-group">
          <label>Modelo:</label>
          <select id="sel-model-${agent.id}" class="form-control" onchange="onAgentModelChange('${agent.id}', this.value)">
            <option value="">Selecione o modelo...</option>
          </select>
        </div>
        <div class="selector-group">
          <label>Reasoning:</label>
          <select id="sel-reasoning-${agent.id}" class="form-control">
            <option value="">Selecione o modelo...</option>
          </select>
        </div>
      </div>

      <div class="agent-card-actions">
        <button class="btn-xs btn-test" onclick="testAgent('${agent.pc}', '${agent.profile}')" title="Testar chamada real do modelo">🧪 Testar</button>
        <button class="btn-xs btn-save" onclick="saveAgentModel('${agent.pc}', '${agent.profile}', '${agent.id}')" title="Salvar configurações e criar backup">💾 Salvar</button>
      </div>
    `;

    container.appendChild(card);

    // Popula os selects em cascata para o estado atual
    const pSel = document.getElementById('sel-provider-' + agent.id);
    const providerId = knownProvider ? knownProvider.id : (fleetData.providers[0] && fleetData.providers[0].id);
    if (pSel) pSel.value = providerId;
    refreshAgentModelOptions(agent.id, providerId);
    const mSel = document.getElementById('sel-model-' + agent.id);
    if (mSel && agent.model) {
      if ([...mSel.options].some((o) => o.value === agent.model)) {
        mSel.value = agent.model;
      } else {
        const opt = document.createElement('option');
        opt.value = agent.model;
        opt.textContent = agent.model + ' (custom)';
        mSel.appendChild(opt);
        mSel.value = agent.model;
      }
      refreshAgentReasoningOptions(agent.id);
      const rSel = document.getElementById('sel-reasoning-' + agent.id);
      if (rSel && agent.reasoningEffort) {
        if ([...rSel.options].some((o) => o.value === agent.reasoningEffort)) {
          rSel.value = agent.reasoningEffort;
        } else {
          const opt = document.createElement('option');
          opt.value = agent.reasoningEffort;
          opt.textContent = agent.reasoningEffort + ' (atual)';
          rSel.appendChild(opt);
          rSel.value = agent.reasoningEffort;
        }
      }
    }
  });
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
  if (!mSel || !rSel) return;
  const preset = findModelPresetLocal(mSel.value);
  if (!preset) {
    rSel.innerHTML = '<option value="">Selecione o modelo...</option>';
    rSel.title = '';
    return;
  }
  rSel.innerHTML = preset.allowedReasoning.map((lvl) => `<option value="${lvl}">${lvl}</option>`).join('');
  rSel.value = preset.defaultReasoning;
  // tooltip com contexto/custo próximo ao seletor de modelo
  const pSel = document.getElementById('sel-provider-' + agentId);
  const info = [];
  if (preset.free) info.push('⭐ GRÁTIS');
  if (preset.contextLength) info.push('ctx ' + fmtCtx(preset.contextLength));
  if (preset.costInput != null && !preset.free) info.push('US$' + fmtCost(preset.costInput) + '/M in');
  if (info.length) {
    mSel.title = mSel.value + ' — ' + info.join(' • ');
    if (pSel) pSel.title = pSel.value;
  }
}

function onAgentProviderChange(agentId) {
  const pSel = document.getElementById('sel-provider-' + agentId);
  refreshAgentModelOptions(agentId, pSel.value);
}

function onAgentModelChange(agentId, selectedModel) {
  refreshAgentReasoningOptions(agentId);
}

// ==================== CATÁLOGO LOTE (Cascata) ====================

function populateBatchCatalog() {
  const pSel = document.getElementById('batch-provider');
  if (!pSel || fleetData.providers.length === 0) return;
  pSel.innerHTML = fleetData.providers.map((p) => `<option value="${p.id}">${p.name} (${p.badge})</option>`).join('');
  onBatchProviderChange(pSel.value);
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
  const preset = findModelPresetLocal(modelId);
  if (!preset) return;
  rSel.innerHTML = preset.allowedReasoning.map((lvl) => `<option value="${lvl}">${lvl}${explainReasoning(lvl)}</option>`).join('');
  rSel.value = preset.defaultReasoning;
  if (hint) hint.textContent = '⚠️ Níveis aceitos por ' + modelId + ': ' + preset.allowedReasoning.join(', ') + reasonHintLevel(modelId) + '.';
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
    const text = card.dataset.name || '';
    card.style.display = text.includes(term) ? 'flex' : 'none';
  });
}

// ==================== AÇÕES E APIS ====================

async function saveAgentModel(pc, profile, agentId) {
  const modelSelect = document.getElementById('sel-model-' + agentId);
  const reasoningSelect = document.getElementById('sel-reasoning-' + agentId);
  const providerSelect = document.getElementById('sel-provider-' + agentId);

  const model = modelSelect ? modelSelect.value : null;
  const reasoningEffort = reasoningSelect ? reasoningSelect.value : null;
  const provider = providerSelect ? providerSelect.value : null;

  if (!model) {
    showToast('Selecione um modelo antes de salvar.', 'error');
    return;
  }

  const preset = findModelPresetLocal(model) || {};
  const baseUrl = preset.baseUrl || '';

  try {
    showToast('Salvando modelo "' + model + '" no agente...', 'info');
    const res = await fetch('/api/agents/' + pc + '/' + profile + '/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, provider, baseUrl, reasoningEffort })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      await loadAgents();
      renderApp();
    } else {
      showToast('Erro ao salvar: ' + data.error, 'error');
    }
  } catch (e) {
    showToast('Falha na requisição: ' + e.message, 'error');
  }
}

async function executeBatchModel() {
  const target = document.getElementById('batch-target').value;
  const model = document.getElementById('batch-model').value;
  const reasoningEffort = document.getElementById('batch-reasoning').value;
  const provider = document.getElementById('batch-provider').value;
  const autoRestart = document.getElementById('batch-auto-restart').checked;

  if (!model) {
    showToast('Selecione um modelo para aplicar em lote.', 'error');
    return;
  }

  const preset = findModelPresetLocal(model) || {};
  const baseUrl = preset.baseUrl || '';

  try {
    closeModal('modal-batch');
    showToast('Aplicando "' + model + '" (' + reasoningEffort + ') em lote (' + target + ')...', 'info');

    const res = await fetch('/api/agents/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, model, provider, baseUrl, reasoningEffort })
    });

    const data = await res.json();
    if (data.success) {
      showToast('Lote concluído: ' + data.updatedCount + ' agentes atualizados com sucesso!', 'success');
      if (autoRestart) {
        showToast('Disparando reinício dos gateways afetados...', 'info');
        await fetch('/api/fleet/restart/' + target, { method: 'POST' });
        showToast('Gateways reiniciados!', 'success');
      }
      await initApp();
    } else {
      showToast('Lote finalizado com erros: ' + JSON.stringify(data.errors || data.error), 'error');
      await initApp();
    }
  } catch (e) {
    showToast('Falha ao executar lote: ' + e.message, 'error');
  }
}

async function testAgent(pc, profile) {
  openModal('modal-test');
  document.getElementById('test-modal-title').textContent = '🧪 Teste de Conexão: ' + pc + ' / ' + profile;
  document.getElementById('test-spinner').classList.remove('hidden');
  document.getElementById('test-result-box').classList.add('hidden');

  try {
    const res = await fetch('/api/fleet/test-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pc, profile })
    });

    const data = await res.json();
    document.getElementById('test-spinner').classList.add('hidden');
    document.getElementById('test-result-box').classList.remove('hidden');
    document.getElementById('test-output').textContent = data.output || 'Nenhuma saída retornada.';
  } catch (e) {
    document.getElementById('test-spinner').classList.add('hidden');
    document.getElementById('test-result-box').classList.remove('hidden');
    document.getElementById('test-output').textContent = 'Erro ao executar teste: ' + e.message;
  }
}

async function restartHost(pc) {
  if (!confirm('Deseja realmente reiniciar o serviço do Hermes Gateway no host "' + pc + '"?')) return;

  try {
    showToast('Reiniciando gateway em ' + pc + '...', 'info');
    const res = await fetch('/api/fleet/restart/' + pc, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      setTimeout(loadFleetStatus, 2000);
    } else {
      showToast('Falha ao reiniciar: ' + (data.details?.error || data.error), 'error');
    }
  } catch (e) {
    showToast('Erro na requisição: ' + e.message, 'error');
  }
}

async function restartAllFleet() {
  if (!confirm('Deseja realmente reiniciar o Hermes Gateway em TODOS os 3 computadores da frota?')) return;

  try {
    showToast('Reiniciando gateways de toda a frota...', 'info');
    const res = await fetch('/api/fleet/restart/all', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Comando de reinício enviado para os 3 computadores!', 'success');
      setTimeout(loadFleetStatus, 3000);
    }
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

async function healHost(pc) {
  try {
    showToast('Executando cura de perfis em ' + pc + '...', 'info');
    const res = await fetch('/api/fleet/heal/' + pc, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Cura concluída em ' + pc + '!', 'success');
    } else {
      showToast('Erro na cura: ' + data.error, 'error');
    }
  } catch (e) {
    showToast('Falha na requisição: ' + e.message, 'error');
  }
}

async function healAllFleet() {
  try {
    showToast('Executando cura em toda a frota...', 'info');
    const res = await fetch('/api/fleet/heal/all', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Cura executada com sucesso nos 3 computadores!', 'success');
    }
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
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
    const res = await fetch('/api/fleet/logs/' + pc);
    const data = await res.json();
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

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.innerHTML = '<span>' + (type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️') + '</span> <span>' + message + '</span>';

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
  showToast('ID copiado: ' + text, 'info');
}