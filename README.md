# Controle de Modelos Hermes — Painel de Gestão da Frota

Painel web centralizado e sem autenticação para monitoramento, controle granular e em lote de modelos de IA (`model.default`, `provider`, `reasoning_effort`), teste de conectividade e reinício independente dos 13 agentes Hermes distribuídos nos 3 computadores da frota do Álvaro.

---

## 🎯 Objetivo do Projeto

Permitir que o Álvaro (ou qualquer agente autorizado) visualize e configure em tempo real, através de uma interface web simples e direta:
1. **O modelo de IA de cada um dos 13 agentes Discord** nos 3 computadores (`server-desktop`, `acer`, `windows`).
2. **O nível de raciocínio (*reasoning effort*)** de cada perfil (`none`, `low`, `medium`, `high`, `max`) — sempre restrito ao que o **modelo selecionado** aceita.
3. **Catálogo hierárquico Provider → Model → Reasoning**: primeiro escolhe-se o **provedor**, então aparecem apenas os **modelos disponíveis naquele provedor**, e então os **níveis de reasoning que aquele modelo aceita**.
4. **Validação por credencial**: cada provedor declara em quais PCs tem chave (`availableOn`); o painel impede salvar um modelo de provedor sem credencial naquela máquina.
5. **Ações em lote**: Trocar modelo de todos os agentes de um computador ou de toda a frota com 1 clique.
6. **Reinício de Gateway independente por PC**: Reiniciar o gateway Hermes do servidor, do notebook ou do Windows sem interferir nos outros nós.
7. **Testes de conectividade ao vivo**: Executar o script `testar-provider-perfil.py` para validar se as credenciais e o modelo respondem com HTTP 200 e com o reasoning correto no fio.
8. **Cura e sincronização de perfis**: Disparar scripts de cura (`checar-perfis`) para alinhar variáveis de ambiente e `.env`.
9. **Hospedagem no `server-desktop` e Domínio `cursar.space`**:
   - Backend e Frontend servidos **ambos neste PC** (`server-desktop`, produção 24/7).
   - O Express entrega a API e os arquivos estáticos da UI na mesma porta (`:9120`).
   - Exposição pública via **Cloudflare Tunnel** no domínio **`modelos.cursar.space`** (ou `controle-modelos.cursar.space`), sem senha.

---

## 🗺️ Mapa Rápido da Frota (3 PCs / 13 Agentes)

| Computador | Host / Alias SSH | SO / Hermes Home | Agentes / Perfis (Discord) |
|---|---|---|---|
| **server-desktop** *(Host do Site e API)* | `localhost` / `sd` | Linux Ubuntu<br>`/home/server/.hermes` | • `default` (🖥️｜hermes-server-desktop)<br>• `geoforest` (🌲｜geoforest)<br>• `acompanhamento` (📁｜acompanhamento)<br>• `wms` (🗺️｜wms) |
| **acer** | `acer` (`100.102.202.63`) | Linux Ubuntu<br>`/home/acer/.hermes` | • `default` (💻｜hermes-acer)<br>• `trello` (📋｜trello-simcar)<br>• `acompanhamento` (📁｜acompanhamento)<br>• `geoforest` (🌲｜geoforest)<br>• `solicitacoes` (✉️｜solicitacoes) |
| **windows** | `windows` (`100.102.60.73`) | Windows 10/11<br>`C:\Users\Usuario\AppData\Local\hermes` | • `default` (🪟｜hermes-windows)<br>• `cartografo` (🗺️｜cartografo)<br>• `documentos` (📄｜documentos)<br>• `zelador` (🧹｜zelador) |

---

## 📚 Documentação Técnica e Guias para Agentes

Esta pasta foi estruturada com planos e especificações detalhadas para que qualquer agente de IA (Claude, Hermes, Codex, Cursor, Antigravity) possa implementar e manter o sistema com precisão cirúrgica:

1. **[01-ARQUITETURA-E-MAPA-FROTA.md](01-ARQUITETURA-E-MAPA-FROTA.md)**  
   Topologia completa, caminhos de arquivos, serviços do sistema, formato dos arquivos YAML, infraestrutura de hosting no `server-desktop` e túnel `cursar.space`.

2. **[02-BACKEND-API-ESPECIFICACAO.md](02-BACKEND-API-ESPECIFICACAO.md)**  
   Especificação técnica da API REST (Node.js/Express servindo API e Frontend), rotas, runner SSH, sistema de backup automático `.bak` e manipulador de YAML.

3. **[03-FRONTEND-UI-UX-ESPECIFICACAO.md](03-FRONTEND-UI-UX-ESPECIFICACAO.md)**  
   Design do Dashboard, componentes visuais, seletores de modelos e reasoning, modals de lote, feedback de status e logs.

4. **[04-PLANO-EXECUCAO-AGENTES.md](04-PLANO-EXECUCAO-AGENTES.md)**  
   Roteiro de desenvolvimento passo a passo para agentes criarem o código, frontend, serviço systemd e configuração do Cloudflare Tunnel no domínio `cursar.space`.

5. **[05-TESTES-E-VALIDACAO.md](05-TESTES-E-VALIDACAO.md)**  
   Procedimento de testes automatizados e manuais, validação de integridade, testes de túnel público HTTPS e rollback de segurança.

---

## 🌐 URLs de Acesso

- **Acesso Público/Domínio**: `https://modelos.cursar.space` (ou `https://controle-modelos.cursar.space`)
- **Acesso Local / Tailscale**: `http://server-desktop:9120` ou `http://localhost:9120`

---

## 🛠️ Robustez (2026-08-23)

