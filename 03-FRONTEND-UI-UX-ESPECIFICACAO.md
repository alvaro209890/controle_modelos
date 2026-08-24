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
|  | Provider: [opencode-go v] |  | Provider: [opencode-go v] |  | Provider: [..] | |
|  | Modelo:  [ox-alpha-free v]|  | Modelo:  [ox-alpha-free v]|  | Modelo:  [..] | |
|  | Effort:  [ max           v]|  | Effort:  [ max           v]|  | Effort: [max v]| |
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
- **Cascata de Seletores (Provider → Model → Reasoning)**, alinhada ao catálogo hierárquico:
  1. **Provider**: dropdown com os provedores que têm credencial naquele PC (`availableOn`). Ex.: no Windows só aparecem `opencode-go` e `deepseek-standard` (o `xai-oauth` não está disponível lá).
  2. **Modelo**: ao trocar o provider, o dropdown de modelos é repovoado com **apenas os modelos daquele provider**. O `opencode-go` lista **29 modelos** (todos os do relay); o `openrouter` lista os **8 curados** (bons e baratos para código).
  3. **Reasoning**: ao escolher o modelo, o dropdown de reasoning é repovoado com **apenas os níveis aceitos por aquele modelo** (`allowedReasoning`), já marcando o `defaultReasoning`.
- Em cada card o estado atual do agente é reconstruído: se o modelo ativo não estiver em nenhum provider homologado, é exibido como opção `(custom)`; se o reasoning ativo não estiver na lista do modelo, é exibido como `(atual)`.
- **Botões "Salvar" e "Testar Conexão"**:
  - "Salvar" gera backup e atualiza o YAML.
  - "Testar Conexão" roda `testar-provider-perfil.py` e exibe o retorno ao vivo.

---

### C2. Modal de Troca de Modelo em Lote (cascata)
- Mesma cascata do card individual: **Provider → Model → Reasoning**.
- Ao selecionar o provider, uma dica mostra em quais PCs ele está disponível e qual variável de chave usa (`keyEnv`).
- Ao selecionar o modelo, uma dica mostra os níveis de reasoning aceitos por aquele modelo.
- O backend recusa o lote se o alvo incluir um PC sem a credencial do provedor escolhido.

---

### D. Modals e Drawers

1. **Modal de Teste de Conectividade**:
   - Exibe a saída detalhada do script com o esforço no fio (*wire*) e status HTTP 200.
2. **Drawer Lateral de Logs**:
   - Terminal dark com as últimas 50 linhas de log do gateway selecionado.
