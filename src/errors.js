// errors.js - global error handler, installed before anything else.
// Reacts only to errors from our own files; ignores in-app browser (Zalo, Facebook) noise silently.
// Never blocks the page: at most a small dismissible toast.
const IGNORE_RE = /zalo|ZaloJavaBridge|zaloJSV2|webkit\.messageHandlers|FBAN|fbq/i;
const OWN_RE = /\/(?:assets\/[\w.-]+\.js|src\/[\w./-]+\.js|sim-core\.js)$/;
let lastToastAt = 0, toastTimer = 0;

export function showToast(msg) {
  try {
    const now = Date.now();
    if (now - lastToastAt < 5000) return;
    lastToastAt = now;
    const t = document.getElementById('toast');
    if (!t) return;
    document.getElementById('toast-msg').textContent = msg || 'Có lỗi nhỏ trong ứng dụng. Mô phỏng vẫn đang chạy.';
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 10000);
  } catch (e) { /* never throw from the error path */ }
}

// true only for our own script files on our own origin (query string and hash ignored)
export function isOwnUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  let u;
  try { u = new URL(raw, location.href); } catch (e) { return false; }
  if (u.protocol !== location.protocol || u.host !== location.host) return false;
  return OWN_RE.test(u.pathname);
}

window.addEventListener('error', (ev) => {
  try {
    if (!ev) return;
    const msg = String(ev.message || (ev.error && ev.error.message) || '');
    const file = String(ev.filename || '');
    if (!file) return;                                   // empty filename: host-injected script
    if (/^\s*script error\.?\s*$/i.test(msg)) return;    // cross-origin, no details
    if (IGNORE_RE.test(msg) || IGNORE_RE.test(file)) return;
    if (ev.error && IGNORE_RE.test(String(ev.error.stack || ''))) return;
    if (!isOwnUrl(file)) return;
    showToast();
  } catch (e) { /* ignore */ }
});

window.addEventListener('unhandledrejection', (ev) => {
  try {
    const r = ev && ev.reason;
    const text = r && typeof r === 'object' ? String(r.stack || '') + ' ' + String(r.message || '') : String(r);
    if (IGNORE_RE.test(text)) return;
    const urls = text.match(/(?:https?|file):\/\/[^\s)'"]+/g);
    if (!urls) return;
    if (isOwnUrl(urls[0].replace(/(:\d+){1,2}$/, ''))) showToast();
  } catch (e) { /* ignore */ }
});

export function softFail(where, e) {
  try { console.warn('[' + where + ']', e && e.message ? e.message : e); } catch (x) { /* ignore */ }
  showToast();
}
