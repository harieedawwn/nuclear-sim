// quality.js - pick a starting quality tier from device hints, then watch frame times.
const ORDER = ['low', 'medium', 'high'];

export function probeWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return null;
    let renderer = '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    const info = { webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext, renderer };
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return info;
  } catch (e) {
    return null;
  }
}

export function isSoftwareGL(info) {
  return !!info && /swiftshader|llvmpipe|softpipe|software|basic render/i.test(info.renderer);
}

export function initialTier(info) {
  let ua = '';
  try { ua = navigator.userAgent || ''; } catch (e) { ua = ''; }
  const touchMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  const mobile = /iPhone|iPad|iPod|Android/i.test(ua) || touchMac;
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const r = (info && info.renderer) || '';
  if (!info || !info.webgl2) return 'low';
  if (mobile) {
    if (/Android/i.test(ua) && (mem <= 3 || cores <= 4)) return 'low';
    if (/Mali-4|Mali-T|Adreno \(TM\) [3-5]\d\d|PowerVR/i.test(r)) return 'low';
    return 'medium';
  }
  if (/NVIDIA|GeForce|RTX|Radeon RX|Radeon Pro|Apple M\d|Apple GPU/i.test(r) && mem >= 8) return 'high';
  if (mem <= 4 && cores <= 4) return 'low';
  return 'medium';
}

// Frame-time monitor: during warm-up (first 3 s) and later, steps down when frames are too slow.
export class PerfMonitor {
  constructor(onDown) {
    this.onDown = onDown;
    this.reset();
  }
  reset() { this.acc = 0; this.n = 0; this.time = 0; this.window = 0; this.slow = 0; this.warm = true; this.samples = []; }
  frame(dtMs) {
    if (!(dtMs > 0) || dtMs > 400) return;           // tab switches, long stalls
    this.time += dtMs; this.acc += dtMs; this.n++;
    if (this.samples.length < 600) this.samples.push(dtMs);
    const span = this.warm ? 2500 : 4000;
    if (this.acc < span) return;
    const avg = this.acc / this.n;
    this.acc = 0; this.n = 0;
    if (this.warm) {
      this.warm = false;
      if (avg > 28) this.onDown(avg, true);
      return;
    }
    if (avg > 26) { this.slow++; if (this.slow >= 1) { this.slow = 0; this.onDown(avg, false); } }
    else this.slow = 0;
  }
  stats() {
    const s = this.samples.slice().sort((a, b) => a - b);
    if (!s.length) return null;
    const avg = s.reduce((a, b) => a + b, 0) / s.length;
    return { avg, p95: s[Math.floor(s.length * 0.95)], fps: 1000 / avg, n: s.length };
  }
}

export function lowerTier(t) { const i = ORDER.indexOf(t); return i > 0 ? ORDER[i - 1] : null; }
