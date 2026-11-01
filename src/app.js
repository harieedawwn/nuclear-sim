// app.js - page wiring: main loop, panel, bottom sheet, chart, start screen, tour, quality, sound.
// Uses window.SimCore (physics) and either the 3D scene or the 2D window.Scene fallback.
import { showToast, softFail } from './errors.js';
import { probeWebGL, isSoftwareGL, initialTier, PerfMonitor, lowerTier } from './three/quality.js';
import { createAudio } from './audio/engine.js';

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/* ====================== storage (optional, never throws) ====================== */
const store = {
  get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
};

/* ====================== setup ====================== */
const SC = window.SimCore;
if (!SC) { showToast('Không tải được phần mô phỏng. Hãy tải lại trang.'); throw new Error('SimCore missing'); }
const DT = SC.CONFIG.dt;
const state = SC.createState();
window.__sim = { state, SC };

const INFO = {
  reactor: ['Lò phản ứng',
    'Phản ứng phân hạch trong lõi sinh ra nhiệt, các thanh điều khiển hấp thụ neutron để tăng hoặc giảm công suất. Nước sơ cấp ở khoảng 155 bar nên dù nóng hơn 300 °C vẫn không sôi: áp suất cao đẩy nhiệt độ sôi của nước lên rất cao. Ánh xanh trong nước quanh lõi là bức xạ Cherenkov.'],
  sg: ['Bình sinh hơi',
    'Nước nóng của vòng sơ cấp chảy trong hàng nghìn ống chữ U và truyền nhiệt qua thành ống cho nước vòng thứ cấp, làm nước này sôi thành hơi. Hai vòng nước không trộn lẫn nên hơi đưa sang tuabin không mang chất phóng xạ.'],
  pressurizer: ['Bình điều áp',
    'Bình điều áp giữ áp suất vòng sơ cấp ở khoảng 155 bar bằng bộ gia nhiệt điện và vòi phun nước. Nhờ áp suất cao, nước trong lò không sôi dù rất nóng.'],
  pump: ['Bơm sơ cấp',
    'Các bơm lớn đẩy nước sơ cấp đi vòng: từ lò sang bình sinh hơi rồi quay lại lò. Dòng nước mang nhiệt ra khỏi lõi và giữ cho lõi không quá nóng.'],
  containment: ['Nhà lò',
    'Toà nhà bê tông cốt thép dày hơn một mét, lót thép bên trong, bao kín lò phản ứng và vòng sơ cấp. Đây là lớp bảo vệ cuối cùng giữ chất phóng xạ lại bên trong nếu có sự cố.'],
  turbine: ['Tuabin',
    'Hơi áp suất cao thổi vào các tầng cánh làm trục quay. Hơi càng mạnh thì trục quay càng nhanh, tới khoảng 3000 vòng/phút, đúng tần số 50 Hz của lưới điện.'],
  generator: ['Máy phát điện',
    'Máy phát nối chung trục với tuabin và biến chuyển động quay thành điện. Tuabin quay càng nhanh thì công suất điện càng lớn.'],
  condenser: ['Bình ngưng',
    'Hơi đã đi qua tuabin được làm lạnh trong bình ngưng và trở lại thành nước. Bơm cấp nước đưa nước này quay về bình sinh hơi để tiếp tục vòng tuần hoàn.'],
  tower: ['Tháp làm mát',
    'Nước làm mát mang nhiệt thừa từ bình ngưng lên tháp, rơi như mưa bên trong và được không khí làm nguội. Cột trắng bốc lên là hơi nước, không phải khói.'],
  grid: ['Lưới điện',
    'Điện từ máy phát đi qua máy biến áp để tăng điện áp rồi theo đường dây truyền đến nhà dân và nhà máy. Lượng điện đưa lên lưới thay đổi theo công suất điện.']
};

const STATUS = {
  safe: ['An toàn', 'Lõi ở nhiệt độ bình thường, nhà máy chạy ổn định.'],
  idle: ['An toàn', 'Nhà máy đang không phát điện. Rút thanh điều khiển để khởi động lò.'],
  warn: ['Cảnh báo', 'Lõi đang nóng lên. Hãy hạ thanh điều khiển xuống.'],
  danger: ['Nguy hiểm', 'Lõi quá nóng! Hạ thanh ngay hoặc bấm SCRAM. Lò sẽ tự SCRAM sau 5 giây.'],
  scram: 'Đã SCRAM, thanh điều khiển bị khoá. Hãy chờ lõi nguội rồi bấm Khôi phục.',
  scramReady: 'Đã SCRAM, thanh điều khiển bị khoá. Lõi đã nguội: bấm Khôi phục để điều khiển lại.'
};

