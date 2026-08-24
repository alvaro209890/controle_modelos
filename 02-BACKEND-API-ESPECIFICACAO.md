# 02. Especificação do Backend e API REST

Este documento especifica a arquitetura do servidor backend (Node.js com Express) que roda centralizado no **`server-desktop`**, servindo a API REST, entregando o Frontend estático e comunicando-se diretamente com os nós locais e remotos via SSH.

---

## 1. Visão Geral da Arquitetura do Servidor

- **Local de Execução**: `server-desktop` (Ubuntu Linux, 24/7)
- **Linguagem / Runtime**: Node.js (v18+)
- **Framework**: Express.js
- **Porta Padrão**: `9120`
- **Hospedagem & Domínio**:
  - Exposto via **Cloudflare Tunnel** no domínio **`https://modelos.cursar.space`**
  - Acessível localmente/Tailscale via `http://localhost:9120` ou `http://server-desktop:9120`
- **Entrega Unificada**: O Express serve os endpoints da API (`/api/*`) e os arquivos estáticos do Frontend (`/public/*`) na mesma porta/origem.
- **Autenticação**: **Nenhuma** (acesso direto, sem tela de senha).
- **Segurança Operacional**:
  - Comandos SSH com `BatchMode=yes` e `ConnectTimeout=8` (evita deadlocks).
  - Toda escrita em `config.yaml` gera backup datado antes da substituição.
  - Sanitização de parâmetros de entrada.

---

## 2. Estrutura de Diretórios e Módulos

```
controle_modelos/
├── package.json
├── server.js               # Inicialização do Express, middlewares, estáticos e rotas
├── routes/
│   ├── fleet.js            # Rotas de status da frota, restarts, logs e cura
│   ├── agents.js           # Rotas de consulta e alteração de agentes individuais/lote
│   └── models.js           # Catálogo de modelos e presets
├── services/
│   ├── sshRunner.js        # Execução de comandos locais e remotos (SSH)
│   ├── configManager.js    # Leitura, parsing e edição segura de YAML com backups
│   └── agentDirectory.js   # Catálogo estático dos 13 agentes e caminhos
└── public/                 # Frontend SPA (HTML, CSS, JS) servido pelo Express
    ├── index.html
    ├── style.css
    └── app.js
```

---

## 3. Catálogo Hierárquico de Provedores e Modelos (`routes/models.js`)

O catálogo deixou de ser uma lista plana e passou a ser **hierárquico**:

```
Provider (id, name, baseUrl, keyEnv, availableOn)  →  Model (id, name, allowedReasoning, defaultReasoning)
```

- **`availableOn`** — lista de PCs (`server`/`acer`/`windows`) em que aquele provedor tem **credencial real** (verificada no `.env` de cada máquina). O frontend usa isso para filtrar provedores elegíveis por coluna de PC, e o backend **recusa** um batch cujo alvo inclua um PC sem a chave do provedor.
- **`allowedReasoning`** — níveis de reasoning aceitos por aquele modelo específico (ex.: `ox-alpha-free` só aceita `low`/`high`/`max`; `glm-5.2` só `high`/`max`; `hy3` só `none`/`low`/`high`; família deepseek aceita `none`..`max`).
- **`defaultReasoning`** — o nível padrão sugerido ao trocar para aquele modelo.

O `opencode-go` lista **29 modelos** e o catálogo é **atualizado automaticamente**: o endpoint
`GET /api/models/providers` consulta o relay `opencode.ai/zen/go/v1/models?full=true` **ao vivo**
(com cache de 5 min) usando a `OPENCODE_GO_API_KEY` do `.env` do Hermes do host. Modelos novos
aparecem sozinhos; se a consulta falhar, cai na lista base embutida em `baseGoIds()`. A validação
de escrita (`findModelPreset`, síncrona) usa o catálogo base (não depende de rede). Cada modelo traz
`contextLength` (contexto em tokens), `free` (bool) e `costInput`/`costOutput` ($/M) vindos do
catálogo oficial do CLI opencode. O `openrouter` lista uma **curadoria de 8 modelos bons e baratos
para código** (com preço USD/M tokens no badge). Espera-se que mudanças no catálogo do relay se
reflitam em <5 min sem mexer no código.

> **Mobile:** front responsivo (≤900px → 1 coluna, toques maiores). Veja `README.md`.

### Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/models/providers` | Catálogo hierárquico completo (Provider → Model → reasoning) |
| `GET` | `/api/models/presets` | Lista plana derivada (retrocompatível) |

### Validação de coerência (`routes/agents.js`)

Ao salvar modelo individual ou em lote, o backend valida:

