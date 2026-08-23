// Estado global da aplicação
let fleetData = {
  agents: [],
  presets: [],
  hosts: {},
  currentLogHost: null
};

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
});

async function initApp() {
  await Promise.all([loadPresets(), loadFleetStatus(), loadAgents()]);
  renderApp();
}

function setupEventListeners() {
  document.getElementById('btn-refresh').addEventListener('click', () => {
    initApp();
    showToast('Dados atualizados com sucesso!', 'info');
  });

  document.getElementById('btn-open-batch').addEventListener('click', () => {
    openModal('modal-batch');
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

  document.getElementById('batch-model').addEventListener('change', (e) => {
    updateReasoningHint('batch-reasoning-hint', e.target.value);
  });
}

// ==================== CARREGAMENTO DE DADOS ====================

async function loadPresets() {
  try {
    const res = await fetch('/api/models/presets');
    const data = await res.json();
    if (data.success) {
      fleetData.presets = data.presets;
      populateBatchPresetSelect();
    }
  } catch (e) {
    showToast('Erro ao carregar presets de modelos: ' + e.message, 'error');
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

    const badge = document.getElementById(`status-badge-${hostKey}`);
    const gwEl = document.getElementById(`gw-${hostKey}`);

    if (badge) {
      badge.className = `host-status-badge ${h.online ? '' : 'offline'}`;
      badge.innerHTML = `<span class="dot ${h.online ? 'dot-online' : 'dot-offline'}"></span> ${h.online ? 'Online' + (h.latencyMs !== null ? ` (${h.latencyMs}ms)` : '') : 'Offline'}`;
    }

    if (gwEl) {
      gwEl.textContent = h.gatewayRunning ? 'Ativo 🟢' : (h.online ? 'Inativo 🔴' : 'Indisponível');
    }
  });

  document.getElementById('stat-online-hosts').textContent = `${onlineCount}/3`;
}

function renderAgentsByHost(pc) {
  const container = document.getElementById(`agents-${pc}`);
  if (!container) return;

  const agents = fleetData.agents.filter((a) => a.pc === pc);
  container.innerHTML = '';

  agents.forEach((agent) => {
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.id = `card-${agent.id}`;
    card.dataset.name = `${agent.name} ${agent.channel} ${agent.profile}`.toLowerCase();

    // Model options
    const modelOptions = fleetData.presets
      .map(
        (p) => `<option value="${p.id}" ${agent.model === p.id ? 'selected' : ''}>${p.name}</option>`
      )
      .join('');

    // Reasoning options
    const reasoningLevels = ['max', 'high', 'medium', 'low', 'none'];
    const reasoningOptions = reasoningLevels
      .map(
        (lvl) => `<option value="${lvl}" ${agent.reasoningEffort === lvl ? 'selected' : ''}>${lvl}</option>`
      )
      .join('');

    card.innerHTML = `
      <div class="agent-card-header">
        <div class="agent-channel-info">
          <div class="agent-channel-title">
            <span>${agent.channel}</span>
          </div>
          <div class="agent-channel-desc">${agent.description}</div>
        </div>
        <span class="channel-id-badge" title="Clique para copiar o ID do canal" onclick="copyToClipboard('${agent.channelId}')">
          ID: ${agent.channelId.slice(0, 7)}...
        </span>
      </div>

      <div class="agent-selectors">
        <div class="selector-group">
          <label>Modelo:</label>
          <select id="sel-model-${agent.id}" class="form-control" onchange="onAgentModelChange('${agent.id}', this.value)">
            ${modelOptions}
            ${!fleetData.presets.some((p) => p.id === agent.model) ? `<option value="${agent.model}" selected>${agent.model} (custom)</option>` : ''}
          </select>
        </div>

        <div class="selector-group">
          <label>Reasoning:</label>
          <select id="sel-reasoning-${agent.id}" class="form-control">
            ${reasoningOptions}
          </select>
        </div>
      </div>

      <div class="agent-card-actions">
        <button class="btn-xs btn-test" onclick="testAgent('${agent.pc}', '${agent.profile}')" title="Testar chamada real do modelo">
          🧪 Testar
        </button>
        <button class="btn-xs btn-save" onclick="saveAgentModel('${agent.pc}', '${agent.profile}', '${agent.id}')" title="Salvar configurações e criar backup">
          💾 Salvar
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

function populateBatchPresetSelect() {
  const select = document.getElementById('batch-model');
  if (!select) return;
  select.innerHTML = fleetData.presets
    .map((p) => `<option value="${p.id}">${p.name} (${p.badge})</option>`)
    .join('');
}

function onAgentModelChange(agentId, selectedModel) {
  const reasoningSelect = document.getElementById(`sel-reasoning-${agentId}`);
  if (!reasoningSelect) return;

  const preset = fleetData.presets.find((p) => p.id === selectedModel);
  if (preset) {
    reasoningSelect.value = preset.defaultReasoning;
  }
}

function updateReasoningHint(elementId, modelId) {
  const hintEl = document.getElementById(elementId);
  if (!hintEl) return;
  if (modelId === 'ox-alpha-free') {
    hintEl.textContent = '⚠️ Ox Alpha aceita apenas: low, high, max (outros dão erro 400).';
    hintEl.style.color = 'var(--warning)';
  } else {
    hintEl.textContent = 'Níveis aceitos: none, low, medium, high.';
    hintEl.style.color = 'var(--text-muted)';
  }
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
  const modelSelect = document.getElementById(`sel-model-${agentId}`);
  const reasoningSelect = document.getElementById(`sel-reasoning-${agentId}`);

  const model = modelSelect ? modelSelect.value : null;
  const reasoningEffort = reasoningSelect ? reasoningSelect.value : null;

  const preset = fleetData.presets.find((p) => p.id === model) || {};
  const provider = preset.provider;
  const baseUrl = preset.baseUrl;

  try {
    showToast(`Salvando modelo "${model}" no agente...`, 'info');
    const res = await fetch(`/api/agents/${pc}/${profile}/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, provider, baseUrl, reasoningEffort })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      await loadAgents();
    } else {
      showToast(`Erro ao salvar: ${data.error}`, 'error');
    }
  } catch (e) {
    showToast(`Falha na requisição: ${e.message}`, 'error');
  }
}