/* ====================== DOM refs ====================== */
const elApp = $('app'), elPanel = $('panel'), elScene = $('scene');
const elSlider = $('rods'), elSliderBox = $('slider'), elRodVal = $('rod-val');
const btnMinus = $('btn-minus'), btnPlus = $('btn-plus'), btnScram = $('btn-scram'), btnRecover = $('btn-recover');
const btnPause = $('btn-pause'), btnReset = $('btn-reset'), pauseLabel = $('pause-label');
const elStatus = $('status'), elSLabel = $('s-label'), elSText = $('s-text'), elAnnounce = $('announce');
const elInfo = $('info'), elHint = $('hint'), elThermo = $('c-tCore');

let paused = false, dirty = true, started = false;
let hintOn = !store.get('pwr_hint_seen');

function markInteracted() {
  if (!hintOn) return;
  hintOn = false;
  elHint.hidden = true;
  store.set('pwr_hint_seen', '1');
}

/* ====================== Zalo / Facebook tip ====================== */
(function () {
  let ua = '';
  try { ua = navigator.userAgent || ''; } catch (e) { ua = ''; }
  if (/Zalo|FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\//i.test(ua) && !store.get('pwr_tip_closed')) {
    $('tip').hidden = false;
    document.body.classList.add('has-tip');
    $('tip-close').addEventListener('click', () => {
      $('tip').hidden = true;
      document.body.classList.remove('has-tip');
      store.set('pwr_tip_closed', '1');
    });
  }
})();
$('toast-close').addEventListener('click', () => { $('toast').hidden = true; });

