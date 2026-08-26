const fs = require('fs');
const yaml = require('yaml');
const { runOnHost } = require('./sshRunner');

/**
 * Lê o conteúdo bruto do arquivo config.yaml do host especificado
 */
async function readRawConfig(pc, configPath) {
  if (pc === 'server') {
    try {
      if (!fs.existsSync(configPath)) {
        return { success: false, error: `Arquivo não encontrado: ${configPath}` };
      }
      const content = fs.readFileSync(configPath, 'utf8');
      return { success: true, content };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Se for host remoto, testa conexão primeiro para evitar travar ou soltar erro bruto de SSH
  const { probeHost } = require('./sshRunner');
  const probe = await probeHost(pc);
  if (!probe.online) {
    return {
      success: false,
      hostOffline: true,
      error: `Computador ${pc} está offline / desligado (${probe.error || 'timeout SSH'})`
    };
  }

  const cmd = pc === 'windows'
    ? `powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Content -Raw -Encoding UTF8 '${configPath}'"`
    : `cat "${configPath}"`;
  const res = await runOnHost(pc, cmd);
  if (!res.success) {
    return { success: false, error: `Falha ao ler arquivo via SSH (${pc}): ${res.stderr || res.error}` };
  }
  return { success: true, content: res.stdout };
}

/**
 * Grava o conteúdo atualizado no arquivo config.yaml do host com backup automático
 */
async function writeRawConfig(pc, configPath, newContent) {
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);

  if (pc !== 'server') {
    const { probeHost } = require('./sshRunner');
    const probe = await probeHost(pc);
    if (!probe.online) {
      return {
        success: false,
        hostOffline: true,
        error: `Computador ${pc} está offline / desligado (${probe.error || 'timeout SSH'})`
      };
    }
  }

  if (pc === 'server') {
    try {
      const backupPath = `${configPath}.bak-controle-${timestamp}`;
      if (fs.existsSync(configPath)) {
        fs.copyFileSync(configPath, backupPath);
      }
      // grava em tmp e move: se o processo morrer no meio, o config original continua íntegro
      // Preserva o modo do arquivo: writeFileSync cria com 0644/0664 (umask) e o rename levava
      // o config.yaml de 0600 para 0664 - alargando a permissao de um arquivo que guarda
      // provider/base_url e campos api_key. Comprovado nos backups de 2026-08-24.
      let originalMode = null;
      try { originalMode = fs.statSync(configPath).mode & 0o7777; } catch {}
      const tmpPath = `${configPath}.tmp-controle-${timestamp}`;
      fs.writeFileSync(tmpPath, newContent, 'utf8');
      if (originalMode !== null) fs.chmodSync(tmpPath, originalMode);
      fs.renameSync(tmpPath, configPath);
      return { success: true, backupPath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Backup e gravação remota no Linux (acer) — grava em tmp e move (atômico)
  if (pc === 'acer') {
    const backupPath = `${configPath}.bak-controle-${timestamp}`;
    const tmpPath = `${configPath}.tmp-controle-${timestamp}`;
    const base64Content = Buffer.from(newContent, 'utf8').toString('base64');
    const remoteCmd = `cp "${configPath}" "${backupPath}" && echo "${base64Content}" | base64 -d > "${tmpPath}" && mv "${tmpPath}" "${configPath}" && rm -f "${tmpPath}"`;
    const res = await runOnHost(pc, remoteCmd, { timeout: 30000 });
    if (!res.success) {
      return { success: false, error: `Falha ao gravar via SSH no acer: ${res.stderr || res.error}` };
    }
    return { success: true, backupPath };
  }

  // Backup e gravação remota no Windows usando PowerShell e Base64 (grava em tmp e move)
  if (pc === 'windows') {
    const backupPath = `${configPath}.bak-controle-${timestamp}`;
    const tmpPath = `${configPath}.tmp-controle-${timestamp}`;
    const base64Content = Buffer.from(newContent, 'utf8').toString('base64');
    const psCmd = `powershell -NoProfile -Command "Copy-Item -Path '${configPath}' -Destination '${backupPath}'; [System.IO.File]::WriteAllBytes('${tmpPath}', [System.Convert]::FromBase64String('${base64Content}')); Move-Item -Force -Path '${tmpPath}' -Destination '${configPath}'"`;
    const res = await runOnHost(pc, psCmd, { timeout: 30000 });
    if (!res.success) {
      return { success: false, error: `Falha ao gravar via SSH no Windows: ${res.stderr || res.error}` };
    }
    return { success: true, backupPath };
  }

  return { success: false, error: `Host desconhecido: ${pc}` };
}

/**
 * Faz parse do config.yaml e extrai dados do modelo e raciocínio.
 *
 * Não inventa valores: chave ausente vira `null` e entra em `missing`. Antes o parser devolvia
 * `ox-alpha-free`/`max` como se estivessem no arquivo, e o painel exibia uma configuração que
 * não existia no disco.
 */
function parseAgentConfig(rawContent) {
  try {
    const doc = yaml.parse(rawContent) || {};
    const model = doc.model || {};
    const agent = doc.agent || {};
    const delegation = doc.delegation || {};

    const missing = [];
    if (!doc.model) missing.push('model');
    else {
      if (!model.default) missing.push('model.default');
      if (!model.provider) missing.push('model.provider');
      if (!model.base_url) missing.push('model.base_url');
    }
    if (!doc.agent) missing.push('agent');
    else if (!agent.reasoning_effort) missing.push('agent.reasoning_effort');

    return {
      success: true,
      data: {
        model: model.default || null,
        provider: model.provider || null,
        baseUrl: model.base_url || null,
        apiMode: model.api_mode || null,
        reasoningEffort: agent.reasoning_effort || null,
        reasoningOverrides: agent.reasoning_overrides || {},
        hasDelegation: !!doc.delegation,
        delegation: {
          model: delegation.model || null,
          reasoningEffort: delegation.reasoning_effort || null,
          allowedModels: delegation.allowed_models || []
        },
        maxTurns: agent.max_turns || null,
        missing
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Um id de modelo com `/`, `:` ou iniciando por caractere especial precisa de aspas como chave YAML
function yamlKey(id) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ? id : JSON.stringify(id);
}

// Valor escalar: ids namespaced (`a/b`) são plain scalars válidos, mas aspas nunca atrapalham
function yamlValue(v) {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(v) ? v : JSON.stringify(v);
}

/**
 * Modifica o conteúdo do YAML cirurgicamente preservando comentários, ordem e formatação.
 *
 * Correções 2026-08-24:
 *  - antes, chave inexistente era simplesmente ignorada (um config sem `model.default` saía
 *    inalterado e a API respondia "sucesso"); agora a chave que falta é INSERIDA na seção certa;
 *  - `reasoning_overrides` aceita ids com `/` (OpenRouter) e faz o quoting correto;
 *  - o resultado é reconferido com o parser YAML antes de subir para o disco.
 *
 * Retorna { content, changed, inserted[], warnings[] }.
 */
function applyModelChangesToYaml(rawContent, updates) {
  const modelName = updates.model;
  const providerName = updates.provider;
  const baseUrl = updates.baseUrl;
  const reasoningEffort = updates.reasoningEffort || 'max';
  const previousModel = updates.previousModel || null;

  const lines = rawContent.split(/\r?\n/);
  const eol = rawContent.includes('\r\n') ? '\r\n' : '\n';

  let currentSection = null;
  let inReasoningOverrides = false;
  let reasoningOverridesFound = false;
  let overrideUpdated = false;

  const seen = {
    modelSection: false,
    agentSection: false,
    delegationSection: false,
    modelDefault: false,
    modelProvider: false,
    modelBaseUrl: false,
    agentReasoning: false
  };

  const newLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Identifica seções de nível 1
    const secMatch = line.match(/^([a-zA-Z0-9_-]+):/);
    if (secMatch) {
      // Fecha reasoning_overrides pendente antes de trocar de seção
      if (inReasoningOverrides && !overrideUpdated && modelName) {
        newLines.push(`    ${yamlKey(modelName)}: ${reasoningEffort}`);
        overrideUpdated = true;
      }
      currentSection = secMatch[1];
      inReasoningOverrides = false;
      if (currentSection === 'model') seen.modelSection = true;
      if (currentSection === 'agent') seen.agentSection = true;
      if (currentSection === 'delegation') seen.delegationSection = true;
      newLines.push(line);
      continue;
    }

    // Seção model:
    if (currentSection === 'model') {
      if (/^  default:/.test(line) && modelName) {
        seen.modelDefault = true;
        newLines.push(`  default: ${yamlValue(modelName)}`);
        continue;
      }
      if (/^  provider:/.test(line) && providerName) {
        seen.modelProvider = true;
        newLines.push(`  provider: ${yamlValue(providerName)}`);
        continue;
      }
      if (/^  base_url:/.test(line) && baseUrl) {
        seen.modelBaseUrl = true;
        newLines.push(`  base_url: ${baseUrl}`);
        continue;
      }
    }

    // Seção agent:
    if (currentSection === 'agent') {
      if (/^  reasoning_effort:/.test(line) && reasoningEffort) {
        seen.agentReasoning = true;
        newLines.push(`  reasoning_effort: ${reasoningEffort}`);
        continue;
      }

      if (/^  reasoning_overrides:/.test(line)) {
        reasoningOverridesFound = true;
        inReasoningOverrides = true;
        newLines.push(line);
        continue;
      }

      if (inReasoningOverrides) {
        // aceita ids namespaced e chaves entre aspas
        const overrideKeyMatch = line.match(/^ {4}("[^"]+"|'[^']+'|[A-Za-z0-9][A-Za-z0-9._/-]*)\s*:/);
        if (overrideKeyMatch) {
          const overrideKey = overrideKeyMatch[1].replace(/^["']|["']$/g, '');
          if (overrideKey === modelName) {
            newLines.push(`    ${yamlKey(modelName)}: ${reasoningEffort}`);
            overrideUpdated = true;
            continue;
          }
          if (previousModel && previousModel !== modelName && overrideKey === previousModel) {
            // remove o override órfão do modelo que saiu
            continue;
          }
        } else if (!/^ {4}/.test(line) && trimmed !== '') {
          // Saiu da sub-seção reasoning_overrides
          if (!overrideUpdated && modelName) {
            newLines.push(`    ${yamlKey(modelName)}: ${reasoningEffort}`);
            overrideUpdated = true;
          }
          inReasoningOverrides = false;
        }
      }
    }

    // Seção delegation: (só é tocada se já existir no arquivo)
    if (currentSection === 'delegation') {
      if (/^  reasoning_effort:/.test(line) && reasoningEffort) {
        newLines.push(`  reasoning_effort: ${reasoningEffort}`);
        continue;
      }
      if (/^  model:/.test(line) && modelName) {
        newLines.push(`  model: ${yamlValue(modelName)}`);
        continue;
      }
    }

    newLines.push(line);
  }

  // Arquivo terminou dentro de reasoning_overrides
  if (inReasoningOverrides && !overrideUpdated && modelName) {
    newLines.push(`    ${yamlKey(modelName)}: ${reasoningEffort}`);
    overrideUpdated = true;
  }

  // Caso reasoning_overrides exista mas não tenha recebido a chave do modelo atual
  if (reasoningOverridesFound && !overrideUpdated && modelName) {
    for (let i = 0; i < newLines.length; i++) {
      if (/^  reasoning_overrides:/.test(newLines[i])) {
        newLines.splice(i + 1, 0, `    ${yamlKey(modelName)}: ${reasoningEffort}`);
        overrideUpdated = true;
        break;
      }
    }
  }

  // ── Inserção das chaves que faltavam ───────────────────────────────────────
  const inserted = [];

  function insertUnderSection(sectionName, entries) {
    const idx = newLines.findIndex((l) => new RegExp(`^${sectionName}:`).test(l));
    if (idx === -1) return false;
    newLines.splice(idx + 1, 0, ...entries);
    return true;
  }

  if (seen.modelSection) {
    const pending = [];
    if (modelName && !seen.modelDefault) { pending.push(`  default: ${yamlValue(modelName)}`); inserted.push('model.default'); }
    if (providerName && !seen.modelProvider) { pending.push(`  provider: ${yamlValue(providerName)}`); inserted.push('model.provider'); }
    if (baseUrl && !seen.modelBaseUrl) { pending.push(`  base_url: ${baseUrl}`); inserted.push('model.base_url'); }
    if (pending.length) insertUnderSection('model', pending);
  } else if (modelName) {
    const block = ['model:', `  default: ${yamlValue(modelName)}`];
    if (providerName) block.push(`  provider: ${yamlValue(providerName)}`);
    if (baseUrl) block.push(`  base_url: ${baseUrl}`);
    newLines.unshift(...block);
    inserted.push('model');
  }

  if (seen.agentSection) {
    if (reasoningEffort && !seen.agentReasoning) {
      insertUnderSection('agent', [`  reasoning_effort: ${reasoningEffort}`]);
      inserted.push('agent.reasoning_effort');
    }
  } else if (reasoningEffort) {
    if (newLines.length && newLines[newLines.length - 1].trim() !== '') newLines.push('');
    newLines.push('agent:', `  reasoning_effort: ${reasoningEffort}`);
    inserted.push('agent');
  }

  const content = newLines.join(eol);

  // ── Conferência: o YAML resultante realmente ficou com o que foi pedido? ────
  const warnings = [];
  let parsed = null;
  try {
    parsed = yaml.parse(content) || {};
  } catch (e) {
    return { content: null, changed: false, inserted, warnings: [`YAML resultante inválido: ${e.message}`], ok: false };
  }

  const got = parsed.model || {};
  if (modelName && got.default !== modelName) warnings.push(`model.default ficou "${got.default}" em vez de "${modelName}"`);
  if (providerName && got.provider !== providerName) warnings.push(`model.provider ficou "${got.provider}" em vez de "${providerName}"`);
  if (baseUrl && got.base_url !== baseUrl) warnings.push(`model.base_url ficou "${got.base_url}" em vez de "${baseUrl}"`);
  const gotAgent = parsed.agent || {};
  if (reasoningEffort && gotAgent.reasoning_effort !== reasoningEffort) {
    warnings.push(`agent.reasoning_effort ficou "${gotAgent.reasoning_effort}" em vez de "${reasoningEffort}"`);
  }

  return {
    content,
    changed: content !== rawContent,
    inserted,
    warnings,
    ok: warnings.length === 0
  };
}

module.exports = {
  readRawConfig,
  writeRawConfig,
  parseAgentConfig,
  applyModelChangesToYaml
};