- **Cache-bust automático** (`server.js`): o HTML sai com `Cache-Control: no-cache, must-revalidate`
  e os assets `style.css`/`app.js` recebem `?v=<hash-do-mtime>` calculado em cada request.
  Sem essas duas camadas o browser (e o Cloudflare Tunnel) seguravam o front antigo e o usuário
  precisava de Ctrl+F5. Agora basta recarregar a página.
- **Reinício de Gateway nos 3 PCs** (`services/sshRunner.js`, helper `restartHermesGateway`):
  - **server**: o processo Node do painel roda como `systemd --user` e não herda o bus do
    sistema; o helper injeta `XDG_RUNTIME_DIR`/`DBUS_SESSION_BUS_ADDRESS` antes do
    `systemctl --user restart hermes-gateway.service`.
  - **windows**: o shell padrão do Windows OpenSSH é PowerShell 5.1, que não suporta `&&`;
    a cadeia `hermes gateway stop && schtasks /Run /TN HermesGateway` é envolta em `cmd /c "…"`.
  - **acer**: já funcionava (shell de login via SSH seta o bus); comando mantém-se com o env explícito.

## 📦 Catálogo de Modelos

O catálogo é **hierárquico** (Provider → Model → Reasoning). Atualizado em 2026-08-23:

| Provider | Chave (PCs) | Modelos |
|---|---|---|
| **opencode-go** | `OPENCODE_GO_API_KEY` (3 PCs) | **29 modelos** — lista **consultada ao vivo no relay** (GET /models, cache 5 min, com fallback em lista embutida). Só `ox-alpha-free` é **GRÁTIS** ($0); os demais exibem custo $/M e contexto de tokens no rótulo/front. |
| **opencode-zen** | `OPENCODE_ZEN_API_KEY` (3 PCs) | **6 modelos GRATUITOS** do OpenCode normal (`/zen/v1`), todos validados em HTTP 200: hy3-free, mimo-v2.5-free, laguna-s-2.1-free, nemotron-3.5-lightning-free, nemotron-3-ultra-free, big-pickle |
| **xai-oauth** | `XAI_API_KEY`/SuperGrok (server, acer) | grok-4.6 |
| **deepseek-standard** | `DEEPSEEK_API_KEY` (3 PCs) | deepseek-v4-pro, deepseek-v4-flash (API oficial) |
| **openrouter** | `OPENROUTER_API_KEY` (server, acer) | **8 curados** (bons e baratos p/ código) |

Cada modelo carrega no front: **contexto de tokens** (ex.: `1M`, `262K`) e **se é grátis ou o custo**
$/M (US$ de entrada/saída), vindos do catálogo oficial do CLI opencode.

> **Gratuitos do OpenCode normal (ZEN):** além do `ox-alpha-free` (opencode-go), o OpenCode expõe
> outros modelos **grátis** no endpoint `/zen/v1`. Testados ao vivo em 2026-08-24 (HTTP 200):
> `hy3-free`, `mimo-v2.5-free`, `laguna-s-2.1-free`, `nemotron-3.5-lightning-free`,
> `nemotron-3-ultra-free` e `big-pickle`. Eles vivem no provider `opencode-zen`
> (`OPENCODE_ZEN_API_KEY` = mesma valor da `OPENCODE_GO_API_KEY`, configurada nos 3 PCs). Os demais
> `*-free` do catálogo zen (deepseek-v4-flash-free, kimi-k2.5-free, minimax-m3-free, etc.) retornam
> "not supported"/"unavailable" e **não** foram incluídos.

> **Atualização automática:** o endpoint `GET /api/models/providers` consulta o relay
> `opencode.ai/zen/go/v1/models` **ao vivo** (com cache de 5 min). Se a OpenCode adicionar/remover
> modelos, o painel reflete sozinho em menos de 5 min — sem precisar mexer no código. Se a consulta
> falhar, cai na lista base embutida (os 29 atuais).

O reasoning de cada modelo é restrito ao que ele realmente aceita (ex.: `ox-alpha-free` → `low|high|max`;
`glm-5.2` → `high|max`; `hy3` → `none|low|high`; família deepseek → `none..max`), conforme o plugin
`opencode-zen` do Hermes. No OpenRouter os preços (USD/M tokens) ficam no badge de cada modelo.

## 📱 Mobile

O painel é **responsivo**: em telas ≤ 900px as 3 colunas viram 1, cards empilhados, toques maiores
(botões/selects ampliados), modal em tela cheia na base e drawer de logs em largura total. Teste no
celular entra direto pelo `https://modelos.cursar.space`. Validação visual em viewport 390px
(Chrome headless) confirmou layout sem overflow horizontal, botões com altura de toque (≥40px) e
labels de provider/modelo legíveis.

## ♻️ Sobrevivência ao reinício (reboot do server)

O painel sobe sozinho após um reboot do server-desktop:

- `controle-modelos.service` é um serviço **systemd do usuário `server`** com
  `WantedBy=default.target`. O usuário tem **`Linger=yes`** (via `loginctl show-user server`), então
  os serviços do usuário arrancam no boot **sem precisar de login**.
- O unit declara `After=media-server-HD\x20Backup.mount` + `Wants=...` → o painel **espera o HD
  externo montar** antes de subir (não há corrida com a montagem; se o HD faltar, o `Restart=always`
  tenta de novo até o mount aparecer).
- `cloudflared.service` (túnel público `modelos.cursar.space`) está `enabled` + `active` e sobe no
  boot (system service).
- Backups: os `.env` recebem `.bak-*` antes de editais; o repo é re-montado via
  `git reset --hard origin/main` após deploy.