/* ====================== audio ====================== */
const audio = createAudio();
let soundOn = store.get('pwr_sound') !== '0';
let volume = clamp(parseFloat(store.get('pwr_volume') || '70'), 0, 100);
if (!isFinite(volume)) volume = 70;
const isIOS = (() => { try { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1); } catch (e) { return false; } })();
function syncSoundUI() {
  $('btn-sound').setAttribute('aria-pressed', String(soundOn));
  $('btn-sound').setAttribute('aria-label', soundOn ? 'Tắt âm thanh' : 'Bật âm thanh');
  $('sound-switch').setAttribute('aria-checked', String(soundOn));
  $('volume').value = String(volume);
  $('volume').disabled = !soundOn;
  $('sound-note').textContent = soundOn
    ? (isIOS ? 'Không nghe thấy? Hãy gạt công tắc im lặng của iPhone sang chế độ có chuông.' : 'Âm thanh được tạo trực tiếp theo trạng thái nhà máy.')
    : 'Âm thanh đang tắt. Trên iPhone, công tắc im lặng cũng tắt âm thanh.';
  document.querySelectorAll('#start-sound button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.s === 'on') === soundOn)));
}
function setSound(on, fromGesture) {
  soundOn = !!on;
  store.set('pwr_sound', soundOn ? '1' : '0');
  if (soundOn && fromGesture) { audio.unlock().catch(() => {}); }
  audio.setEnabled(soundOn && started);
  syncSoundUI();
}
$('btn-sound').addEventListener('click', () => { setSound(!soundOn, true); audio.ui('toggle'); });
$('sound-switch').addEventListener('click', () => { setSound(!soundOn, true); });
$('volume').addEventListener('input', () => {
  volume = clamp(parseFloat($('volume').value) || 0, 0, 100);
  audio.setVolume(volume / 100);
  store.set('pwr_volume', String(Math.round(volume)));
});
audio.setVolume(volume / 100);
syncSoundUI();

/* ====================== scene (3D with 2D fallback) ====================== */
let scene = null, sceneKind = 'none', glInfo = null, perf = null, tierAuto = 'medium';
let qualityPref = store.get('pwr_quality') || 'auto';
if (!/^(auto|high|medium|low)$/.test(qualityPref)) qualityPref = 'auto';
const TIER_VI = { high: 'Cao', medium: 'Trung bình', low: 'Thấp' };

function showInfo(id) {
  const d = INFO[id];
  if (!d) return;
  markInteracted();
  $('info-title').textContent = d[0];
  $('info-text').textContent = d[1];
  elInfo.hidden = false;
  closeSettings();
  if (sheet.active && sheet.expanded) sheet.set(false);
  audio.ui('open');
}
function closeInfo() { elInfo.hidden = true; }
function onRodDrag(w) {
  if (typeof w !== 'number' || !isFinite(w)) return;
  markInteracted();
  SC.setRods(state, w);
  dirty = true;
  updateControls();
}

function setProgress(p, text) {
  const v = Math.round(clamp(p, 0, 1) * 100);
  $('load-bar').style.width = v + '%';
  $('load').setAttribute('aria-valuenow', String(v));
  if (text) $('load-t').textContent = text;
}

function mount2D() {
  if (scene && scene.dispose) { try { scene.dispose(); } catch (e) { /* ignore */ } }
  scene = null; sceneKind = '2d';
  audio.setTier('low');
  elScene.textContent = '';
  elScene.className = 'scene is2d';
  if (window.Scene && window.Scene.mount) {
    try { scene = window.Scene.mount(elScene, { onPartTap: showInfo, onRodDrag }); }
    catch (e) { scene = null; softFail('scene.mount', e); elScene.textContent = 'Không vẽ được sơ đồ nhà máy. Các số liệu vẫn hoạt động.'; }
  }
  $('btn-overview').hidden = true;
  applyMotion();
  updateQualityNote();
  sceneReady();
}

function mount3D(tier) {
  elScene.className = 'scene';
  setProgress(0.15, 'Đang tải mô hình 3D…');
  return import('./three/scene3d.js').then((mod) => {
    setProgress(0.3, 'Đang dựng nhà máy…');
    return mod.mount3D(elScene, {
      onPartTap: showInfo, onRodDrag,
      onInteract: () => { markInteracted(); closeSettings(); },
      onProgress: (p) => setProgress(0.3 + p * 0.7),
      onContextLost: () => { contextLost = true; },
      onContextRestored: () => { contextLost = false; }
    }, { tier });
  }).then((s3) => {
    scene = s3; sceneKind = '3d';
    audio.setTier(s3.getQuality());
    window.__scene = s3;
    $('btn-overview').hidden = false;
    applyMotion();
    layoutInsets();
    perf = new PerfMonitor(onSlow);
    updateQualityNote();
    sceneReady();
  });
}
let contextLost = false;

function chooseScene() {
  glInfo = probeWebGL();
  tierAuto = initialTier(glInfo);
  const weak = !glInfo || (isSoftwareGL(glInfo) && qualityPref === 'auto');
  if (weak) { mount2D(); return; }
  mount3D(qualityPref === 'auto' ? tierAuto : qualityPref).catch((e) => {
    try { console.warn('[3d]', e && e.message); } catch (x) { /* ignore */ }
    mount2D();
  });
}

function onSlow(avg, warm) {
  if (qualityPref !== 'auto' || sceneKind !== '3d') return;
  const cur = scene.getQuality();
  const next = lowerTier(cur);
  if (next) { scene.setQuality(next); audio.setTier(next); perf.reset(); updateQualityNote(); }
  else if (warm && avg > 70) { mount2D(); }
}

function updateQualityNote() {
  document.querySelectorAll('#quality button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.q === qualityPref)));
  let t;
  if (sceneKind === '2d') t = glInfo ? 'Đang dùng bản vẽ 2D vì máy chạy 3D chậm. Chọn Thấp để thử 3D.' : 'Máy này không hỗ trợ 3D, đang dùng bản vẽ 2D.';
  else if (sceneKind === '3d') t = 'Đang dùng: ' + TIER_VI[scene.getQuality()] + (qualityPref === 'auto' ? ' (tự chọn theo máy)' : '');
  else t = '';
  $('q-note').textContent = t;
}
$('quality').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-q]');
  if (!b) return;
  qualityPref = b.dataset.q;
  store.set('pwr_quality', qualityPref);
  audio.ui('click');
  const tier = qualityPref === 'auto' ? tierAuto : qualityPref;
  if (sceneKind === '3d') { scene.setQuality(tier); audio.setTier(tier); if (perf) perf.reset(); updateQualityNote(); }
  else if (glInfo && qualityPref !== 'auto') { mount3D(tier).catch(() => mount2D()); }
  else updateQualityNote();
});
$('quality').addEventListener('keydown', (e) => {
  if (!/Arrow(Left|Right|Up|Down)/.test(e.key)) return;
  const bs = Array.from(document.querySelectorAll('#quality button'));
  const i = bs.indexOf(document.activeElement);
  if (i < 0) return;
  const n = bs[(i + (/Right|Down/.test(e.key) ? 1 : bs.length - 1)) % bs.length];
  n.focus(); n.click(); e.preventDefault();
});

const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
function applyMotion() {
  if (scene && scene.setReducedMotion) {
    try { scene.setReducedMotion(!!(mq && mq.matches)); } catch (e) { softFail('motion', e); }
  }
}
if (mq) { if (mq.addEventListener) mq.addEventListener('change', applyMotion); else if (mq.addListener) mq.addListener(applyMotion); }

$('info-close').addEventListener('click', closeInfo);
$('btn-overview').addEventListener('click', () => {
  markInteracted(); closeInfo(); audio.ui('click');
  if (scene && scene.overview) scene.overview();
});