1. **Provider ↔ Model**: se o provider informado não é o dono do modelo, recusa (`model X pertence ao provedor Y`).
2. **Reasoning aceito**: se o `reasoningEffort` não está em `allowedReasoning` do modelo, recusa.
3. **Credencial do alvo**: no batch, se o alvo inclui um PC sem a chave do provedor (`availableOn`), recusa antes de gravar qualquer arquivo.

---

## 4. Catálogo de Agentes e Mapeamento (`services/agentDirectory.js`)

```javascript
const FLEET_AGENTS = [
  // server-desktop (local)
  { pc: 'server', profile: 'default', name: 'Server Principal', channel: '🖥️｜hermes-server-desktop', channelId: '1528227053265096867', isRoot: true, configPath: '/home/server/.hermes/config.yaml' },
  { pc: 'server', profile: 'geoforest', name: 'GeoForest Dev', channel: '🌲｜geoforest', channelId: '1540428678268457021', isRoot: false, configPath: '/home/server/.hermes/profiles/geoforest/config.yaml' },
  { pc: 'server', profile: 'acompanhamento', name: 'Acompanhamento Server', channel: '📁｜acompanhamento', channelId: '1540428680361410661', isRoot: false, configPath: '/home/server/.hermes/profiles/acompanhamento/config.yaml' },
  { pc: 'server', profile: 'wms', name: 'WMS / GeoServer', channel: '🗺️｜wms', channelId: '1540428682429079602', isRoot: false, configPath: '/home/server/.hermes/profiles/wms/config.yaml' },

  // acer (remoto via ssh acer)
  { pc: 'acer', profile: 'default', name: 'Acer Principal', channel: '💻｜hermes-acer', channelId: '1528549192774193314', isRoot: true, configPath: '/home/acer/.hermes/config.yaml' },
  { pc: 'acer', profile: 'trello', name: 'Trello SIMCAR', channel: '📋｜trello-simcar', channelId: '1540411181972463697', isRoot: false, configPath: '/home/acer/.hermes/profiles/trello/config.yaml' },
  { pc: 'acer', profile: 'acompanhamento', name: 'Acompanhamento IMAP', channel: '📁｜acompanhamento', channelId: '1540411184153366609', isRoot: false, configPath: '/home/acer/.hermes/profiles/acompanhamento/config.yaml' },
  { pc: 'acer', profile: 'geoforest', name: 'GeoForest Acer', channel: '🌲｜geoforest', channelId: '1540414298432479252', isRoot: false, configPath: '/home/acer/.hermes/profiles/geoforest/config.yaml' },
  { pc: 'acer', profile: 'solicitacoes', name: 'Solicitações E-mail', channel: '✉️｜solicitacoes', channelId: '1540414300286615683', isRoot: false, configPath: '/home/acer/.hermes/profiles/solicitacoes/config.yaml' },

  // windows (remoto via ssh windows)
  { pc: 'windows', profile: 'default', name: 'Windows Principal', channel: '🪟｜hermes-windows', channelId: '1540595104044032020', isRoot: true, configPath: 'C:\\Users\\Usuario\\AppData\\Local\\hermes\\config.yaml' },
  { pc: 'windows', profile: 'cartografo', name: 'Cartógrafo ArcGIS', channel: '🗺️｜cartografo', channelId: '1540595107584278589', isRoot: false, configPath: 'C:\\Users\\Usuario\\AppData\\Local\\hermes\\profiles\\cartografo\\config.yaml' },
  { pc: 'windows', profile: 'documentos', name: 'Documentos IMAP', channel: '📄｜documentos', channelId: '1540595111392452638', isRoot: false, configPath: 'C:\\Users\\Usuario\\AppData\\Local\\hermes\\profiles\\documentos\\config.yaml' },
  { pc: 'windows', profile: 'zelador', name: 'Zelador Windows', channel: '🧹｜zelador', channelId: '1540595114731114576', isRoot: false, configPath: 'C:\\Users\\Usuario\\AppData\\Local\\hermes\\profiles\\zelador\\config.yaml' }
];

module.exports = { FLEET_AGENTS };
```

---

## 4. Especificação dos Endpoints REST

### 1. `GET /api/fleet/status`
Verifica a conectividade SSH e o status dos gateways nos 3 computadores.

**Resposta de Sucesso (200 OK):**
```json
{
  "timestamp": "2026-08-23T20:00:00.000Z",
  "domain": "modelos.cursar.space",
  "hosts": {
    "server": { "online": true, "gatewayRunning": true, "latencyMs": 0, "hostname": "server-desktop" },
    "acer": { "online": true, "gatewayRunning": true, "latencyMs": 18, "hostname": "acer-Aspire-A515-45" },
    "windows": { "online": true, "gatewayRunning": true, "latencyMs": 35, "hostname": "PCQUE001IMAP" }
  }
}
```

---

### 2. `GET /api/agents`
Lê os arquivos `config.yaml` dos 13 agentes e retorna o estado atualizado de cada um.

