# 04. Plano de Execução para Agentes de IA

Este é o roteiro prescritivo passo a passo para que qualquer agente de IA (Claude, Hermes, Codex, Cursor ou Antigravity) desenvolva, integre, teste e publique no domínio **`cursar.space`** o painel **Controle de Modelos Hermes**.

---

## 📋 Índice das Fases de Desenvolvimento

- **Fase 1**: Inicialização do Projeto e Dependências no `server-desktop`
- **Fase 2**: Módulos Core do Backend (`sshRunner`, `configManager`, `agentDirectory`)
- **Fase 3**: Rotas da API REST e Servidor Express (com entrega estática da UI)
- **Fase 4**: Construção do Frontend Reativo (SPA em `public/`)
- **Fase 5**: Criação do Serviço Systemd e Exposição no Cloudflare Tunnel (`modelos.cursar.space`)

---

## 🛠️ Fase 1: Inicialização do Projeto e Dependências

### 1.1 Criar o `package.json`
No diretório `/media/server/HD Backup/Servidores_NAO_MEXA/controle_modelos`:

```json
{
  "name": "controle-modelos-hermes",
  "version": "1.0.0",
  "description": "Painel de controle e edicao de modelos de IA para a frota Hermes no dominio cursar.space",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "yaml": "^2.4.5"
  }
}
```

### 1.2 Instalar Dependências
```bash
cd "/media/server/HD Backup/Servidores_NAO_MEXA/controle_modelos"
npm install
```

---

## ⚙️ Fase 2: Módulos Core do Backend

### 2.1 Criar `services/agentDirectory.js`
Mapeie a lista canônica dos 13 agentes nos 3 computadores.

### 2.2 Criar `services/sshRunner.js`
Implemente o executor com `-o BatchMode=yes -o ConnectTimeout=8` para os hosts remotos (`acer`, `windows`) e execução direta local no `server-desktop`.

### 2.3 Criar `services/configManager.js`
Implemente:
- `readAgentConfig(pc, configPath)`: Leitura local ou via SSH com extração segura dos campos do modelo e raciocínio.
- `updateAgentModel(pc, configPath, modelData)`: Criação de backup `.bak-controle-<timestamp>` e substituição cirúrgica dos campos `model.default`, `provider`, `base_url`, `reasoning_effort`, `reasoning_overrides` e `delegation`.

---

## 🌐 Fase 3: Rotas da API e Servidor Express

### 3.1 Criar as Rotas da API
- `routes/fleet.js`: Status dos nós, reinício de gateways, execução de testes (`testar-provider-perfil.py`), cura (`checar-perfis`) e logs.
- `routes/agents.js`: Leitura dos 13 agentes e mutação individual ou em lote.
- `routes/models.js`: Catálogo de presets homologados.

### 3.2 Criar `server.js`
Monte o Express para responder pela API (`/api/*`) e servir os arquivos estáticos da pasta `public/` na porta `9120`:

```javascript
const express = require('express');
const cors = require('cors');
const path = require('path');

const fleetRoutes = require('./routes/fleet');
const agentsRoutes = require('./routes/agents');
const modelsRoutes = require('./routes/models');

const app = express();
const PORT = process.env.PORT || 9120;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/fleet', fleetRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/models', modelsRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Controle Modelos] Servidor ativo em http://0.0.0.0:${PORT}`);
  console.log(`[Controle Modelos] Hospedado para https://modelos.cursar.space`);
});
```

---

## 💻 Fase 4: Construção do Frontend SPA

Crie na pasta `public/`:
1. **`public/index.html`**: Layout semântico com grid de 3 colunas, modals de teste/lote e drawer de logs.
2. **`public/style.css`**: Tema dark mode responsivo, badges de status, botões reativos e animações.
3. **`public/app.js`**: Lógica assíncrona para buscar dados da API, renderizar componentes, disparar ações de salvar, testar conexão e reiniciar nós.

---

## 🚀 Fase 5: Serviço Systemd e Publicação no Domínio `cursar.space`

### 5.1 Criar o Serviço Systemd no `server-desktop`
Arquivo: `/home/server/.config/systemd/user/controle-modelos.service`

```ini
[Unit]
Description=Controle de Modelos Hermes - Painel Web cursar.space
After=network.target

[Service]
Type=simple
WorkingDirectory=/media/server/HD Backup/Servidores_NAO_MEXA/controle_modelos
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=PORT=9120
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

Ativar o serviço:
```bash
systemctl --user daemon-reload
systemctl --user enable --now controle-modelos.service
systemctl --user status controle-modelos.service
```

### 5.2 Configurar o Cloudflare Tunnel para o Domínio `cursar.space`
Adicione o roteamento no arquivo de configuração do túnel Cloudflare do servidor (em `~/.cloudflared/`):

```yaml
# Ingress rule para o subdomínio de controle de modelos
- hostname: modelos.cursar.space
  service: http://localhost:9120
```

Reinicie o serviço do Cloudflare Tunnel:
```bash
sudo systemctl restart cloudflared.service
```

---

## ✅ Critérios de Aceite para o Agente Desenvolvedor
1. O backend e o frontend sobem conjuntamente no `server-desktop` na porta `9120`.
2. A URL `https://modelos.cursar.space` responde com status 200 e carrega a interface completa sem solicitar senha.
3. Todos os 13 agentes dos 3 PCs aparecem com seus respectivos modelos e opções de raciocínio.
4. É possível salvar alterações e verificar a geração de backups `.bak` e atualização nos arquivos `config.yaml`.
5. O botão "Testar Conexão" executa `testar-provider-perfil.py` e valida a emissão do reasoning no fio.
6. O botão "Reiniciar Gateway" reinicia o processo do Hermes no nó correto.