/* ====================== settings popover ====================== */
const elSettings = $('settings'), btnSettings = $('btn-settings');
function closeSettings() { if (!elSettings.hidden) { elSettings.hidden = true; btnSettings.setAttribute('aria-expanded', 'false'); } }
btnSettings.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = elSettings.hidden;
  elSettings.hidden = !open;
  btnSettings.setAttribute('aria-expanded', String(open));
  audio.ui('click');
  if (open) updateQualityNote();
});
document.addEventListener('pointerdown', (e) => {
  if (!elSettings.hidden && !elSettings.contains(e.target) && !btnSettings.contains(e.target)) closeSettings();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('coach').hidden) { endTour(); return; }
  if (!elSettings.hidden) { closeSettings(); btnSettings.focus(); return; }
  if (!elInfo.hidden) closeInfo();
});

/* ====================== controls ====================== */
const ui = { w: -1, locked: null, canRec: null, key: '' };

function statusKey() {
  const lock = !!state.scrammed, rec = !!state.canRecover;
  const idle = state.status === 'safe' && state.pElec < 5 && !lock;
  return { lock, rec, idle, key: state.status + (lock ? (rec ? '|ready' : '|scram') : '') + (idle ? '|idle' : '') };
}
function updateControls() {
  const w = Math.round(state.w);
  if (w !== ui.w) {
    ui.w = w;
    elSlider.value = String(w);
    elSliderBox.style.setProperty('--p', String(w / 100));
    elRodVal.textContent = w + '%';
    elSlider.setAttribute('aria-valuetext', w + ' phần trăm');
  }
  const k = statusKey();
  if (k.lock !== ui.locked) {
    ui.locked = k.lock;
    elSlider.disabled = k.lock; btnMinus.disabled = k.lock; btnPlus.disabled = k.lock;
    elSliderBox.classList.toggle('locked', k.lock);
    elApp.classList.toggle('scrammed', k.lock);
  }
  if (k.rec !== ui.canRec) { ui.canRec = k.rec; btnRecover.disabled = !k.rec; }
  if (k.key !== ui.key) {
    const prev = ui.key;
    ui.key = k.key;
    const st = state.status in STATUS ? state.status : 'safe';
    const s = k.idle ? STATUS.idle : STATUS[st];
    elStatus.setAttribute('data-s', st);
    elApp.setAttribute('data-s', st);
    elThermo.setAttribute('data-s', st);
    elSLabel.textContent = k.lock ? 'SCRAM' : s[0];
    elSText.textContent = k.lock ? (k.rec ? STATUS.scramReady : STATUS.scram) : s[1];
    if (prev) elAnnounce.textContent = (k.lock ? 'SCRAM. ' : s[0] + '. ') + elSText.textContent;
  }
}

function userRods(w) {
  markInteracted();
  SC.setRods(state, w);
  dirty = true;
  updateControls();
}
elSlider.addEventListener('input', () => userRods(parseFloat(elSlider.value)));
btnMinus.addEventListener('click', () => { userRods(Math.max(0, (Math.ceil(state.w / 5 - 1e-9) - 1) * 5)); audio.ui('click'); });
btnPlus.addEventListener('click', () => { userRods(Math.min(100, (Math.floor(state.w / 5 + 1e-9) + 1) * 5)); audio.ui('click'); });
btnScram.addEventListener('click', () => { markInteracted(); SC.scram(state); dirty = true; updateControls(); audio.ui('press'); });
btnRecover.addEventListener('click', () => { markInteracted(); SC.recover(state); dirty = true; updateControls(); audio.ui('click'); });
btnPause.addEventListener('click', () => { markInteracted(); setPaused(!paused); audio.ui('click'); });
function setPaused(p) {
  paused = p;
  pauseLabel.textContent = p ? 'Tiếp tục' : 'Tạm dừng';
  btnPause.setAttribute('aria-label', p ? 'Tiếp tục' : 'Tạm dừng');
  btnPause.classList.toggle('is-paused', p);
  elApp.classList.toggle('paused', p);
  dirty = true;
}
btnReset.addEventListener('click', () => {
  markInteracted();
  SC.reset(state);
  acc = 0; stepCount = 0; resetHistory(); resetTrends();
  setPaused(false);
  updateControls();
  updateReadouts(true);
  chartDirty = true;
  audio.ui('click');
});

