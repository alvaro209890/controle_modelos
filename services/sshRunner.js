const { exec } = require('child_process');

/**
 * Executa um comando no sistema local
 */
function runLocalCommand(cmd, options = {}) {
  return new Promise((resolve) => {
    const timeout = options.timeout || 15000;
    const startTime = Date.now();
    
    exec(cmd, { timeout, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      if (error) {
        return resolve({
          success: false,
          code: error.code || 1,
          error: error.message,
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim(),
          durationMs
        });
      }
      resolve({
        success: true,
        code: 0,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        durationMs
      });
    });
  });
}

/**
 * Executa um comando em um host específico (local se 'server', ou via SSH se 'acer'/'windows')
 */
async function runOnHost(host, cmd, options = {}) {
  if (host === 'server' || host === 'localhost' || host === 'server-desktop') {
    return runLocalCommand(cmd, options);
  }

  // Sanitiza e formata para chamada SSH com BatchMode e ConnectTimeout
  const timeoutSec = Math.ceil((options.timeout || 15000) / 1000);
  const escapedCmd = cmd.replace(/"/g, '\\"');
  const sshCmd = `ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new ${host} "${escapedCmd}"`;

  return runLocalCommand(sshCmd, { ...options, timeout: (timeoutSec + 2) * 1000 });
}

/**
 * Testa conectividade SSH com um host
 */
async function probeHost(host) {
  if (host === 'server' || host === 'localhost') {
    return { online: true, latencyMs: 0 };
  }
  const start = Date.now();
  const res = await runLocalCommand(`ssh -o BatchMode=yes -o ConnectTimeout=4 ${host} "echo ok"`, { timeout: 6000 });
  const latencyMs = Date.now() - start;
  return {
    online: res.success && res.stdout.includes('ok'),
    latencyMs: res.success ? latencyMs : null,
    error: res.success ? null : res.error
  };
}

module.exports = { runLocalCommand, runOnHost, probeHost };
