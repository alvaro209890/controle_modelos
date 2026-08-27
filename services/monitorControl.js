const { runOnHost, psEncoded } = require('./sshRunner');

/**
 * Controle de monitores da frota (2026-08-25) — aba "Monitores" do painel.
 *
 * Métodos herdados do que o Álvaro fez hoje com o opencode:
 *  - Linux (acer): `xrandr --output <saida> --off/--on` (desliga/religa saídas sem derrubar o X).
 *  - Windows: P/Invoke `user32.dll SendMessage(0xFFFF, 0x0112, 0xF170, lParam)`
 *    (SC_MONITORPOWER) — `2` desliga, `-1` liga. Mesmo método do opencode no 24/08.
 *
 * O painel roda no server e alcança os outros PCs via `ssh acer` / `ssh windows`,
 * exatamente como já faz para ler config.yaml e reiniciar gateway.
 */

const XRANDR_ENV = 'DISPLAY=:0 ';

/** Nome de saída X11 (eDP, HDMI-A-0, DP-2...). Whitelist estrita — nunca vai cru pro shell. */
const DISPLAY_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;

/** Resolução + posição atuais de cada saída, para religar com o mesmo modo/lugar. */
const lastState = new Map(); // `acer:HDMI-A-0` -> { mode, pos, primary }

function isInternalName(name) {
  return /^eDP/i.test(name) || /^LVDS/i.test(name);
}

/**
 * Roda `xrandr --query` no acer e interpreta o resultado.
 * Retorna lista de saídas: { name, internal, connected, active, primary, mode, pos }
 *  - active: saída ligada com CRTC (resolução+posição no xrandr)
 *  - connected: sinal presente (mesmo que a saída esteja --off)
 */
async function listAcerDisplays() {
  const res = await runOnHost('acer', `${XRANDR_ENV}xrandr --query`, { timeout: 15000 });
  if (!res.success) {
    return { ok: false, error: res.stderr || res.error || 'xrandr falhou no acer', displays: [] };
  }

  const displays = [];
  const lines = (res.stdout || '').split('\n');
  for (const line of lines) {
    // `eDP connected primary 1920x1080+0+0 (normal ...) 344mm x 194mm`
    const m = line.match(/^(\S+)\s+connected(?:\s+primary)?(?:\s+(\d+)x(\d+)\+(\d+)\+(\d+))?/);
    if (!m) continue;
    const [_, name, w, h, px, py] = m;
    const active = !!(w && h);
    const display = {
      name,
      internal: isInternalName(name),
      connected: true,
      active,
      primary: /primary/.test(line),
      mode: active ? `${w}x${h}` : null,
      pos: active ? { x: Number(px), y: Number(py) } : null
    };
    displays.push(display);
    if (display.connected) {
      lastState.set(`acer:${name}`, {
        mode: display.mode,
        pos: display.pos ? `${display.pos.x},${display.pos.y}` : null,
        primary: display.primary
      });
    }
  }

  // Saídas que existem mas estão sem cabo (desconectadas) não aparecem no xrandr;
  // nota de rodapé é o suficiente.
  return { ok: true, displays, error: null };
}

/**
 * Liga/desliga UMA saída do acer.
 * Ligar restaura modo/posição/primary do último estado conhecido (evita colar um monitor
 * externo 1366x768 por cima da tela do notebook em 1920x1080).
 */
async function setAcerDisplay(display, on) {
  if (!DISPLAY_NAME_RE.test(display)) {
    return { ok: false, error: `Nome de saída inválido: ${display}`, details: null };
  }

  let cmd;
  if (on) {
    const last = lastState.get(`acer:${display}`) || {};
    const parts = [`${XRANDR_ENV}xrandr --output ${display} --auto`];
    if (last.mode) parts.push(`--mode ${last.mode}`);
    if (last.pos) parts.push(`--pos ${last.pos}`);
    if (last.primary || isInternalName(display)) parts.push('--primary');
    cmd = parts.join(' ');
  } else {
    cmd = `${XRANDR_ENV}xrandr --output ${display} --off`;
  }

  const res = await runOnHost('acer', cmd, { timeout: 15000 });
  const state = await listAcerDisplays(); // re-lê para devolver o estado real atualizado
  return {
    ok: res.success,
    error: res.success ? null : (res.stderr || res.error || 'xrandr falhou'),
    output: res.stdout,
    displays: state.ok ? state.displays : [],
    details: state.ok ? null : state.error
  };
}

/**
 * Liga/desliga TODOS os monitores do Windows (SC_MONITORPOWER age global).
 * Mesmo método do opencode: user32 SendMessage(0xFFFF, 0x0112, 0xF170, lParam).
 */
function setWindowsPower(on) {
  const lParam = on ? -1 : 2;
  const script = [
    'Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @\'',
    '[DllImport("user32.dll")]',
    'public static extern int SendMessage(int hWnd, int Msg, int wParam, int lParam);',
    '\'@',
    `$r = [Win32.NativeMethods]::SendMessage(0xFFFF, 0x0112, 0xF170, ${lParam})`,
    `Write-Output "ret=${lParam}:$r"`
  ].join('\n');

  return runOnHost('windows', psEncoded(script), { timeout: 20000 }).then((res) => ({
    ok: res.success,
    error: res.success ? null : (res.stderr || res.error || 'SendMessage falhou'),
    output: res.stdout
  }));
}

module.exports = { listAcerDisplays, setAcerDisplay, setWindowsPower, DISPLAY_NAME_RE };