/* ====================== readouts, gauge, chain ====================== */
const RO = [
  { k: 'pTh', dec: 0, thr: 12, max: 3750, ids: ['v-pTh'], card: 'c-pTh' },
  { k: 'tCore', dec: 1, thr: 0.25, ids: ['v-tCore'], card: 'c-tCore' },
  { k: 'pSteam', dec: 1, thr: 0.12, max: 86.5, ids: ['v-pSteam'], card: 'c-pSteam' },
  { k: 'rpm', dec: 0, thr: 20, max: 3750, ids: ['v-rpm'], card: 'c-rpm' },
  { k: 'pElec', dec: 0, thr: 6, max: 1250, ids: ['v-pElec', 'v-pElec2', 'v-mini'], card: 'c-pElec', mirror: 'c-pElec2' }
];
const TREND_LABEL = { '1': 'đang tăng', '-1': 'đang giảm', '0': 'ổn định' };
RO.forEach((r) => {
  r.els = r.ids.map($); r.cardEl = $(r.card); r.arr = r.cardEl.querySelector('.arr');
  r.mirrorEl = r.mirror ? $(r.mirror) : null;
  r.s = ''; r.prev = state[r.k]; r.rate = 0; r.t = 0; r.disp = state[r.k]; r.f = -1;
});
let roSim = state.simTime;

function fmt(v, dec) {
  let s = dec ? v.toFixed(dec) : String(Math.round(v));
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  return s.replace('.', ',');
}
function resetTrends() {
  roSim = state.simTime;
  RO.forEach((r) => { r.prev = state[r.k]; r.rate = 0; r.t = 0; r.s = ''; r.disp = state[r.k]; });
}

// gauge geometry
const gVal = $('g-val');
let gLen = 0;
(function initGauge() {
  try { gLen = gVal.getTotalLength(); } catch (e) { gLen = 270; }
  gVal.style.strokeDasharray = gLen + ' ' + gLen;
  gVal.style.strokeDashoffset = String(gLen);
  const zone = document.querySelector('.g-zone');
  zone.style.strokeDasharray = '0 ' + (gLen * 1000 / 1200) + ' ' + (gLen * 200 / 1200) + ' ' + gLen;
  const g = $('g-ticks'), NS = 'http://www.w3.org/2000/svg';
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI - (i / 12) * Math.PI, c = Math.cos(a), s = Math.sin(a), major = i % 3 === 0;
    const ln = document.createElementNS(NS, 'line');
    const r0 = major ? 96 : 97.5, r1 = 101;
    ln.setAttribute('x1', (110 + r0 * c).toFixed(1)); ln.setAttribute('y1', (118 - r0 * s).toFixed(1));
    ln.setAttribute('x2', (110 + r1 * c).toFixed(1)); ln.setAttribute('y2', (118 - r1 * s).toFixed(1));
    g.appendChild(ln);
    if (major) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', (110 + 111 * c).toFixed(1)); t.setAttribute('y', (121 - 111 * s).toFixed(1));
      t.textContent = String(i * 100);
      g.appendChild(t);
    }
  }
})();

const flows = Array.from(document.querySelectorAll('.flow'));
const flowLvl = [-1, -1, -1];
function updateReadouts(snap) {
  const simDt = state.simTime - roSim;
  roSim = state.simTime;
  for (const r of RO) {
    const v = state[r.k];
    r.disp = snap || paused ? v : r.disp + (v - r.disp) * 0.55;
    if (Math.abs(r.disp - v) < (r.dec ? 0.05 : 0.5)) r.disp = v;
    const s = fmt(r.disp, r.dec);
    if (s !== r.s) { r.s = s; for (const e of r.els) e.textContent = s; }
    if (simDt > 0.001) r.rate += ((v - r.prev) / simDt - r.rate) * 0.35; else r.rate *= 0.5;
    r.prev = v;
    let t = r.t;
    if (r.rate > r.thr) t = 1; else if (r.rate < -r.thr) t = -1; else if (Math.abs(r.rate) < r.thr * 0.5) t = 0;
    if (t !== r.t) {
      r.t = t;
      r.cardEl.setAttribute('data-t', String(t));
      if (r.mirrorEl) r.mirrorEl.setAttribute('data-t', String(t));
      if (r.arr) r.arr.setAttribute('aria-label', TREND_LABEL[String(t)]);
    }
    const f = r.k === 'tCore' ? clamp((v - 40) / 340, 0, 1) : clamp(v / r.max, 0, 1);
    if (Math.abs(f - r.f) > 0.002) {
      r.f = f;
      r.cardEl.style.setProperty('--f', f.toFixed(3));
      if (r.mirrorEl) r.mirrorEl.style.setProperty('--f', f.toFixed(3));
    }
  }
  const pe = state.pElec;
  gVal.style.strokeDashoffset = (gLen * (1 - clamp(pe / 1200, 0, 1))).toFixed(1);
  $('pe-note').textContent = pe < 1 ? 'không phát điện' : Math.round(pe / 10) + '% công suất định mức';
  // flow chevrons between chain stages: speed follows each link
  const lv = [state.flowPrimary, state.flowSteam, state.flowCooling > 0 ? Math.max(state.flowCooling, pe / 1000) : 0];
  for (let i = 0; i < 3; i++) {
    const L = lv[i] < 0.03 ? 0 : lv[i] < 0.35 ? 1 : lv[i] < 0.75 ? 2 : 3;
    if (L !== flowLvl[i]) {
      flowLvl[i] = L;
      flows[i].classList.toggle('idle', L === 0);
      flows[i].style.setProperty('--dur', ['2s', '2.2s', '1.4s', '0.9s'][L]);
    }
  }
}

