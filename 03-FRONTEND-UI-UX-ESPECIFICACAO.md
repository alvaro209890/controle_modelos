# 03. Especificação do Frontend (UI / UX)

Este documento detalha o design, os componentes visuais, os fluxos de interação e a arquitetura da interface web do painel **Controle de Modelos Hermes**, hospedado e servido no `server-desktop` e acessível pelo domínio `cursar.space`.

---

## 1. Diretrizes de Design e Identidade Visual

- **Estilo**: Dark mode moderno, minimalista, estilo Cyberpunk/DevOps Dashboard.
- **Hospedagem**: Servido diretamente pelo backend Express no `server-desktop` e exposto em `https://modelos.cursar.space`.
- **Sem Autenticação**: Carregamento imediato sem telas intermediárias de login ou senha.
- **Paleta de Cores Principal**:
  - Fundo principal: `#0f172a` (Slate 900)
  - Cards e superfícies: `#1e293b` (Slate 800) / `#334155` (Slate 700)
  - Destaques / Ação: `#38bdf8` (Cyan 400) e `#818cf8` (Indigo 400)
  - Status Online / Sucesso: `#22c55e` (Emerald 500)
  - Status Offline / Erro: `#ef4444` (Red 500)
  - Alertas / Atenção: `#f59e0b` (Amber 500)
  - Modelos de IA: `#a855f7` (Purple 500)
- **Tipografia**: `Inter`, `system-ui` para texto e `JetBrains Mono` / `monospace` para códigos, IDs e logs.
- **Responsividade**: Grid responsivo (3 colunas no Desktop, empilhado no mobile).

---

## 2. Estrutura Visual da Página

```
+-----------------------------------------------------------------------------------+
|  🤖 CONTROLE DE MODELOS HERMES  [🌐 modelos.cursar.space] [3 PCs Online] (🔄 Atualizar) |
+-----------------------------------------------------------------------------------+
|  BARRA GLOBAL: [⚡ Trocar Modelo em Lote] [🔄 Reiniciar Frota] [🩺 Curar Perfis]   |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  [🖥️ SERVER-DESKTOP (Local)]    [💻 ACER NOTEBOOK (SSH)]      [🪟 WINDOWS IMAP (SSH)] |
|  Status: 🟢 Online (100.65...)   Status: 🟢 Online (100.102..) Status: 🟢 Online ...  |
|  Gateway: 🟢 Ativo (PID 1420)    Gateway: 🟢 Ativo (PID 8910)  Gateway: 🟢 Ativo ...  |
|  [🔄 Reiniciar] [🩺 Curar]       [🔄 Reiniciar] [🩺 Curar]     [🔄 Reiniciar] [🩺..]  |
|                                                                                   |
|  +---------------------------+  +---------------------------+  +----------------+ |
|  | 🖥️｜hermes-server-desktop  |  | 💻｜hermes-acer           |  | 🪟｜hermes-win  | |
|  | Perfil: default           |  | Perfil: default           |  | Perfil: default| |
|  | Modelo: [ox-alpha-free v] |  | Modelo: [ox-alpha-free v] |  | Modelo: [ox...] | |
|  | Provider: opencode-go     |  | Provider: opencode-go     |  | Provider: ...  | |
|  | Effort: [ max           v]|  | Effort: [ max           v]|  | Effort: [max v]| |
|  | [💾 Salvar] [🧪 Testar]   |  | [💾 Salvar] [🧪 Testar]   |  | [💾 Salvar]... | |
|  +---------------------------+  +---------------------------+  +----------------+ |
|  | 🌲｜geoforest             |  | 📋｜trello-simcar         |  | 🗺️｜cartografo  | |
|  | Perfil: geoforest         |  | Perfil: trello            |  | Perfil: cart...| |
|  | Modelo: [ox-alpha-free v] |  | Modelo: [ox-alpha-free v] |  | Modelo: [ox...] | |
|  | Effort: [ max           v]|  | Effort: [ max           v]|  | Effort: [max v]| |
|  | [💾 Salvar] [🧪 Testar]   |  | [💾 Salvar] [🧪 Testar]   |  | [💾 Salvar]... | |
|  +---------------------------+  +---------------------------+  +----------------+ |
|  | ... (outros agentes)      |  | ... (outros agentes)      |  | ...            | |
+-----------------------------------------------------------------------------------+
|  RODAPÉ: Hospedado no server-desktop • modelos.cursar.space • Sem autenticação     |
+-----------------------------------------------------------------------------------+
```

---

## 3. Componentes Principais

### A. Header e Barra Global de Ações
- **Badge do Domínio**: Exibe `🌐 modelos.cursar.space` e o status de sincronização.
- **Botão "Trocar Modelo em Lote"**:
  - Modal com seleção de escopo:
    - Toda a Frota (13 agentes).
    - Apenas server-desktop (4 agentes).
    - Apenas acer (5 agentes).
    - Apenas windows (4 agentes).
  - Opção para reiniciar gateways automaticamente após gravação.
- **Botão "Reiniciar Frota"**: Reinicia em sequência controlada os 3 gateways.
- **Botão "Curar Perfis"**: Dispara `checar-perfis` nos 3 nós para sincronizar credenciais `.env`.

---

### B. Cards dos Computadores (Hosts)
- **Status em Tempo Real**: Conexão SSH, latência e status do processo gateway.
- **Ações Rápidas por Host**: Reiniciar gateway, visualizar logs em tempo real e curar variáveis.

---

### C. Cards dos Agentes Discord
- **Emoji e Canal do Discord** (`🌲｜geoforest`, `📋｜trello-simcar`, etc.) + ID do canal.
- **Seletores de Modelo e Reasoning**:
  - Dropdown com presets: `ox-alpha-free`, `deepseek-v4-flash`, `hy3`, `grok-4.6`, `deepseek-v4-pro`.
  - Dropdown com níveis de esforço: `none`, `low`, `medium`, `high`, `max`.
- **Botões "Salvar" e "Testar Conexão"**:
  - "Salvar" gera backup e atualiza o YAML.
  - "Testar Conexão" roda `testar-provider-perfil.py` e exibe o retorno ao vivo.

---

### D. Modals e Drawers

1. **Modal de Teste de Conectividade**:
   - Exibe a saída detalhada do script com o esforço no fio (*wire*) e status HTTP 200.
2. **Drawer Lateral de Logs**:
   - Terminal dark com as últimas 50 linhas de log do gateway selecionado.
