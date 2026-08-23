const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { runOnHost, runLocalCommand } = require('./sshRunner');

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

  // Se for host remoto
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

  if (pc === 'server') {
    try {
      const backupPath = `${configPath}.bak-controle-${timestamp}`;
      if (fs.existsSync(configPath)) {
        fs.copyFileSync(configPath, backupPath);
      }
      fs.writeFileSync(configPath, newContent, 'utf8');
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
    const res = await runOnHost(pc, remoteCmd);
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
    const res = await runOnHost(pc, psCmd);
    if (!res.success) {
      return { success: false, error: `Falha ao gravar via SSH no Windows: ${res.stderr || res.error}` };
    }
    return { success: true, backupPath };
  }

  return { success: false, error: `Host desconhecido: ${pc}` };
}

/**
 * Faz parse do config.yaml e extrai dados do modelo e raciocínio
 */
function parseAgentConfig(rawContent) {
  try {
    const doc = yaml.parse(rawContent) || {};
    const model = doc.model || {};
    const agent = doc.agent || {};
    const delegation = doc.delegation || {};

    return {
      success: true,
      data: {
        model: model.default || 'ox-alpha-free',
        provider: model.provider || 'opencode-go',
        baseUrl: model.base_url || 'https://opencode.ai/zen/go/v1',
        apiMode: model.api_mode || 'chat_completions',
        reasoningEffort: agent.reasoning_effort || 'max',
        reasoningOverrides: agent.reasoning_overrides || {},
        delegation: {
          model: delegation.model || model.default || 'ox-alpha-free',
          reasoningEffort: delegation.reasoning_effort || agent.reasoning_effort || 'max',
          allowedModels: delegation.allowed_models || []
        },
        maxTurns: agent.max_turns || 500
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Modifica o conteúdo do YAML cirurgicamente preservando comentários, ordem e formatação
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

  const newLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Identifica seções de nível 1
    const secMatch = line.match(/^([a-zA-Z0-9_-]+):/);
    if (secMatch) {
      currentSection = secMatch[1];
      inReasoningOverrides = false;
      newLines.push(line);
      continue;
    }

    // Seção model:
    if (currentSection === 'model') {
      if (/^  default:/.test(line) && modelName) {
        newLines.push(`  default: ${modelName}`);
        continue;
      }
      if (/^  provider:/.test(line) && providerName) {
        newLines.push(`  provider: ${providerName}`);
        continue;
      }
      if (/^  base_url:/.test(line) && baseUrl) {
        newLines.push(`  base_url: ${baseUrl}`);
        continue;
      }
    }

    // Seção agent:
    if (currentSection === 'agent') {
      if (/^  reasoning_effort:/.test(line) && reasoningEffort) {
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
        if (/^    [a-zA-Z0-9_.-]+:/.test(line)) {
          const overrideKeyMatch = line.match(/^    ([a-zA-Z0-9_.-]+):/);
          if (overrideKeyMatch) {
            const overrideKey = overrideKeyMatch[1];
            if (overrideKey === modelName) {
              newLines.push(`    ${modelName}: ${reasoningEffort}`);
              overrideUpdated = true;
              continue;
            }
            if (previousModel && previousModel !== modelName && overrideKey === previousModel) {
              continue;
            }
          }
        } else if (!/^    /.test(line) && trimmed !== '') {
          // Saiu da sub-seção reasoning_overrides
          if (!overrideUpdated && modelName) {
            newLines.push(`    ${modelName}: ${reasoningEffort}`);
            overrideUpdated = true;
          }
          inReasoningOverrides = false;
        }
      }
    }

    // Seção delegation:
    if (currentSection === 'delegation') {
      if (/^  reasoning_effort:/.test(line) && reasoningEffort) {
        newLines.push(`  reasoning_effort: ${reasoningEffort}`);
        continue;
      }
      if (/^  model:/.test(line) && modelName) {
        newLines.push(`  model: ${modelName}`);
        continue;
      }
    }

    newLines.push(line);
  }

  // Caso reasoning_overrides não tenha recebido a chave do modelo atual
  if (reasoningOverridesFound && !overrideUpdated && modelName) {
    for (let i = 0; i < newLines.length; i++) {
      if (/^  reasoning_overrides:/.test(newLines[i])) {
        newLines.splice(i + 1, 0, `    ${modelName}: ${reasoningEffort}`);
        overrideUpdated = true;
        break;
      }
    }
  }

  return newLines.join(eol);
}

module.exports = {
  readRawConfig,
  writeRawConfig,
  parseAgentConfig,
  applyModelChangesToYaml
};
