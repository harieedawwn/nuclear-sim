/* app.js - page wiring for the PWR teaching simulator: main loop, panel, chart, error handling.
 * Classic script, ES2017, no libraries. Uses window.SimCore and window.Scene only. UTF-8. */
(function () {
  'use strict';

  /* ====================== error handling (installed first) ====================== */
  var OWN_FILES = ['index.html', 'sim-core.js', 'scene2d.js', 'app.js', 'main.js'];
  var IGNORE_RE = /zalo|ZaloJavaBridge|zaloJSV2|webkit\.messageHandlers|FBAN|fbq/i;
  var toastTimer = 0, lastToastAt = 0;

  function $(id) { return document.getElementById(id); }

  function showToast(msg) {
    try {
      var now = Date.now();
      if (now - lastToastAt < 5000) { return; }
      lastToastAt = now;
      var t = $('toast');
      if (!t) { return; }
      $('toast-msg').textContent = msg || 'Có lỗi nhỏ trong ứng dụng. Mô phỏng vẫn đang chạy.';
      t.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.hidden = true; }, 10000);
    } catch (e) { /* never throw from the error path */ }
  }

  // true only for our own files on our own origin (query string and hash ignored)
  function isOwnUrl(raw) {
    if (!raw || typeof raw !== 'string') { return false; }
    var u;
    try { u = new URL(raw, location.href); } catch (e) { return false; }
    if (u.protocol !== location.protocol || u.host !== location.host) { return false; }
    if (u.pathname === location.pathname) { return true; } // the page itself (inline code)
    return OWN_FILES.indexOf(u.pathname.split('/').pop()) !== -1;
  }

  window.addEventListener('error', function (ev) {
    try {
      if (!ev) { return; }
      var msg = String(ev.message || (ev.error && ev.error.message) || '');
      var file = String(ev.filename || '');
      if (!file) { return; }                                   // empty filename: host script
      if (/^\s*script error\.?\s*$/i.test(msg)) { return; }    // cross-origin, no details
      if (IGNORE_RE.test(msg) || IGNORE_RE.test(file)) { return; }
      if (ev.error && IGNORE_RE.test(String(ev.error.stack || ''))) { return; }
      if (!isOwnUrl(file)) { return; }
      showToast();
    } catch (e) { /* ignore */ }
  });

  window.addEventListener('unhandledrejection', function (ev) {
    try {
      var r = ev && ev.reason, text = '';
      if (r && typeof r === 'object') { text = String(r.stack || '') + ' ' + String(r.message || ''); } else { text = String(r); }
      if (IGNORE_RE.test(text)) { return; }
      var urls = text.match(/(?:https?|file):\/\/[^\s)'"]+/g);
      if (!urls) { return; }
      if (isOwnUrl(urls[0].replace(/(:\d+){1,2}$/, ''))) { showToast(); }
    } catch (e) { /* ignore */ }
  });

  function softFail(where, e) {
    try { console.warn('[' + where + ']', e && e.message ? e.message : e); } catch (x) { /* ignore */ }
    showToast();
  }

  /* ====================== storage (optional) ====================== */
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  /* ====================== setup ====================== */
  var SC = window.SimCore;
  if (!SC) { showToast('Không tải được sim-core.js. Hãy tải lại trang.'); return; }
  var DT = SC.CONFIG.dt;
  var state = SC.createState();

  var INFO = {
    reactor: ['Lò phản ứng',
      'Phản ứng phân hạch trong lõi sinh ra nhiệt, các thanh điều khiển hấp thụ neutron để tăng hoặc giảm công suất. Nước sơ cấp ở khoảng 155 bar nên dù nóng hơn 300 °C vẫn không sôi: áp suất cao đẩy nhiệt độ sôi của nước lên rất cao.'],
    sg: ['Bình sinh hơi',
      'Nước nóng của vòng sơ cấp truyền nhiệt qua thành ống cho nước vòng thứ cấp và biến nó thành hơi. Hai vòng nước không trộn lẫn nên hơi đưa sang tuabin không mang chất phóng xạ.'],
    turbine: ['Tuabin',
      'Hơi áp suất cao thổi vào các cánh quạt làm trục quay. Hơi càng mạnh thì trục quay càng nhanh, tới khoảng 3000 vòng/phút.'],
    generator: ['Máy phát điện',
      'Máy phát nối chung trục với tuabin và biến chuyển động quay thành điện. Tuabin quay càng nhanh thì công suất điện càng lớn.'],
    tower: ['Tháp làm mát',
      'Hơi sau tuabin được ngưng thành nước nhờ nước làm mát, tháp thải lượng nhiệt thừa ra không khí. Cột trắng bốc lên là hơi nước, không phải khói.'],
    grid: ['Lưới điện',
      'Điện từ máy phát đi qua máy biến áp để tăng điện áp rồi theo đường dây truyền đến nhà dân và nhà máy. Lượng điện đưa lên lưới thay đổi theo công suất điện.']
  };

  var STATUS = {
    safe: ['An toàn', 'Lõi ở nhiệt độ bình thường, nhà máy chạy ổn định.'],
    warn: ['Cảnh báo', 'Lõi đang nóng lên. Hãy hạ thanh điều khiển xuống.'],
    danger: ['Nguy hiểm', 'Lõi quá nóng! Hạ thanh ngay hoặc bấm SCRAM.'],
    scram: 'Đã SCRAM, thanh điều khiển bị khoá. Hãy chờ lõi nguội rồi bấm Khôi phục.',
    scramReady: 'Đã SCRAM, thanh điều khiển bị khoá. Lõi đã nguội: bấm Khôi phục để điều khiển lại.'
  };

  /* ====================== DOM refs ====================== */
  var elSlider = $('rods'), elSliderBox = $('slider'), elRodVal = $('rod-val');
  var btnMinus = $('btn-minus'), btnPlus = $('btn-plus'), btnScram = $('btn-scram'), btnRecover = $('btn-recover');
  var btnPause = $('btn-pause'), btnReset = $('btn-reset'), pauseLabel = $('pause-label');
  var elStatus = $('status'), elSLabel = $('s-label'), elSText = $('s-text');
  var elInfo = $('info'), elHint = $('hint');

  /* ====================== state flags ====================== */
  var paused = false, dirty = true;
  var hintOn = !store.get('pwr_hint_seen');
  if (!hintOn) { elHint.hidden = true; } else { elHint.hidden = false; }

  function markInteracted() {
    if (!hintOn) { return; }
    hintOn = false;
    elHint.hidden = true;
    store.set('pwr_hint_seen', '1');
  }

  /* ====================== Zalo / Facebook tip ====================== */
  (function () {
    var ua = '';
    try { ua = navigator.userAgent || ''; } catch (e) { ua = ''; }
    if (/Zalo|FBAN|FBAV|FB_IAB|FBIOS/i.test(ua) && !store.get('pwr_tip_closed')) {
      $('tip').hidden = false;
      document.body.className += ' has-tip';
      $('tip-close').addEventListener('click', function () {
        $('tip').hidden = true;
        document.body.className = document.body.className.replace(/\bhas-tip\b/, '').replace(/\s+$/, '');
        store.set('pwr_tip_closed', '1');
      });
    }
  })();

  $('toast-close').addEventListener('click', function () { $('toast').hidden = true; });

  /* ====================== scene ====================== */
  var scene = null;
  function showInfo(id) {
    var d = INFO[id];
    if (!d) { return; }
    markInteracted();
    $('info-title').textContent = d[0];
    $('info-text').textContent = d[1];
    elInfo.hidden = false;
  }
  function onRodDrag(w) {
    if (typeof w !== 'number' || !isFinite(w)) { return; }
    markInteracted();
    SC.setRods(state, w);
    dirty = true;
    updateControls();
  }
  if (window.Scene && window.Scene.mount) {
    try {
      scene = window.Scene.mount($('scene'), { onPartTap: showInfo, onRodDrag: onRodDrag });
    } catch (e) {
      scene = null;
      softFail('scene.mount', e);
      $('scene').textContent = 'Không vẽ được sơ đồ nhà máy. Các số liệu bên dưới vẫn hoạt động.';
    }
  } else {
    showToast('Không tải được scene.js. Hãy tải lại trang.');
  }
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function applyMotion() {
    if (scene && scene.setReducedMotion) {
      try { scene.setReducedMotion(!!(mq && mq.matches)); } catch (e) { softFail('motion', e); }
    }
  }
  applyMotion();
  if (mq) {
    if (mq.addEventListener) { mq.addEventListener('change', applyMotion); }
    else if (mq.addListener) { mq.addListener(applyMotion); }
  }
  $('info-close').addEventListener('click', function () { elInfo.hidden = true; });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !elInfo.hidden) { elInfo.hidden = true; }
  });

  /* ====================== controls ====================== */
  var ui = { w: -1, locked: null, canRec: null, key: '' };

  function updateControls() {
    var w = Math.round(state.w);
    if (w !== ui.w) {
      ui.w = w;
      elSlider.value = String(w);
      elSliderBox.style.setProperty('--p', String(w / 100));
      elRodVal.textContent = w + '%';
      elSlider.setAttribute('aria-valuetext', w + ' phần trăm');
    }
    var lock = !!state.scrammed;
    if (lock !== ui.locked) {
      ui.locked = lock;
      elSlider.disabled = lock; btnMinus.disabled = lock; btnPlus.disabled = lock;
      if (lock) { elSliderBox.className = 'slider locked'; } else { elSliderBox.className = 'slider'; }
    }
    var rec = !!state.canRecover;
    if (rec !== ui.canRec) { ui.canRec = rec; btnRecover.disabled = !rec; }

    var key = state.status + (lock ? (rec ? '|ready' : '|scram') : '');
    if (key !== ui.key) {
      ui.key = key;
      var s = STATUS[state.status] || STATUS.safe;
      elStatus.setAttribute('data-s', state.status in STATUS ? state.status : 'safe');
      elSLabel.textContent = s[0];
      elSText.textContent = lock ? (rec ? STATUS.scramReady : STATUS.scram) : s[1];
    }
  }

  function userRods(w) {
    markInteracted();
    SC.setRods(state, w);
    dirty = true;
    updateControls();
  }
  elSlider.addEventListener('input', function () { userRods(parseFloat(elSlider.value)); });
  btnMinus.addEventListener('click', function () {
    userRods(Math.max(0, (Math.ceil(state.w / 5 - 1e-9) - 1) * 5));
  });
  btnPlus.addEventListener('click', function () {
    userRods(Math.min(100, (Math.floor(state.w / 5 + 1e-9) + 1) * 5));
  });
  btnScram.addEventListener('click', function () {
    markInteracted(); SC.scram(state); dirty = true; updateControls();
  });
  btnRecover.addEventListener('click', function () {
    markInteracted(); SC.recover(state); dirty = true; updateControls();
  });
  btnPause.addEventListener('click', function () {
    markInteracted();
    setPaused(!paused);
  });
  function setPaused(p) {
    paused = p;
    pauseLabel.textContent = p ? 'Tiếp tục' : 'Tạm dừng';
    if (p) { btnPause.className = 'btn is-paused'; } else { btnPause.className = 'btn'; }
    dirty = true;
  }
  btnReset.addEventListener('click', function () {
    markInteracted();
    SC.reset(state);
    acc = 0; stepCount = 0; resetHistory(); resetTrends();
    setPaused(false);
    updateControls();
    updateReadouts();
    chartDirty = true;
  });

  /* ====================== readouts ====================== */
  var RO = [
    { k: 'pTh', dec: 0, thr: 12 }, { k: 'tCore', dec: 1, thr: 0.25 }, { k: 'pSteam', dec: 1, thr: 0.12 },
    { k: 'rpm', dec: 0, thr: 20 }, { k: 'pElec', dec: 0, thr: 6 }
  ];
  var TREND_LABEL = { '1': 'đang tăng', '-1': 'đang giảm', '0': 'ổn định' };
  RO.forEach(function (r) {
    r.card = $('c-' + r.k); r.vEl = $('v-' + r.k); r.arr = r.card.querySelector('.arr');
    r.s = ''; r.prev = state[r.k]; r.rate = 0; r.t = 0;
  });
  var roSim = state.simTime;

  function fmt(v, dec) {
    var s = dec ? v.toFixed(dec) : String(Math.round(v));
    if (/^-0(\.0+)?$/.test(s)) { s = s.slice(1); }
    return s.replace('.', ',');
  }
  function resetTrends() {
    var i, r;
    roSim = state.simTime;
    for (i = 0; i < RO.length; i++) { r = RO[i]; r.prev = state[r.k]; r.rate = 0; r.t = 0; r.s = ''; }
  }
  function updateReadouts() {
    var simDt = state.simTime - roSim, i, r, v, s, t;
    roSim = state.simTime;
    for (i = 0; i < RO.length; i++) {
      r = RO[i]; v = state[r.k];
      s = fmt(v, r.dec);
      if (s !== r.s) { r.s = s; r.vEl.textContent = s; }
      if (simDt > 0.001) { r.rate += ((v - r.prev) / simDt - r.rate) * 0.35; }
      else { r.rate *= 0.5; }
      r.prev = v;
      t = r.t;
      if (r.rate > r.thr) { t = 1; } else if (r.rate < -r.thr) { t = -1; } else if (Math.abs(r.rate) < r.thr * 0.5) { t = 0; }
      if (t !== r.t) {
        r.t = t;
        r.card.setAttribute('data-t', String(t));
        r.arr.setAttribute('aria-label', TREND_LABEL[String(t)]);
      }
    }
  }

  /* ====================== history + chart ====================== */
  var HN = 300;                                   // 300 samples x 0.2 s = 60 s
  var hT = new Float32Array(HN), hE = new Float32Array(HN), hHead = 0, hCount = 0, stepCount = 0;
  function pushHist() {
    hT[hHead] = state.tCore; hE[hHead] = state.pElec;
    hHead = (hHead + 1) % HN;
    if (hCount < HN) { hCount++; }
  }
  function resetHistory() { hHead = 0; hCount = 0; pushHist(); }
  resetHistory();

  var cv = $('chart'), cbox = $('chart-box'), ctx = null, cw = 0, chh = 0, dpr = 1, chartDirty = true;
  try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
  var FONT_C = '"Be Vietnam Pro",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';

  function sizeChart(w, h) {
    if (!(w > 0 && h > 0)) { return; }
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = w; chh = h;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    chartDirty = true;
  }
  if (window.ResizeObserver) {
    new ResizeObserver(function (entries) {
      var cr = entries[0] && entries[0].contentRect;
      if (cr) { sizeChart(cr.width, cr.height); }
    }).observe(cbox);
  } else {
    window.addEventListener('resize', function () { sizeChart(cbox.clientWidth, cbox.clientHeight); });
    sizeChart(cbox.clientWidth, cbox.clientHeight);
  }

  function drawChart() {
    if (!ctx || !cw || !chh) { return; }
    var L = 32, Rt = 42, T = 8, B = 20, pw = cw - L - Rt, ph = chh - T - B, i, y, x;
    if (pw < 40 || ph < 40) { return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, chh);
    ctx.lineWidth = 1; ctx.strokeStyle = '#E3E8ED';
    ctx.beginPath();
    for (i = 0; i <= 4; i++) { y = Math.round(T + ph * i / 4) + 0.5; ctx.moveTo(L, y); ctx.lineTo(L + pw, y); }
    for (i = 0; i <= 4; i++) { x = Math.round(L + pw * i / 4) + 0.5; ctx.moveTo(x, T); ctx.lineTo(x, T + ph); }
    ctx.stroke();
    ctx.font = '11px ' + FONT_C; ctx.textBaseline = 'middle';
    ctx.textAlign = 'right'; ctx.fillStyle = '#B85A22';
    for (i = 0; i <= 4; i++) { ctx.fillText(String(i * 100), L - 5, T + ph * (1 - i / 4)); }
    ctx.textAlign = 'left'; ctx.fillStyle = '#1E3A64';
    for (i = 0; i <= 4; i++) { ctx.fillText(String(i * 300), L + pw + 5, T + ph * (1 - i / 4)); }
    ctx.textBaseline = 'top'; ctx.fillStyle = '#5B6672';
    ctx.textAlign = 'left'; ctx.fillText('−60 s', L, T + ph + 5);
    ctx.textAlign = 'center'; ctx.fillText('−30 s', L + pw / 2, T + ph + 5);
    ctx.textAlign = 'right'; ctx.fillText('bây giờ', L + pw, T + ph + 5);

    if (hCount < 2) { return; }
    var start = (hHead - hCount + HN) % HN;
    plot(hE, 1200, '#1E3A64');
    plot(hT, 400, '#E8782F');

    function plot(arr, max, col) {
      var k, v, px = 0, py = 0;
      ctx.beginPath();
      for (k = 0; k < hCount; k++) {
        v = arr[(start + k) % HN] / max;
        v = v < 0 ? 0 : (v > 1 ? 1 : v);
        px = L + pw * (HN - hCount + k) / (HN - 1);
        py = T + ph * (1 - v);
        if (k) { ctx.lineTo(px, py); } else { ctx.moveTo(px, py); }
      }
      ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 3.5, 0, 6.2832); ctx.fillStyle = col; ctx.fill();
    }
  }

  /* ====================== main loop ====================== */
  var raf = 0, last = null, acc = 0, uiAcc = 0, chartAcc = 0, sceneFails = 0;

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (last === null) { last = ts; return; }                // first frame after start/resume: no jump
    var dtReal = (ts - last) / 1000;
    last = ts;
    if (!(dtReal > 0)) { dtReal = 0; }
    if (dtReal > 0.25) { dtReal = 0.25; }

    if (paused) {
      if (!dirty) { return; }
    } else {
      acc += dtReal;
      var n = 0;
      while (acc >= DT && n < 10) {
        SC.step(state, DT);
        if ((++stepCount & 3) === 0) { pushHist(); }
        acc -= DT; n++;
      }
      if (n === 10 && acc >= DT) { acc = 0; }                // drop backlog instead of spiralling
    }

    if (scene && sceneFails < 30) {
      try { scene.update(state, paused ? 1e-6 : dtReal); sceneFails = 0; }
      catch (e) { if (++sceneFails === 1) { softFail('scene.update', e); } }
    }

    uiAcc += dtReal;
    if (uiAcc >= 0.1 || dirty) {
      uiAcc = 0;
      updateControls();
      updateReadouts();
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
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    } else {
      dirty = true; start();
    }
  });

  updateControls();
  updateReadouts();
  start();
})();