/* ====================== history + chart ====================== */
const HN = 300;                                   // 300 samples x 0.2 s = 60 s
const hT = new Float32Array(HN), hE = new Float32Array(HN);
let hHead = 0, hCount = 0, stepCount = 0;
function pushHist() {
  hT[hHead] = state.tCore; hE[hHead] = state.pElec;
  hHead = (hHead + 1) % HN;
  if (hCount < HN) hCount++;
}
function resetHistory() { hHead = 0; hCount = 0; pushHist(); }
resetHistory();

const cv = $('chart'), cbox = $('chart-box');
let ctx = null, cw = 0, chh = 0, dpr = 1, chartDirty = true;
try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
const FONT_C = '"Be Vietnam Pro",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
function sizeChart(w, h) {
  if (!(w > 0 && h > 0)) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cw = w; chh = h;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  chartDirty = true;
}
if (window.ResizeObserver) {
  new ResizeObserver((entries) => { const cr = entries[0] && entries[0].contentRect; if (cr) sizeChart(cr.width, cr.height); }).observe(cbox);
} else {
  window.addEventListener('resize', () => sizeChart(cbox.clientWidth, cbox.clientHeight));
  sizeChart(cbox.clientWidth, cbox.clientHeight);
}
function drawChart() {
  if (!ctx || !cw || !chh) return;
  const L = 30, Rt = 38, T = 8, B = 20, pw = cw - L - Rt, ph = chh - T - B;
  if (pw < 40 || ph < 40) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, chh);
  // danger band (350..400 degC)
  ctx.fillStyle = 'rgba(198,40,40,0.06)';
  ctx.fillRect(L, T, pw, ph * 50 / 400);
  ctx.lineWidth = 1; ctx.strokeStyle = '#E6E3DC';
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) { const y = Math.round(T + ph * i / 4) + 0.5; ctx.moveTo(L, y); ctx.lineTo(L + pw, y); }
  ctx.stroke();
  ctx.font = '500 10.5px ' + FONT_C; ctx.textBaseline = 'middle';
  ctx.textAlign = 'right'; ctx.fillStyle = '#A9452F';
  for (let i = 0; i <= 4; i++) ctx.fillText(String(i * 100), L - 6, T + ph * (1 - i / 4));
  ctx.textAlign = 'left'; ctx.fillStyle = '#1F4E79';
  for (let i = 0; i <= 4; i++) ctx.fillText(String(i * 300), L + pw + 6, T + ph * (1 - i / 4));
  ctx.textBaseline = 'top'; ctx.fillStyle = '#5F6A75';
  ctx.textAlign = 'left'; ctx.fillText('−60 s', L, T + ph + 6);
  ctx.textAlign = 'center'; ctx.fillText('−30 s', L + pw / 2, T + ph + 6);
  ctx.textAlign = 'right'; ctx.fillText('bây giờ', L + pw, T + ph + 6);
  if (hCount < 2) return;
  const start = (hHead - hCount + HN) % HN;
  plot(hE, 1200, '#1F4E79');
  plot(hT, 400, '#C8553D');
  function plot(arr, max, col) {
    let px = 0, py = 0;
    ctx.beginPath();
    for (let k = 0; k < hCount; k++) {
      const v = clamp(arr[(start + k) % HN] / max, 0, 1);
      px = L + pw * (HN - hCount + k) / (HN - 1);
      py = T + ph * (1 - v);
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, 6.2832); ctx.fillStyle = col; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, 6.5, 0, 6.2832); ctx.strokeStyle = col; ctx.globalAlpha = 0.25; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
  }
}

