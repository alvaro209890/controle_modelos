# 05. Roteiro de Testes e Validação da Aplicação

Este documento contém o checklist de testes automatizados e procedimentos manuais para validar que o painel **Controle de Modelos Hermes** foi desenvolvido corretamente, está hospedado no `server-desktop` e responde publicamente pelo domínio **`cursar.space`** sem autenticação.

---

## 🧪 1. Checklist de Testes Automatizados da API e Domínio

### Teste 1.1: Disponibilidade Local e Frontend
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9120/
# Esperado: 200
```

### Teste 1.2: Disponibilidade Pública via Domínio `cursar.space`
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://modelos.cursar.space/
# Esperado: 200 (sem redirecionamentos de login ou bloqueios)
```

### Teste 1.3: Status da Frota (3 Computadores)
```bash
curl -s http://localhost:9120/api/fleet/status | jq .
# Esperado: Objeto JSON contendo os 3 hosts (server, acer, windows) com online: true
```

### Teste 1.4: Leitura dos 13 Agentes
```bash
curl -s http://localhost:9120/api/agents | jq '.count'
# Esperado: 13
```

Listagem dos agentes e modelos:
```bash
curl -s http://localhost:9120/api/agents | jq '.agents[] | {pc: .pc, profile: .profile, model: .model, reasoning: .reasoningEffort}'
```

### Teste 1.5: Catálogo Hierárquico de Provedores
```bash
# Novo endpoint hierárquico (Provider → Model → reasoning)
curl -s http://localhost:9120/api/models/providers | jq '.providers[] | {id, availableOn, models: [.models[].id]}'
# Esperado: 4 providers (opencode-go, xai-oauth, deepseek-standard, openrouter) com availableOn correto

# Lista plana (retrocompatível)
curl -s http://localhost:9120/api/models/presets | jq '.presets[] | .id'
# Esperado: ox-alpha-free, deepseek-v4-flash, hy3, grok-4.6, deepseek-v4-pro, deepseek-v4-flash (oficial), xiaomi/mimo-v2.5
```

### Teste 1.6: Validações de coerência do catálogo
```bash
# Provider ↔ Model incompatível → 400
curl -s -X POST http://localhost:9120/api/agents/server/geoforest/model \
  -H "Content-Type: application/json" \
  -d '{"model":"grok-4.6","provider":"opencode-go","reasoningEffort":"high"}'
# Esperado: 400 "O modelo grok-4.6 pertence ao provedor xai-oauth..."

# Reasoning não aceito pelo modelo → 400
curl -s -X POST http://localhost:9120/api/agents/server/geoforest/model \
  -H "Content-Type: application/json" \
  -d '{"model":"ox-alpha-free","reasoningEffort":"medium"}'
# Esperado: 400 "O modelo ox-alpha-free aceita apenas: low, high, max."

# Batch com alvo sem credencial do provedor → 400 antes de gravar
curl -s -X POST http://localhost:9120/api/agents/batch \
  -H "Content-Type: application/json" \
  -d '{"target":"windows","model":"grok-4.6","provider":"xai-oauth","reasoningEffort":"high"}'
# Esperado: 400 "O provedor xai-oauth não tem credencial ... nos PCs: windows."
```

---

## 🔒 2. Teste de Alteração de Modelo com Backup e Rollback

### Passo 2.1: Verificar o modelo atual do perfil `geoforest` do server
```bash
grep -A 2 "^model:" /home/server/.hermes/profiles/geoforest/config.yaml
```

### Passo 2.2: Disparar alteração via API
```bash
curl -s -X POST http://localhost:9120/api/agents/server/geoforest/model \
  -H "Content-Type: application/json" \
  -d '{
    "model": "ox-alpha-free",
    "provider": "opencode-go",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "reasoningEffort": "max"
  }' | jq .
```

### Passo 2.3: Validar a criação do arquivo de backup
```bash
ls -lt /home/server/.hermes/profiles/geoforest/config.yaml.bak-* | head -n 1
```

### Passo 2.4: Validar a integridade do YAML modificado
```bash
python3 -c "import yaml; yaml.safe_load(open('/home/server/.hermes/profiles/geoforest/config.yaml'))" && echo "YAML Válido!"
```

---

## ⚡ 3. Teste do Runner de Conectividade (`testar-provider-perfil.py`)

```bash
curl -s -X POST http://localhost:9120/api/fleet/test-provider \
  -H "Content-Type: application/json" \
  -d '{
    "pc": "server",
    "profile": "geoforest"
  }' | jq .
```

**Resultado esperado:**
- `success: true`, status HTTP 200 e confirmação de `effort_cfg=max wire=max`.

---

## 🔄 4. Teste de Reinício de Gateway por PC

```bash
# server-desktop:
curl -s -X POST http://localhost:9120/api/fleet/restart/server | jq .

# acer (SSH):
curl -s -X POST http://localhost:9120/api/fleet/restart/acer | jq .

# windows (SSH / Scheduled Task):
curl -s -X POST http://localhost:9120/api/fleet/restart/windows | jq .
```

---

## 🖥️ 5. Checklist de Validação Manual da Interface Web

Abra o navegador em `https://modelos.cursar.space` e teste os seguintes fluxos:

- [ ] A página abre diretamente pelo domínio `cursar.space` sem solicitar login ou senha.
- [ ] Os 3 computadores aparecem em 3 colunas organizadas com badges de status verde (Online).
- [ ] Todos os 13 agentes Discord aparecem em seus respectivos PCs com os emojis e nomes dos canais corretos.
- [ ] O seletor de modelos altera automaticamente os campos de Provedor e Base URL com base nos presets.
- [ ] Ao clicar em "Salvar" em um agente, um Toast de sucesso verde surge informando que o backup foi criado e o modelo alterado.
- [ ] Ao clicar em "Testar Conexão", um modal abre exibindo o log de resposta e confirmando HTTP 200.
- [ ] O botão "Trocar Modelo em Lote" abre o modal, permite selecionar o escopo (ex: toda a frota) e aplica as alterações em conjunto.
- [ ] O botão "Ver Logs" abre a gaveta lateral com o log em tempo real do gateway do host selecionado.

---

## 🆘 6. Procedimentos de Recuperação e Troubleshooting

| Problema | Causa Provável | Solução |
|---|---|---|
| **Erro 530 / 502 no domínio `cursar.space`** | O serviço local na porta 9120 ou o `cloudflared` está parado | Verifique `systemctl --user status controle-modelos.service` e `sudo systemctl status cloudflared.service`. |
| **Agente responde *"Provider authentication failed"*** | `.env` do perfil secundário perdeu a chave da API durante edição | Execute `checar-perfis` via botão "Curar Perfis" no painel ou rode `bash ~/.hermes/scripts/checar-perfis.sh`. |
| **Ox Alpha devolve HTTP 400 (*please use low, high, or max*)** | O reasoning foi configurado como `medium` ou `xhigh` | Altere o reasoning para `max` ou `high` pelo painel. |
| **PC Acer ou Windows aparece como Offline** | Conexão SSH / Tailscale com timeout | Verifique se o notebook/PC está ligado e autenticado na Tailscale com `ping 100.102.202.63`. |
| **Corrupção acidental do `config.yaml`** | Falha de formatação | Restaure o backup mais recente: `cp config.yaml.bak-controle-<ts> config.yaml`. |