**Resposta de Sucesso (200 OK):**
```json
[
  {
    "pc": "server",
    "profile": "geoforest",
    "name": "GeoForest Dev",
    "channel": "🌲｜geoforest",
    "channelId": "1540428678268457021",
    "model": "ox-alpha-free",
    "provider": "opencode-go",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "reasoningEffort": "max",
    "reasoningOverrides": { "ox-alpha-free": "max" },
    "delegation": { "model": "ox-alpha-free", "reasoningEffort": "max" },
    "status": "ready"
  }
]
```

---

### 3. `GET /api/models/presets`
Retorna o catálogo de modelos homologados.

---

### 4. `POST /api/agents/:pc/:profile/model`
Atualiza o modelo e parâmetros de raciocínio de um agente individual com backup automático.

**Corpo da Requisição (JSON):**
```json
{
  "model": "ox-alpha-free",
  "provider": "opencode-go",
  "baseUrl": "https://opencode.ai/zen/go/v1",
  "reasoningEffort": "max"
}
```

---

### 5. `POST /api/agents/batch`
Aplica a alteração de modelo em lote (`all`, `server`, `acer`, `windows`).

---

### 6. `POST /api/fleet/restart/:pc`
Reinicia o gateway Hermes no computador especificado (`server`, `acer`, `windows` ou `all`).

---

### 7. `POST /api/fleet/test-provider`
Executa `testar-provider-perfil.py [profile]` e devolve a saída com validação de raciocínio no fio e código HTTP.

---

### 8. `POST /api/fleet/heal/:pc`
Executa o script de cura `checar-perfis` para restaurar variáveis faltantes.

---

### 9. `GET /api/fleet/logs/:pc`
Retorna as últimas 50 linhas de log do gateway do PC indicado.

---

## 5. Implementação do Servidor Express (`server.js`)

```javascript
const express = require('express');
const cors = require('cors');
const path = require('path');

const fleetRoutes = require('./routes/fleet');
const agentsRoutes = require('./routes/agents');
const modelsRoutes = require('./routes/models');

const app = express();
const PORT = process.env.PORT || 9120;

// Middlewares
app.use(cors());
app.use(express.json());

// Servir frontend estático da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Rotas da API
app.use('/api/fleet', fleetRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/models', modelsRoutes);

// Fallback para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Controle Modelos] Servidor ativo em http://0.0.0.0:${PORT}`);
  console.log(`[Controle Modelos] Acessível via https://modelos.cursar.space`);
});
```

> **Versão atual (2026-08-23):** o trecho acima é a forma base. O `server.js` em produção
> adiciona um middleware de **cache-bust automático** (antes do `express.static`): todo HTML sai
> com `Cache-Control: no-cache, must-revalidate` e os links de `style.css`/`app.js` recebem
> `?v=<hash-do-mtime>` injetado no corpo. O `express.static` usa `{ index: false }` para que o
> documento só saia pelo middleware (que grava a versão nos assets).

## 6. Reinício de Gateway e Conectividade (`services/sshRunner.js`)

O helper `restartHermesGateway(host)` centraliza o reinício dos três gateways e resolveu duas
falhas reais (2026-08-23):

| Host | Comando | Problema corrigido |
|---|---|---|
| **server** | `systemctl --user restart hermes-gateway.service` | O Node do painel roda como `systemd --user` e **não herda** `DBUS_SESSION_BUS_ADDRESS`/`XDG_RUNTIME_DIR` → `Failed to connect to bus`. O helper injeta os dois (`XDG_RUNTIME_DIR=/run/user/$(id -u) ...`) antes do comando. |
| **acer** | idem (via SSH) | Já funcionava (shell de login seta o bus); mantém-se com env explícito por consistência. |
| **windows** | `hermes gateway stop && schtasks /Run /TN HermesGateway` | O shell padrão do **Windows OpenSSH é PowerShell 5.1**, que **não suporta `&&`** → erro de sintaxe. A cadeia é envolta em `cmd /c "…"` para o `cmd.exe` a interpretar. |

Todos os três retornam `{ success: true }` após o restart, validados em produção (2026-08-23).

## 7. Resiliência ao reboot do server (2026-08-24)

O painel sobrevive a um reboot do server-desktop:

- **Serviço systemd do usuário** com `Linger=yes` em `server` → arranca no boot sem login.
- O unit declara `After=media-server-HD\x20Backup.mount` + `Wants=...` → **espera o HD externo
  montar** antes de subir (evita corrida com a montagem; `Restart=always` cobre HD ausente).
- `cloudflared.service` (túnel) `enabled` + `active` no boot.

```bash
# verificar:
systemctl --user is-enabled controle-modelos.service   # enabled
loginctl show-user server -p Linger                    # Linger=yes
systemctl is-active cloudflared                        # active (system)
```