/* ====================== bottom sheet (phone portrait) ====================== */
const sheet = {
  active: false, expanded: false, collapsedH: 0, expandedH: 0,
  mq: window.matchMedia('(max-width: 899px) and (min-height: 521px), (max-width: 599px)'),
  measure() {
    const cs = getComputedStyle(elPanel);
    const pb = parseFloat(cs.paddingBottom) || 0;
    const controls = $('controls');
    this.collapsedH = Math.round(controls.offsetTop + controls.offsetHeight + pb);
    const maxH = parseFloat(cs.maxHeight) || window.innerHeight * 0.85;
    this.expandedH = Math.round(Math.min(maxH, elPanel.scrollHeight + 2));
  },
  apply(h) { elPanel.style.setProperty('--sheet-h', Math.round(h) + 'px'); },
  set(exp) {
    this.expanded = exp;
    if (!exp) elPanel.scrollTop = 0;
    elPanel.classList.toggle('expanded', exp);
    $('grip').setAttribute('aria-expanded', String(exp));
    $('grip').setAttribute('aria-label', exp ? 'Thu gọn bảng điều khiển' : 'Mở rộng bảng điều khiển');
    this.measure();
    this.apply(exp ? this.expandedH : this.collapsedH);
  },
  update() {
    const on = this.mq.matches;
    if (on !== this.active) {
      this.active = on;
      if (!on) { elPanel.style.removeProperty('--sheet-h'); elPanel.classList.remove('expanded'); this.expanded = false; }
    }
    if (on) { this.set(this.expanded); document.documentElement.style.setProperty('--sheet-collapsed', this.collapsedH + 'px'); }
    layoutInsets();
  }
};
(function sheetDrag() {
  const grip = $('grip'), head = elPanel.querySelector('.p-head');
  let d = null;
  const down = (e) => {
    if (!sheet.active || e.target.closest('button')) return;
    d = { y: e.clientY, h: elPanel.getBoundingClientRect().height, t: performance.now(), moved: false, id: e.pointerId };
    elPanel.classList.add('dragging');
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
  };
  const move = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 4) d.moved = true;
    sheet.apply(clamp(d.h - dy, sheet.collapsedH, sheet.expandedH));
  };
  const up = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.y, dt = performance.now() - d.t;
    elPanel.classList.remove('dragging');
    let exp;
    if (!d.moved) exp = !sheet.expanded;
    else if (Math.abs(dy) / Math.max(dt, 1) > 0.4) exp = dy < 0;
    else exp = (d.h - dy) > (sheet.collapsedH + sheet.expandedH) / 2;
    d = null;
    sheet.set(exp);
    audio.ui('click');
  };
  [grip, head].forEach((el) => {
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  grip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sheet.set(!sheet.expanded); } });
})();

function layoutInsets() {
  if (!scene || !scene.setInsets) return;
  const r = elPanel.getBoundingClientRect();
  if (sheet.active) scene.setInsets(0, sheet.collapsedH);
  else scene.setInsets(Math.max(0, window.innerWidth - r.left), 0);
}
let resizeT = 0;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => sheet.update(), 60); });
if (sheet.mq.addEventListener) sheet.mq.addEventListener('change', () => sheet.update());

/* ====================== start screen, tour, hint ====================== */
let readyFlag = false;
function sceneReady() {
  if (readyFlag) return;
  readyFlag = true;
  setProgress(1, 'Sẵn sàng');
  $('start').classList.add('ready');
  $('btn-start').disabled = false;
  if (!started) $('btn-start').focus({ preventScroll: true });
}
document.querySelectorAll('#start-sound button').forEach((b) => b.addEventListener('click', () => {
  soundOn = b.dataset.s === 'on';
  store.set('pwr_sound', soundOn ? '1' : '0');
  syncSoundUI();
}));
$('btn-start').addEventListener('click', () => {
  started = true;
  if (soundOn) { audio.unlock().then(() => { audio.setEnabled(soundOn); }).catch(() => {}); }
  audio.setEnabled(soundOn);
  audio.ui('press');
  $('start').classList.add('gone');
  setTimeout(() => { $('start').hidden = true; }, 600);
  if (!store.get('pwr_tour_done')) setTimeout(startTour, 450);
  else if (hintOn) elHint.hidden = false;
});