async function executeBatchModel() {
  const target = document.getElementById('batch-target').value;
  const model = document.getElementById('batch-model').value;
  const reasoningEffort = document.getElementById('batch-reasoning').value;
  const autoRestart = document.getElementById('batch-auto-restart').checked;

  const preset = fleetData.presets.find((p) => p.id === model) || {};
  const provider = preset.provider;
  const baseUrl = preset.baseUrl;

  try {
    closeModal('modal-batch');
    showToast(`Aplicando "${model}" (${reasoningEffort}) em lote (${target})...`, 'info');

    const res = await fetch('/api/agents/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, model, provider, baseUrl, reasoningEffort })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Lote concluído: ${data.updatedCount} agentes atualizados com sucesso!`, 'success');
      if (autoRestart) {
        showToast('Disparando reinício dos gateways afetados...', 'info');
        await fetch(`/api/fleet/restart/${target}`, { method: 'POST' });
        showToast('Gateways reiniciados!', 'success');
      }
      await initApp();
    } else {
      showToast(`Lote finalizado com erros: ${JSON.stringify(data.errors)}`, 'error');
      await initApp();
    }
  } catch (e) {
    showToast(`Falha ao executar lote: ${e.message}`, 'error');
  }
}

async function testAgent(pc, profile) {
  openModal('modal-test');
  document.getElementById('test-modal-title').textContent = `🧪 Teste de Conexão: ${pc} / ${profile}`;
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
    document.getElementById('test-output').textContent = `Erro ao executar teste: ${e.message}`;
  }
}

async function restartHost(pc) {
  if (!confirm(`Deseja realmente reiniciar o serviço do Hermes Gateway no host "${pc}"?`)) return;

  try {
    showToast(`Reiniciando gateway em ${pc}...`, 'info');
    const res = await fetch(`/api/fleet/restart/${pc}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      setTimeout(loadFleetStatus, 2000);
    } else {
      showToast(`Falha ao reiniciar: ${data.details?.error || data.error}`, 'error');
    }
  } catch (e) {
    showToast(`Erro na requisição: ${e.message}`, 'error');
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
    showToast(`Erro: ${e.message}`, 'error');
  }
}

async function healHost(pc) {
  try {
    showToast(`Executando cura de perfis em ${pc}...`, 'info');
    const res = await fetch(`/api/fleet/heal/${pc}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Cura concluída em ${pc}!`, 'success');
    } else {
      showToast(`Erro na cura: ${data.error}`, 'error');
    }
  } catch (e) {
    showToast(`Falha na requisição: ${e.message}`, 'error');
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
    showToast(`Erro: ${e.message}`, 'error');
  }
}

async function openLogs(pc) {
  fleetData.currentLogHost = pc;
  const drawer = document.getElementById('drawer-logs');
  const title = document.getElementById('drawer-logs-title');
  const content = document.getElementById('drawer-logs-content');

  drawer.classList.remove('hidden');
  title.textContent = `📋 Logs do Gateway — ${pc}`;
  content.textContent = 'Carregando últimas linhas de log...';

  try {
    const res = await fetch(`/api/fleet/logs/${pc}`);
    const data = await res.json();
    content.textContent = data.logs || 'Sem registros de log recentes.';
    content.scrollTop = content.scrollHeight;
  } catch (e) {
    content.textContent = `Erro ao carregar logs: ${e.message}`;
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
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span> <span>${message}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
  showToast(`ID copiado: ${text}`, 'info');
}
