# Controle de Modelos Hermes — Painel de Gestão da Frota

Painel web centralizado e sem autenticação para monitoramento, controle granular e em lote de modelos de IA (`model.default`, `provider`, `reasoning_effort`), teste de conectividade e reinício independente dos 13 agentes Hermes distribuídos nos 3 computadores da frota do Álvaro.

---

## 🎯 Objetivo do Projeto

Permitir que o Álvaro (ou qualquer agente autorizado) visualize e configure em tempo real, através de uma interface web simples e direta:
1. **O modelo de IA de cada um dos 13 agentes Discord** nos 3 computadores (`server-desktop`, `acer`, `windows`).
2. **O nível de raciocínio (*reasoning effort*)** de cada perfil (`none`, `low`, `medium`, `high`, `max`).
3. **Ações em lote**: Trocar modelo de todos os agentes de um computador ou de toda a frota com 1 clique.
4. **Reinício de Gateway independente por PC**: Reiniciar o gateway Hermes do servidor, do notebook ou do Windows sem interferir nos outros nós.
5. **Testes de conectividade ao vivo**: Executar o script `testar-provider-perfil.py` para validar se as credenciais e o modelo respondem com HTTP 200 e com o reasoning correto no fio.
6. **Cura e sincronização de perfis**: Disparar scripts de cura (`checar-perfis`) para alinhar variáveis de ambiente e `.env`.
7. **Hospedagem no `server-desktop` e Domínio `cursar.space`**:
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