const TOUR = [
  { el: () => (sheet.active ? $('controls') : $('controls')), title: 'Thanh điều khiển',
    text: 'Kéo thanh trượt (hoặc kéo tay nắm vàng phía trên lò trong hình) để rút thanh điều khiển ra hay hạ xuống. Rút càng nhiều, lò càng nóng.' },
  { el: () => $('chain'), expand: true, title: 'Chuỗi năng lượng',
    text: 'Nhiệt từ lõi tạo hơi nước, hơi quay tuabin, tuabin quay máy phát điện. Mỗi khâu phản ứng chậm hơn khâu trước, hãy xem độ trễ lan dần.' },
  { el: () => $('btn-scram'), title: 'SCRAM: dừng lò khẩn cấp',
    text: 'Khi lõi quá nóng, bấm SCRAM để thả toàn bộ thanh điều khiển xuống. Nếu ở mức Nguy hiểm quá 5 giây, lò sẽ tự SCRAM.' },
  { el: () => $('stage'), camera: true, title: 'Quan sát nhà máy',
    text: 'Kéo để xoay, chụm hai ngón hoặc cuộn chuột để phóng to. Chạm vào một bộ phận để xem giải thích, bấm Toàn cảnh để quay lại.' }
];
let tourI = -1;
function startTour() {
  closeInfo(); closeSettings();
  elHint.hidden = true;
  tourI = -1;
  $('coach').hidden = false;
  nextTour();
}
function nextTour() {
  tourI++;
  if (tourI >= TOUR.length) { endTour(); return; }
  const s = TOUR[tourI];
  if (sheet.active) sheet.set(!!s.expand);
  $('coach-step').textContent = (tourI + 1) + ' / ' + TOUR.length;
  $('coach-title').textContent = s.title;
  $('coach-text').textContent = s.text;
  $('coach-next').textContent = tourI === TOUR.length - 1 ? 'Bắt đầu khám phá' : 'Tiếp';
  const place = () => {
    const el = s.el();
    if (s.expand && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    let r = el.getBoundingClientRect();
    if (s.camera) {
      const p = elPanel.getBoundingClientRect();
      r = sheet.active ? { left: 8, top: 64, right: window.innerWidth - 8, bottom: p.top - 8 } : { left: 12, top: 70, right: p.left - 12, bottom: window.innerHeight - 12 };
      r.width = r.right - r.left; r.height = r.bottom - r.top;
    }
    const pad = 6, spot = $('coach-spot'), card = $('coach-card');
    spot.style.left = (r.left - pad) + 'px'; spot.style.top = (r.top - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
    const cwid = card.offsetWidth, ch = card.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left = clamp(r.left + r.width / 2 - cwid / 2, 12, vw - cwid - 12), top;
    if (s.camera) top = clamp(r.top + r.height / 2 - ch / 2, 12, vh - ch - 12);
    else if (r.top - ch - 16 > 12) top = r.top - ch - 16;
    else if (r.bottom + ch + 16 < vh - 12) top = r.bottom + 16;
    else { top = clamp(r.top, 12, vh - ch - 12); left = r.left > cwid + 24 ? r.left - cwid - 16 : clamp(r.right + 16, 12, vw - cwid - 12); }
    card.style.left = left + 'px'; card.style.top = top + 'px';
  };
  setTimeout(place, sheet.active ? 420 : 30);
  $('coach-next').focus({ preventScroll: true });
}
function endTour() {
  $('coach').hidden = true;
  tourI = -1;
  store.set('pwr_tour_done', '1');
  if (sheet.active) sheet.set(false);
  if (hintOn) elHint.hidden = false;
}
$('coach-next').addEventListener('click', () => { audio.ui('click'); nextTour(); });
$('coach-skip').addEventListener('click', () => { audio.ui('click'); endTour(); });
$('btn-help').addEventListener('click', () => { audio.ui('click'); startTour(); });

/* ====================== main loop ====================== */
let raf = 0, last = null, acc = 0, uiAcc = 0, chartAcc = 0, sceneFails = 0;

function frame(ts) {
  raf = requestAnimationFrame(frame);
  if (last === null) { last = ts; return; }               // first frame after start/resume: no jump
  let dtReal = (ts - last) / 1000;
  last = ts;
  if (!(dtReal > 0)) dtReal = 0;
  if (perf && started && !paused) perf.frame(dtReal * 1000);
  if (dtReal > 0.25) dtReal = 0.25;

  if (!paused) {
    acc += dtReal;
    let n = 0;
    while (acc >= DT && n < 10) {
      SC.step(state, DT);
      if ((++stepCount & 3) === 0) pushHist();
      acc -= DT; n++;
    }
    if (n === 10 && acc >= DT) acc = 0;                   // drop backlog instead of spiralling
  }

  if (scene && sceneFails < 30 && !contextLost) {
    try { scene.update(state, paused ? 1e-6 : dtReal); sceneFails = 0; }
    catch (e) { if (++sceneFails === 1) softFail('scene.update', e); }
  }
  try { audio.update(state, dtReal, { paused, focus: scene && scene.focusedPart ? scene.focusedPart() : null }); } catch (e) { /* audio never breaks the loop */ }

  uiAcc += dtReal;
  if (uiAcc >= 0.1 || dirty) {
    uiAcc = 0;
    updateControls();
    updateReadouts(false);
  }
  chartAcc += dtReal;
  if (chartAcc >= 0.2 || (dirty && chartDirty)) {
    chartAcc = 0;
    if (!paused || chartDirty) {
      try { drawChart(); chartDirty = false; } catch (e) { chartDirty = false; softFail('chart', e); }
    }
  }
  dirty = false;
}

function start() { if (!raf && !document.hidden) { last = null; acc = 0; raf = requestAnimationFrame(frame); } }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    audio.suspend();
  } else {
    dirty = true; start();
    if (perf) perf.reset();
    audio.resume();
  }
});

if (hintOn) elHint.hidden = true;            // shown after the start screen
updateControls();
updateReadouts(true);
sheet.update();
chooseScene();
start();
