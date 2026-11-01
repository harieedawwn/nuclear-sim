/* scene.js — PWR plant illustration (flat-shaded 2:1 isometric, inline SVG). Draws only; no physics. UTF-8. */
(function (global) {
'use strict';
var NS = 'http://www.w3.org/2000/svg';
var S = 17, ZS = 19, OX = 385, OY = 215, PW = 22, PD = 16, R2 = Math.SQRT2;
var FONT = '"Be Vietnam Pro",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
var CON = ['#E6E1DA', '#CFC8BF', '#B3ABA1'], BLD = ['#CDB4A3', '#A88D7C', '#7E6A5E'],
  STL = ['#D4DCE3', '#AAB6C1', '#818E9B'], ORG = ['#F4A266', '#E8782F', '#B85A22'],
  GEN = ['#A7CDB4', '#7FAF92', '#5F8F74'], TEA = ['#7CC4CA', '#39A0A8', '#2A7A81'],
  WHT = ['#F6F8FA', '#DDE3E9', '#B9C3CD'], BLU = ['#A6B7D1', '#7E94B6', '#5B7194'],
  PUR = ['#B9A9D6', '#8E7DB8', '#6B5B93'];
var NAVY = '#1E3A64', AMBER = '#C98A12', RED = '#C62828';
var CORE_COL = ['#6FB1D6', '#F0C75E', '#E8913A', '#D9502E'];
var nodes = 0;

function f(n) { return Math.round(n * 10) / 10; }
function P(x, y, z) { return [OX + (x - y) * S, OY + (x + y) * S / 2 - (z || 0) * ZS]; }
function pts(a) { var s = ''; for (var i = 0; i < a.length; i++) s += (i ? ' ' : '') + f(a[i][0]) + ',' + f(a[i][1]); return s; }
function mix(a, b, k) {
  var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), o = 0;
  for (var i = 0; i < 3; i++) { var s = 16 - 8 * i, x = (pa >> s) & 255, y = (pb >> s) & 255; o = (o << 8) | Math.round(x + (y - x) * k); }
  return '#' + (0x1000000 + o).toString(16).slice(1);
}
function el(t, a, p) {
  var e = document.createElementNS(NS, t);
  if (a) for (var k in a) e.setAttribute(k, a[k]);
  if (p) p.appendChild(e);
  nodes++; return e;
}
function gr(p, a) { return el('g', a, p); }
function poly(p, a, fill) { return el('polygon', { points: pts(a), fill: fill, stroke: fill, 'stroke-width': 0.6, 'stroke-linejoin': 'round' }, p); }
function rect(p, x, y, w, h, fill, rx) { return el('rect', { x: f(x), y: f(y), width: f(w), height: f(h), rx: rx || 0, fill: fill }, p); }
function ell(p, c, rx, ry, fill) { return el('ellipse', { cx: f(c[0]), cy: f(c[1]), rx: f(rx), ry: f(ry), fill: fill }, p); }
function path(p, d, stroke, w, extra) {
  var a = { d: d, fill: 'none', stroke: stroke, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  if (extra) for (var k in extra) a[k] = extra[k];
  return el('path', a, p);
}
function pd(arr) { var s = ''; for (var i = 0; i < arr.length; i++) s += (i ? 'L' : 'M') + f(arr[i][0]) + ',' + f(arr[i][1]); return s; }
function wp(list) { return list.map(function (q) { return P(q[0], q[1], q[2]); }); }

/* iso box: faces top / left(+y) / right(+x) */
function ibox(p, x0, y0, z0, x1, y1, z1, T) {
  poly(p, [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], T[1]);
  poly(p, [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], T[2]);
  poly(p, [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], T[0]);
}
/* faceted strips between a top curve and a bottom curve of an ellipse-based solid */
function strips(p, cx, rx, topFn, botFn, T, us) {
  var cols = [mix(T[0], T[1], 0.45), T[1], T[2]];
  us = us || [-1, -0.25, 0.4, 1];
  for (var i = 0; i < us.length - 1; i++) {
    var a = [], b = [], n = 3;
    for (var k = 0; k <= n; k++) {
      var u = us[i] + (us[i + 1] - us[i]) * k / n, s = Math.sqrt(Math.max(0, 1 - u * u)), x = cx + rx * u;
      a.push([x, botFn(s)]); b.unshift([x, topFn(s)]);
    }
    poly(p, a.concat(b), cols[i]);
  }
}
/* vertical cylinder at world (x,y,z0), radius r, height h (world units) */
function cyl(p, x, y, z0, r, h, T, noTop) {
  var c = P(x, y, z0), rx = r * S * R2, ry = rx / 2, hp = h * ZS;
  strips(p, c[0], rx, function (s) { return c[1] - hp + ry * s; }, function (s) { return c[1] + ry * s; }, T);
  var top = null;
  if (!noTop) top = ell(p, [c[0], c[1] - hp], rx, ry, T[0]);
  return { x: c[0], y: c[1], rx: rx, ry: ry, hp: hp, top: top };
}
function domeCap(p, c, rx, ry, hh, T) {
  strips(p, c[0], rx, function (s) { return c[1] - hh * s; }, function (s) { return c[1] + ry * s; }, T);
}
function rail(p, a, b, n, h, col) {
  var d = '', i;
  for (i = 0; i <= n; i++) { var t = i / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t; d += 'M' + f(x) + ',' + f(y) + 'L' + f(x) + ',' + f(y - h); }
  d += 'M' + f(a[0]) + ',' + f(a[1] - h) + 'L' + f(b[0]) + ',' + f(b[1] - h);
  return path(p, d, col, 1, null);
}

/* ---------- symbols ---------- */
function buildDefs(svg) {
  var d = el('defs', null, svg), s;
  function sym(id, a) { var o = { id: id }; if (a) for (var k in a) o[k] = a[k]; return el('symbol', o, d); }
  function tree(id, c) {
    s = sym(id);
    rect(s, -1.6, -9, 3.2, 9, '#7A5A3E');
    poly(s, [[0, -37], [-9, -32], [-13, -22], [-9, -12], [0, -9]], c[1]);
    poly(s, [[0, -37], [9, -32], [13, -22], [9, -12], [0, -9]], c[2]);
    poly(s, [[0, -37], [-9, -32], [0, -24], [9, -32]], c[0]);
  }
  tree('tr1', ['#8DBD76', '#6FA35A', '#4F7F43']);
  tree('tr2', ['#F2B16A', '#E8913A', '#C0702A']);
  s = sym('pine');
  rect(s, -1.5, -7, 3, 7, '#6B4E36');
  [[-8, 15], [-19, 12], [-29, 9]].forEach(function (L) {
    poly(s, [[0, L[0] - 12], [-L[1] / 1.2, L[0] + 2], [0, L[0] - 1]], '#5C9A62');
    poly(s, [[0, L[0] - 12], [L[1] / 1.2, L[0] + 2], [0, L[0] - 1]], '#3F7040');
  });
  function person(id, col) {
    s = sym(id);
    rect(s, -1.8, -4, 1.6, 4, '#3E4A5E'); rect(s, 0.2, -4, 1.6, 4, '#2F3A4D');
    rect(s, -2.4, -9.6, 4.8, 5.8, col, 1.2);
    el('circle', { cx: 0, cy: -11.6, r: 2.1, fill: '#E8C3A0' }, s);
    rect(s, -2.3, -14.2, 4.6, 1.9, '#F2B705', 0.9);
  }
  person('p1', '#E8782F'); person('p2', '#3B6FA8'); person('p3', '#F6F8FA');
  s = sym('win', { viewBox: '0 0 10 20', preserveAspectRatio: 'none' });
  rect(s, 0, 0, 10, 20, '#7A8793'); rect(s, 1.2, 1.2, 7.6, 17.6, '#A9C8D8'); rect(s, 4.4, 1.2, 1.2, 17.6, '#7A8793');
  s = sym('puff');
  poly(s, [[-9, -4], [-4, -9], [4, -9], [9, -4], [9, 4], [4, 9], [-4, 9], [-9, 4]], '#FBFCFD');
  poly(s, [[9, -4], [9, 4], [4, 9], [-4, 9], [-1, 2], [6, -2]], '#C9D3DC');
  s = sym('bd');
  poly(s, [[-1, -0.4], [-0.4, -1], [0.4, -1], [1, -0.4], [1, 0.4], [0.4, 1], [-0.4, 1], [-1, 0.4]], '#46515D');
  for (var i = 0; i < 8; i++) {
    var a = i * Math.PI / 4, c = Math.cos(a), sn = Math.sin(a), q = function (r, w) { return [c * r - sn * w, sn * r + c * w]; };
    poly(s, [q(0.2, -0.13), q(0.9, -0.2), q(0.9, 0.2), q(0.2, 0.13)], i === 0 ? '#E8782F' : '#D4DCE3');
  }
  el('circle', { cx: 0, cy: 0, r: 0.2, fill: '#818E9B' }, s);
}
function use(p, id, x, y, sc) {
  var u = el('use', { href: '#' + id }, p);
  u.setAttribute('transform', 'translate(' + f(x) + ' ' + f(y) + ')' + (sc ? ' scale(' + sc + ')' : ''));
  return u;
}
/* windows placed on a vertical wall plane. plane 'y' (wall faces +y) or 'x' (faces +x) */
function windows(p, plane, fixed, list, z0, z1, wd) {
  var a = P(plane === 'y' ? 0 : fixed, plane === 'y' ? fixed : 0, 0);
  var g = gr(p, { transform: plane === 'y'
    ? 'matrix(' + S + ' ' + S / 2 + ' 0 ' + -ZS + ' ' + f(OX - fixed * S) + ' ' + f(OY + fixed * S / 2) + ')'
    : 'matrix(' + -S + ' ' + S / 2 + ' 0 ' + -ZS + ' ' + f(OX + fixed * S) + ' ' + f(OY + fixed * S / 2) + ')' });
  list.forEach(function (u) { el('use', { href: '#win', x: u, y: z0, width: wd, height: z1 - z0 }, g); });
}

/* ---------- mount ---------- */
function mount(container, cb) {
  cb = cb || {};
  nodes = 0;
  var R = { c: {} };
  var svg = el('svg', { xmlns: NS, viewBox: '0 0 800 600', preserveAspectRatio: 'xMidYMid meet', role: 'img',
    'aria-label': 'Sơ đồ nhà máy điện hạt nhân PWR' });
  svg.style.cssText = 'display:block;width:100%;height:auto;max-width:100%;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent';
  buildDefs(svg);
  rect(svg, 0, 0, 800, 600, '#EEF2F5');
  var gGround = gr(svg), gBack = gr(svg), gCont = gr(svg), gHall = gr(svg), gTower = gr(svg),
    gFront = gr(svg), gPipes = gr(svg), gTop = gr(svg), gLab = gr(svg), gHit = gr(svg);

  /* ===== ground ===== */
  (function () {
    var A = P(0, 0, 0), B = P(PW, 0, 0), C = P(PW, PD, 0), Dd = P(0, PD, 0), sd = 26;
    poly(gGround, [Dd, C, [C[0], C[1] + sd], [Dd[0], Dd[1] + sd]], '#8B6B4E');
    poly(gGround, [B, C, [C[0], C[1] + sd], [B[0], B[1] + sd]], '#735840');
    poly(gGround, [Dd, C, [C[0], C[1] + 9], [Dd[0], Dd[1] + 9]], '#7A5E44');
    poly(gGround, [B, C, [C[0], C[1] + 9], [B[0], B[1] + 9]], '#634C38');
    [[3, 16, 2.2], [11, 16, 1.6], [19, 16, 2.4]].forEach(function (q) {
      var c = P(q[0], q[1], 0); poly(gGround, [[c[0] - 6, c[1] + 17], [c[0] + 3, c[1] + 14], [c[0] + 9, c[1] + 19], [c[0] + 1, c[1] + 22]], '#6E5239');
    });
    poly(gGround, [A, B, C, Dd], '#9DC77A');
    poly(gGround, [Dd, C, [C[0], C[1] + 5], [Dd[0], Dd[1] + 5]], '#7FA95E');
    poly(gGround, [B, C, [C[0], C[1] + 5], [B[0], B[1] + 5]], '#6F9A52');
    [[1, 2, 3.5, 2], [14, 7.5, 3, 2.4], [5, 5.2, 2.5, 2], [19, 13.4, 2.6, 1.4], [10, 13.6, 2.2, 1.0]].forEach(function (q) {
      poly(gGround, [P(q[0], q[1]), P(q[0] + q[2], q[1]), P(q[0] + q[2], q[1] + q[3]), P(q[0], q[1] + q[3])], '#A9D088');
    });
    poly(gGround, [P(0, 14.3), P(PW, 14.3), P(PW, 14.8), P(0, 14.8)], '#D9D3C9');
    poly(gGround, [P(0, 14.8), P(PW, 14.8), P(PW, PD), P(0, PD)], '#8F8B94');
    path(gGround, pd([P(0, 15.4), P(PW, 15.4)]), '#F1EEE8', 1.4, { 'stroke-dasharray': '9 8', 'stroke-linecap': 'butt' });
    poly(gGround, [P(13.2, 12.6), P(13.9, 12.6), P(13.9, 14.3), P(13.2, 14.3)], '#D9D3C9');
    /* containment plaza + flat shadows */
    var pc = P(9, 4.5, 0);
    ell(gGround, [pc[0], pc[1] + 5], 3.75 * S * R2, 3.75 * S * R2 / 2, '#BDB7AD');
    ell(gGround, pc, 3.75 * S * R2, 3.75 * S * R2 / 2, '#D9D3C9');
    poly(gGround, [P(12.0, 3.0), P(15.6, 3.0), P(15.6, 6.4), P(12.0, 7.4)], '#86B066');
    poly(gGround, [P(14.2, 10.0), P(16.4, 10.0), P(16.4, 12.4), P(14.2, 12.4)], '#86B066');
  })();

  /* ===== back trees ===== */
  [[0.8, 3.2, 'tr2', 1], [1.4, 1.2, 'tr1', 1.1], [3.4, 0.8, 'pine', 1.1], [5.4, 0.7, 'tr1', 0.9], [7.0, 0.6, 'pine', 1.2],
   [11.8, 0.7, 'tr1', 1], [13.4, 1.0, 'pine', 1.1], [20.8, 0.8, 'tr1', 1], [21.0, 5.6, 'pine', 1], [21.2, 8.6, 'tr2', 1.1]].forEach(function (t) {
    var c = P(t[0], t[1]); use(gBack, t[2], c[0], c[1], t[4] || t[3]);
  });

  /* ===== containment (cut open) ===== */
  (function () {
    var g = gCont, cx = 9, cy = 4.5, Rr = 3, H = 7, Hd = 2.6;
    var c0 = P(cx, cy, 0), rx = Rr * S * R2, ry = rx / 2, cT = P(cx, cy, H), HP = H * ZS, hh = Hd * ZS, t = 7;
    function prof(u, off) { return cT[1] - (hh + (off || 0)) * Math.sqrt(Math.max(0, 1 - u * u)); }
    /* foundation, shell, floor */
    ell(g, [c0[0], c0[1] + 8], rx + t, ry + t / 2, '#A39B91');
    ell(g, c0, rx + t, ry + t / 2, '#CFC8BF');
    var sh = [[c0[0] - rx - t, c0[1]], [c0[0] - rx - t, cT[1]]], k;
    for (k = 1; k < 14; k++) { var u = -1 + 2 * k / 14; sh.push([c0[0] + (rx + t) * u, cT[1] - (hh + t) * Math.sqrt(1 - u * u)]); }
    sh.push([c0[0] + rx + t, cT[1]], [c0[0] + rx + t, c0[1]]);
    poly(g, sh, '#E6E1DA');
    ell(g, c0, rx, ry, '#E6E1DA');
    /* inner back wall facets */
    var tones = ['#B3ABA1', '#B3ABA1', '#BCB5AB', '#C5BEB4', '#CBC4BA', '#CFC8BF', '#CFC8BF', '#CFC8BF'], N = 8;
    for (k = 0; k < N; k++) {
      var a0 = Math.PI + Math.PI * k / N, a1 = Math.PI + Math.PI * (k + 1) / N;
      var x0 = c0[0] + rx * Math.cos(a0), x1 = c0[0] + rx * Math.cos(a1);
      var y0 = c0[1] + ry * Math.sin(a0), y1 = c0[1] + ry * Math.sin(a1);
      poly(g, [[x0, y0], [x1, y1], [x1, y1 - HP], [x0, y0 - HP]], tones[k]);
    }
    /* inner dome sections */
    var us = [-1, -0.5, 0, 0.5, 1], dt = ['#B3ABA1', '#BDB6AC', '#C9C2B8', '#D3CCC2'];
    for (k = 0; k < 4; k++) {
      var arr = [], j;
      for (j = 0; j <= 3; j++) { var u1 = us[k] + (us[k + 1] - us[k]) * j / 3; arr.push([c0[0] + rx * u1, cT[1] + ry * Math.sin(Math.PI + Math.acos(Math.max(-1, Math.min(1, u1))) * 0) * 0 - ry * Math.sqrt(1 - u1 * u1)]); }
      for (j = 3; j >= 0; j--) { var u2 = us[k] + (us[k + 1] - us[k]) * j / 3; arr.push([c0[0] + rx * u2, prof(u2, 0)]); }
      poly(g, arr, dt[k]);
    }
    /* rim ring (cut top of wall) */
    var rim = [];
    for (k = 0; k <= 10; k++) { var aa = Math.PI + Math.PI * k / 10; rim.push([c0[0] + (rx + t) * Math.cos(aa), cT[1] + (ry + t / 2) * Math.sin(aa)]); }
    for (k = 10; k >= 0; k--) { var ab = Math.PI + Math.PI * k / 10; rim.push([c0[0] + rx * Math.cos(ab), cT[1] + ry * Math.sin(ab)]); }
    poly(g, rim, '#F0ECE6');
    /* status outline */
    var ol = [[c0[0] - rx - t / 2, c0[1] + 2], [c0[0] - rx - t / 2, cT[1]]];
    for (k = 1; k < 20; k++) { var uo = -1 + 2 * k / 20; ol.push([c0[0] + (rx + t / 2) * uo, cT[1] - (hh + t / 2) * Math.sqrt(1 - uo * uo)]); }
    ol.push([c0[0] + rx + t / 2, cT[1]], [c0[0] + rx + t / 2, c0[1] + 2]);
    R.outline = path(g, pd(ol), '#B3ABA1', 3, null);
    R.c.cx = c0[0]; R.c.top = cT[1] - hh - t;

    /* polar crane */
    var yc = cT[1] - 0.3 * ZS, xl = c0[0] - rx + 4, xr = c0[0] + rx - 4;
    path(g, 'M' + f(xl - 4) + ',' + f(yc + 6) + 'L' + f(xr + 4) + ',' + f(yc + 6), '#818E9B', 3, null);
    poly(g, [[xl, yc - 4], [xr, yc - 4], [xr + 5, yc - 7], [xl + 5, yc - 7]], '#F4A266');
    rect(g, xl, yc - 4, xr - xl, 9, '#E8782F');
    rect(g, xl, yc + 3, xr - xl, 3, '#B85A22');
    var zz = 'M' + f(xl) + ',' + f(yc - 4);
    for (k = 1; k <= 14; k++) zz += 'L' + f(xl + (xr - xl) * k / 14) + ',' + f(k % 2 ? yc + 4 : yc - 4);
    path(g, zz, '#B85A22', 0.9, null);
    rect(g, xl - 3, yc - 8, 8, 15, '#B85A22', 1.5); rect(g, xr - 5, yc - 8, 8, 15, '#B85A22', 1.5);
    var tx = c0[0] + rx * 0.1;
    rect(g, tx - 7, yc - 9, 14, 10, '#818E9B', 1.5); rect(g, tx - 7, yc - 11, 14, 3, '#D4DCE3', 1.5);
    path(g, 'M' + f(tx) + ',' + f(yc + 1) + 'L' + f(tx) + ',' + f(yc + 22), '#46515D', 1, null);
    poly(g, [[tx - 3, yc + 22], [tx + 3, yc + 22], [tx + 1.5, yc + 28], [tx - 1.5, yc + 28]], '#E8782F');

    /* ---- equipment ---- */
    var V = P(10.08, 3.32, 0), Vrx = 1.0 * S * R2, Vry = Vrx / 2;
    R.V = V;
    ell(g, [V[0], V[1] + 3], Vrx + 6, Vry + 3, '#B3ABA1');
    ell(g, V, Vrx + 6, Vry + 3, '#D9D3C9');
    var vessel = cyl(g, 10.08, 3.32, 0.1, 1.0, 4.5, STL);
    var vtY = vessel.y - vessel.hp;
    /* head */
    var head = cyl(g, 10.08, 3.32, 4.6, 0.9, 0.3, STL);
    domeCap(g, [head.x, head.y - head.hp], head.rx, head.ry, 9, STL);
    var hy = head.y - head.hp;
    [[-10, 1], [-5, 4], [0, 6], [5, 4], [10, 1]].forEach(function (q) {
      rect(g, head.x + q[0] - 2.4, hy - 18 + q[1] - 2, 4.8, 17, '#6F7C88', 1);
      rect(g, head.x + q[0] - 2.4, hy - 18 + q[1] - 2, 2, 17, '#AAB6C1', 1);
      ell(g, [head.x + q[0], hy - 18 + q[1] - 2], 2.4, 1.2, '#D4DCE3');
    });
    R.c.headTop = hy - 20;
    /* nozzles (left) */
    var ny1 = V[1] - 1.9 * ZS, ny2 = V[1] - 0.45 * ZS;
    [ny1, ny2].forEach(function (yy) {
      rect(g, V[0] - Vrx - 9, yy - 6, 12, 12, '#7E8B98', 2); rect(g, V[0] - Vrx - 9, yy - 6, 12, 3, '#AAB6C1', 1.5);
    });
    R.hotY = ny1; R.coldY = ny2;
    /* vessel window: plenum + core */
    var wx = V[0] - 13, ww = 26, wTop = vtY + 8, wBot = V[1] - 10, coreTop = wBot - 36;
    rect(g, wx - 1.5, wTop - 1.5, ww + 3, wBot - wTop + 3, '#5E6B78', 3);
    rect(g, wx, wTop, ww, wBot - wTop, '#39424D', 2);
    R.core = rect(g, wx, coreTop, ww, 36, CORE_COL[1], 0); R.core._c = {};
    for (k = 0; k < 4; k++) rect(g, wx + 3 + k * 6, coreTop + 1, 3.2, 34, '#FFF3C4').setAttribute('fill-opacity', 0.5);
    for (k = 0; k < 4; k++) rect(g, wx + 2 + k * 6.4, wTop + 3, 2, 6, '#818E9B');
    R.rods = [];
    R.rodTop = wTop + 1; R.coreTop = coreTop; R.coreH = 36;
    [4.5, 12.5, 20.5].forEach(function (dx) {
      var r = rect(g, 0, 0, 2.6, 1, '#252B33', 0.5);
      r._c = {}; r.__x = wx + dx; r.__len = (coreTop + 36 - 2) - R.rodTop;
      R.rods.push(r);
    });
    R.c.vtop = vtY;

    /* steam generator */
    var SGx = 7.74, SGy = 6.27, sgp = P(SGx, SGy, 0), sgr = 0.7, sgrx = sgr * S * R2, SGH = 5.0;
    ell(g, [sgp[0], sgp[1] + 2], sgrx + 5, sgrx / 2 + 2.5, '#B3ABA1');
    ell(g, sgp, sgrx + 5, sgrx / 2 + 2.5, '#D9D3C9');
    var sg = cyl(g, SGx, SGy, 0.1, sgr, SGH, ORG, true);
    domeCap(g, [sg.x, sg.y - sg.hp], sg.rx, sg.ry, 15, ORG);
    rect(g, sg.x - 3, sg.y - sg.hp - 19, 6, 6, '#7E8B98', 1.5);
    R.sgTop = [sg.x, sg.y - sg.hp - 19]; R.sg = sg;
    var swx = sg.x - 8.5, sww = 17, swTop = sg.y - sg.hp + 22, swBot = sg.y - 16;
    rect(g, swx - 1.5, swTop - 1.5, sww + 3, swBot - swTop + 3, '#7E8B98', 3);
    rect(g, swx, swTop, sww, swBot - swTop, '#E6EEF3', 2);
    R.sgBot = swBot; R.sgH = swBot - swTop;
    R.water = rect(g, 0, -1, 1, 1, '#4F8FCB', 0); R.water._c = {};
    R.water.__x = swx; R.water.__w = sww;
    path(g, 'M' + f(swx + 3) + ',' + f(swBot) + 'V' + f(swBot - 28) + 'a2.5,2.5 0 0 1 5,0V' + f(swBot) +
      'M' + f(swx + 9.5) + ',' + f(swBot) + 'V' + f(swBot - 24) + 'a2.2,2.2 0 0 1 4.4,0V' + f(swBot), '#D9502E', 1.1, { opacity: 0.85 });
    R.bubbles = [];
    for (k = 0; k < 16; k++) {
      var b = el('circle', { cx: 0, cy: 0, r: 1.15 + (k % 3) * 0.3, fill: '#FFFFFF', opacity: 0 }, g);
      b._c = {}; b.__x = swx + 2.2 + ((k * 5.3) % (sww - 4.4)); b.__ph = (k * 0.618) % 1;
      R.bubbles.push(b);
    }
    /* reactor coolant pump */
    var pump = cyl(g, 9.5, 5.4, 0, 0.46, 0.75, BLU);
    var motor = cyl(g, 9.5, 5.4, 0.75, 0.3, 0.95, PUR);
    rect(g, motor.x - 7, motor.y - motor.hp + 3, 14, 2.5, '#6B5B93', 1);
    R.pump = pump;
  })();

  /* ===== turbine hall (cut open) ===== */
  (function () {
    var g = gHall, X0 = 1.6, X1 = 9.0, Y0 = 8.8, Y1 = 12.8, Hh = 5.5, wt = 0.35;
    ibox(g, X0 - wt, Y0 - wt, -0.25, X1, Y1, 0, CON);
    ibox(g, X0, Y0 - wt, 0, X1, Y0, Hh, CON);
    ibox(g, X0 - wt, Y0 - wt, 0, X0, Y1, Hh, CON);
    windows(g, 'y', Y0, [2.1, 3.3, 4.5, 5.7, 6.9, 8.1], 2.4, 5.0, 0.8);
    windows(g, 'x', X0, [9.3, 10.5, 11.7], 2.4, 5.0, 0.8);
    /* roof underside (rear slope) + gable */
    poly(g, [P(X0, Y0, Hh), P(X1, Y0, Hh), P(X1, 10.8, Hh + 1.35), P(X0, 10.8, Hh + 1.35)], BLD[1]);
    poly(g, [P(X0, Y0, Hh + 0.0), P(X1, Y0, Hh), P(X1, Y0 + 0.2, Hh + 0.12), P(X0, Y0 + 0.2, Hh + 0.12)], BLD[2]);
    poly(g, [P(X0, Y0, Hh), P(X0, Y1, Hh), P(X0, 10.8, Hh + 1.35)], '#B3ABA1');
    /* trusses */
    var td = '';
    [2.2, 3.6, 5.0, 6.4, 7.8, 8.9].forEach(function (x) {
      var rz = function (y) { return Hh + 1.35 * (1 - Math.abs(y - 10.8) / 2.0); };
      td += pd([P(x, Y0, Hh), P(x, 10.8, Hh + 1.35), P(x, Y1, Hh), P(x, Y0, Hh)]);
      [9.6, 10.2, 11.4, 12.0].forEach(function (y) { td += pd([P(x, y, Hh), P(x, y, rz(y))]); });
      td += pd([P(x, 9.6, Hh), P(x, 10.2, rz(10.2)), P(x, 10.8, Hh), P(x, 11.4, rz(11.4)), P(x, 12.0, Hh)]);
    });
    path(g, td, '#7A8793', 1.1, null);
    path(g, pd([P(X0, 10.8, Hh + 1.35), P(X1, 10.8, Hh + 1.35)]) + pd([P(X0, Y1, Hh), P(X1, Y1, Hh)]), '#7A8793', 1.4, null);
    /* overhead crane */
    ibox(g, X0 + 0.05, Y0 + 0.05, 4.35, X1, Y0 + 0.25, 4.5, STL);
    ibox(g, 4.8, Y0 + 0.2, 4.45, 5.3, Y1, 4.7, ORG);
    ibox(g, 4.7, 10.4, 4.15, 5.4, 11.1, 4.45, STL);
    path(g, pd([P(5.05, 10.75, 4.15), P(5.05, 10.75, 3.7)]), '#46515D', 1, null);
    /* operating deck frame + condenser */
    ibox(g, 3.9, 10.0, 0, 7.1, 11.7, 1.3, TEA);
    ibox(g, 7.1, 10.1, 0, 7.4, 11.6, 1.1, TEA);
    ibox(g, 3.6, 10.1, 0, 3.9, 11.6, 1.1, TEA);
    for (var k = 0; k < 6; k++) path(g, pd([P(4.1 + k * 0.5, 11.7, 0.15), P(4.1 + k * 0.5, 11.7, 1.15)]), '#2A7A81', 1, null);
    ibox(g, 2.1, 9.9, 1.3, 8.8, 10.15, 1.62, CON);
    ibox(g, 2.1, 11.45, 1.3, 8.8, 11.7, 1.62, CON);
    [2.2, 3.7, 7.0, 8.6].forEach(function (x) { ibox(g, x, 11.45, 0, x + 0.25, 11.7, 1.3, CON); ibox(g, x, 9.9, 0, x + 0.25, 10.15, 1.3, CON); });
    /* generator */
    ibox(g, 2.2, 10.2, 1.62, 3.8, 11.4, 3.2, GEN);
    ibox(g, 2.4, 10.4, 3.2, 3.6, 11.2, 3.45, GEN);
    ibox(g, 3.8, 10.45, 1.62, 4.0, 11.15, 2.6, STL);
    ibox(g, 2.0, 10.35, 1.62, 2.2, 11.25, 2.4, ORG);
    /* LP, HP casings */
    ibox(g, 4.0, 10.1, 1.62, 5.4, 11.5, 3.5, STL); ibox(g, 4.2, 10.3, 3.5, 5.2, 11.3, 3.75, STL);
    ibox(g, 5.6, 10.1, 1.62, 7.0, 11.5, 3.5, STL); ibox(g, 5.8, 10.3, 3.5, 6.8, 11.3, 3.75, STL);
    ibox(g, 7.2, 10.3, 1.62, 8.4, 11.3, 3.0, STL); ibox(g, 7.4, 10.45, 3.0, 8.2, 11.15, 3.25, STL);
    ibox(g, 7.55, 10.55, 3.25, 7.95, 10.95, 3.5, ORG);
    path(g, pd([P(7.0, 10.8, 3.4), P(7.1, 10.8, 3.9), P(7.4, 10.8, 3.9)]), '#6F7C88', 2, null);
    ibox(g, 4.1, 10.2, 2.9, 5.3, 10.3, 3.0, ORG);
    /* spinning blade discs (nested iso transforms on the +y faces) */
    R.discs = [];
    [[4.7, 2.65, 0.55, 11.5], [6.3, 2.65, 0.55, 11.5], [7.8, 2.35, 0.4, 11.3]].forEach(function (d) {
      var c = P(d[0], d[3], d[1]), s = d[2];
      var m = gr(g, { transform: 'matrix(' + f(S * s) + ' ' + f(S * s / 2) + ' 0 ' + f(-ZS * s) + ' ' + f(c[0]) + ' ' + f(c[1]) + ')' });
      var rg = gr(m, { transform: 'rotate(0)' }); rg._c = {};
      el('use', { href: '#bd' }, rg);
      R.discs.push(rg);
    });
    /* handrail */
    rail(g, P(2.2, 11.75, 1.62), P(8.8, 11.75, 1.62), 14, 8, '#7A8793');
    /* feed pump */
    ibox(g, 8.3, 9.2, 0, 8.8, 10.0, 0.7, STL); ibox(g, 8.45, 9.35, 0.7, 8.65, 9.85, 1.0, ORG);
    /* people in hall */
    use(g, 'p1', P(6.2, 12.3)[0], P(6.2, 12.3)[1], 1);
    use(g, 'p2', P(3.0, 12.2)[0], P(3.0, 12.2)[1], 1);
    /* inspection steps at hall front */
    for (k = 0; k < 4; k++) ibox(g, 8.0 - k * 0.0, 11.8 + k * 0.18, 0, 8.7, 11.98 + k * 0.18, 0.5 - k * 0.12, CON);
    R.c.discZ = 0;
  })();

  /* ===== cooling tower ===== */
  (function () {
    var g = gTower, cx = 18.4, cy = 3.6, zs = [0, 0.8, 4.4, 7.8, 10.2], rs = [2.9, 2.75, 2.25, 1.95, 2.15], N = 7;
    var tones = [CON[2], CON[2], CON[1], CON[1], CON[1], CON[0], CON[0]];
    function ring(z, r, a) { var c = P(cx, cy, z), rx = r * S * R2; return [c[0] + rx * Math.cos(a), c[1] + rx / 2 * Math.sin(a)]; }
    for (var b = 0; b < 4; b++) {
      for (var k = 0; k < N; k++) {
        var a0 = Math.PI * k / N, a1 = Math.PI * (k + 1) / N;
        var col = b === 0 ? mix(tones[k], '#6E665C', 0.35) : tones[k];
        if (b > 0 && (k + b) % 2) col = mix(col, '#FFFFFF', 0.06);
        poly(g, [ring(zs[b], rs[b], a0), ring(zs[b], rs[b], a1), ring(zs[b + 1], rs[b + 1], a1), ring(zs[b + 1], rs[b + 1], a0)], col);
      }
    }
    var top = P(cx, cy, zs[4]), trx = rs[4] * S * R2;
    ell(g, top, trx, trx / 2, '#F0ECE6');
    ell(g, [top[0], top[1] + 1], trx - 6, trx / 2 - 3, '#A39B91');
    ell(g, [top[0], top[1] + 4], trx - 10, trx / 2 - 5, '#8F877D');
    R.tTop = [top[0], top[1] - 2];
    /* plume puffs */
    R.puffs = [];
    for (k = 0; k < 10; k++) { var u = use(gTop, 'puff', 0, 0, 1); u._c = {}; u.__ph = k / 10; u.__dx = ((k * 7) % 5) - 2; R.puffs.push(u); }
    R.pg = gTop;
  })();

  /* ===== front scenery: annexes, tanks, substation, pylon, trees, vehicles ===== */
  (function () {
    var g = gFront, k;
    /* office */
    ibox(g, 12.2, 10.2, 0, 14.2, 12.0, 2.2, BLD);
    ibox(g, 12.05, 10.05, 2.2, 14.35, 12.15, 2.45, [BLD[0], BLD[1], BLD[2]]);
    windows(g, 'y', 12.0, [12.5, 13.1, 13.7], 0.9, 1.9, 0.4);
    windows(g, 'x', 14.2, [10.6, 11.2], 0.9, 1.9, 0.4);
    ibox(g, 12.35, 12.0, 0, 12.8, 12.12, 1.4, BLD);
    for (k = 0; k < 4; k++) ibox(g, 13.4, 12.0 + k * 0.14, 0, 13.9, 12.14 + k * 0.14, 0.5 - k * 0.12, CON);
    /* chemical tanks */
    cyl(g, 15.2, 9.0, 0, 0.85, 1.7, BLD); cyl(g, 16.5, 10.4, 0, 0.62, 1.3, BLD);
    ibox(g, 15.0, 10.5, 0, 15.9, 11.0, 0.35, STL);
    /* transformer + fence */
    ibox(g, 2.5, 13.0, 0, 3.7, 13.9, 1.1, ORG);
    ibox(g, 2.6, 13.15, 1.1, 3.6, 13.75, 1.3, STL);
    for (k = 0; k < 3; k++) { var b = P(2.8 + k * 0.4, 13.45, 1.3); rect(g, b[0] - 1.3, b[1] - 12, 2.6, 12, '#E6E1DA', 1); }
    for (k = 0; k < 3; k++) ibox(g, 3.7, 13.1 + k * 0.28, 0.1, 3.95, 13.28 + k * 0.28, 1.0, STL);
    rail(g, P(2.2, 12.9, 0), P(2.2, 14.1, 0), 4, 7, '#7A8793');
    rail(g, P(2.2, 14.1, 0), P(4.2, 14.1, 0), 6, 7, '#7A8793');
    /* pylon */
    var px = 1.2, py = 13.6, B0 = P(px, py, 0), th = 7 * ZS, bw = 13, tw = 3.2;
    var legs = 'M' + f(B0[0] - bw) + ',' + f(B0[1] + 3) + 'L' + f(B0[0] - tw) + ',' + f(B0[1] - th) + 'M' + f(B0[0] + bw) + ',' + f(B0[1] + 3) + 'L' + f(B0[0] + tw) + ',' + f(B0[1] - th);
    path(g, legs, '#7E8B98', 2.6, null);
    path(g, 'M' + f(B0[0] - bw) + ',' + f(B0[1] + 3) + 'L' + f(B0[0] - tw) + ',' + f(B0[1] - th), '#B8C3CD', 1.2, { transform: 'translate(-0.8 0)' });
    var br = '';
    for (k = 0; k < 7; k++) {
      var t0 = k / 7, t1 = (k + 1) / 7, w0 = bw + (tw - bw) * t0, w1 = bw + (tw - bw) * t1, y0 = B0[1] + 3 - (th + 3) * t0, y1 = B0[1] + 3 - (th + 3) * t1;
      br += 'M' + f(B0[0] - w0) + ',' + f(y0) + 'L' + f(B0[0] + w1) + ',' + f(y1) + 'M' + f(B0[0] + w0) + ',' + f(y0) + 'L' + f(B0[0] - w1) + ',' + f(y1);
    }
    path(g, br, '#8F9CA8', 1, null);
    var ax = [[th * 0.58, 20], [th * 0.9, 15]], arms = '', ins = '';
    ax.forEach(function (a) {
      arms += 'M' + f(B0[0] - a[1]) + ',' + f(B0[1] - a[0]) + 'L' + f(B0[0] + a[1]) + ',' + f(B0[1] - a[0]);
      ins += 'M' + f(B0[0] - a[1]) + ',' + f(B0[1] - a[0]) + 'v5M' + f(B0[0] + a[1]) + ',' + f(B0[1] - a[0]) + 'v5';
    });
    path(g, arms, '#E8782F', 3, null); path(g, ins, '#E6E1DA', 3, { 'stroke-linecap': 'butt' });
    R.pyl = { x: B0[0], y: B0[1], th: th, a1: [B0[0] - 20, B0[1] - th * 0.58 + 5], a2: [B0[0] - 15, B0[1] - th * 0.9 + 5] };
    /* trees front */
    [[0.6, 15.4, 'tr1', 1.1], [3.0, 15.5, 'pine', 1], [5.6, 15.5, 'tr2', 1.15], [8.5, 15.5, 'tr1', 1], [10.4, 15.4, 'pine', 1.1], [16.8, 15.5, 'tr1', 1.2],
     [19.2, 15.4, 'pine', 1], [21.2, 14.0, 'tr2', 1.1], [20.2, 11.6, 'pine', 1.1], [19.4, 9.2, 'tr1', 1], [11.0, 13.6, 'tr2', 1.0], [16.0, 13.6, 'tr1', 0.9], [10.2, 8.8, 'pine', 0.9],
     [12.4, 8.9, 'tr1', 0.9]].forEach(function (t) { var c = P(t[0], t[1]); use(g, t[2], c[0], c[1], t[3]); });
    /* parked cars + people */
    [[11.0, 14.1, WHT], [11.8, 14.1, ORG], [17.2, 14.1, TEA]].forEach(function (c) { ibox(g, c[0], c[1], 0.05, c[0] + 0.8, c[1] + 0.4, 0.35, c[2]); ibox(g, c[0] + 0.15, c[1] + 0.03, 0.35, c[0] + 0.55, c[1] + 0.37, 0.55, WHT); });
    [['p3', 12.8, 12.9], ['p1', 10.0, 11.6], ['p2', 8.0, 7.6], ['p3', 9.9, 7.9]].forEach(function (p) { var c = P(p[1], p[2]); use(g, p[0], c[0], c[1], 1); });
    /* tanker truck (moves along road) */
    var tg = gr(g); R.truck = tg; tg._c = {};
    ibox(tg, 0, 15.0, 0.15, 1.6, 15.7, 0.85, WHT);
    ibox(tg, 1.65, 15.05, 0.15, 2.25, 15.65, 0.7, ORG);
    ibox(tg, 1.9, 15.1, 0.7, 2.2, 15.6, 0.95, STL);
    ibox(tg, 0.1, 15.1, 0.85, 1.5, 15.6, 1.0, WHT);
    for (k = 0; k < 3; k++) { var wc = P([0.35, 1.0, 1.9][k], 15.72, 0.15); el('circle', { cx: f(wc[0]), cy: f(wc[1]), r: 2.4, fill: '#3E4A5E' }, tg); }
    R.truckX = 0;
  })();

  /* ===== pipes ===== */
  R.pipes = [];
  function pipe(def, d, col, key, w, dash) {
    var base = path(gPipes, d, def.base || mix(col, '#000000', 0.38), w + 1.8, null);
    var ov = path(gPipes, d, col, w, { 'stroke-dasharray': dash || '4 10', 'stroke-dashoffset': 0 });
    ov._c = {}; ov.__off = 0; ov.__key = key; ov.__per = (dash ? 14 : 14);
    R.pipes.push(ov);
    return ov;
  }
  (function () {
    var V = R.V, sg = R.sg, k = 0;
    var vl = V[0] - 1.0 * S * R2 - 9;
    pipe({}, 'M' + f(vl) + ',' + f(R.hotY) + 'H' + f(vl - 20) + 'L' + f(vl - 32) + ',' + f(sg.y - 1.9 * ZS) + 'H' + f(sg.x + sg.rx - 1), '#D9502E', 'flowPrimary', 3.2);
    var pump = R.pump, py = pump.y - 0.4 * ZS;
    pipe({}, 'M' + f(sg.x + sg.rx - 1) + ',' + f(sg.y - 0.5 * ZS) + 'H' + f(sg.x + sg.rx + 8) + 'L' + f(pump.x - pump.rx + 2) + ',' + f(py), '#F0A25A', 'flowPrimary', 3.2);
    pipe({}, 'M' + f(pump.x + pump.rx - 2) + ',' + f(py) + 'H' + f(vl) + 'V' + f(R.coldY), '#F0A25A', 'flowPrimary', 3.2);
    /* steam out of SG to HP turbine, feedwater back */
    var HPt = P(7.8, 10.8, 3.55), FP = P(8.55, 9.6, 1.0);
    var st = R.sgTop;
    pipe({ base: '#7C8791' }, 'M' + f(st[0]) + ',' + f(st[1] + 3) + 'V' + f(st[1] - 12) + 'H' + f(st[0] - 26) + 'L' + f(st[0] - 60) + ',' + f(st[1] + 22) + 'V' + f(st[1] + 46) + 'L' + f(HPt[0]) + ',' + f(HPt[1] - 18) + 'V' + f(HPt[1]), '#B9C2CA', 'flowSteam', 4);
    pipe({}, 'M' + f(FP[0]) + ',' + f(FP[1]) + 'V' + f(R.sgTop[1] + 54) + 'L' + f(st[0] - 40) + ',' + f(st[1] + 36) + 'H' + f(sg.x - sg.rx + 1), '#3B7BC0', 'flowSteam', 4);
    /* cooling water: condenser -> tower */
    var cw = wp([[7.4, 10.85, 0.5], [9.5, 10.85, 0.15], [9.5, 12.6, 0.15], [18.4, 12.6, 0.15], [18.4, 6.5, 0.15]]);
    pipe({}, pd(cw), '#39A0A8', 'flowCooling', 3.6);
    /* power line: generator -> transformer -> pylon -> grid */
    var g1 = wp([[3.0, 11.3, 1.62], [3.0, 12.3, 0.1], [3.1, 13.3, 0.1], [3.1, 13.45, 1.3]]);
    pipe({ base: '#B98A00' }, pd(g1), '#F2B705', 'power', 1.6);
    var pl = R.pyl, tr = P(3.1, 13.45, 1.3);
    var pd2 = 'M' + f(tr[0]) + ',' + f(tr[1]) + 'L' + f(pl.a2[0] + 14) + ',' + f(pl.a2[1] - 4) + 'L' + f(pl.a2[0]) + ',' + f(pl.a2[1]) + 'Q' + f(pl.a2[0] - 70) + ',' + f(pl.a2[1] + 22) + ' -8,' + f(pl.a2[1] - 40);
    pipe({ base: '#B98A00' }, pd2, '#F2B705', 'power', 1.6);
    path(gPipes, 'M' + f(pl.a1[0] + 40) + ',' + f(pl.a1[1] - 2) + 'L' + f(pl.a1[0]) + ',' + f(pl.a1[1]) + 'Q' + f(pl.a1[0] - 70) + ',' + f(pl.a1[1] + 26) + ' -8,' + f(pl.a1[1] - 26), '#7E8B98', 1.1, null);
  })();

  /* ===== labels (tags) ===== */
  var labelDefs = [
    { id: 'reactor', t: 'LÒ PHẢN ỨNG', tx: 330, ty: 50, target: [R.V[0] - 30, R.c.top + 40] },
    { id: 'sg', t: 'BÌNH SINH HƠI', tx: 190, ty: 112, target: [R.sg.x - 6, R.sg.y - R.sg.hp + 30] },
    { id: 'generator', t: 'MÁY PHÁT', tx: 90, ty: 192, target: P(3.0, 10.8, 3.4) },
    { id: 'turbine', t: 'TUABIN', tx: 300, ty: 548, target: P(6.3, 11.8, 1.8) },
    { id: 'tower', t: 'THÁP LÀM MÁT', tx: 672, ty: 520, target: P(18.9, 6.2, 0.8) },
    { id: 'grid', t: 'LƯỚI ĐIỆN', tx: 92, ty: 440, target: [R.pyl.x, R.pyl.y - 30] }
  ];
  R.labels = [];
  labelDefs.forEach(function (L) {
    var w = Math.round(L.t.length * 0.66 * 15 + 16), h = 25;
    path(gLab, pd([L.target, [L.tx, L.ty]]), NAVY, 1.2, null);
    el('circle', { cx: f(L.target[0]), cy: f(L.target[1]), r: 2.8, fill: NAVY }, gLab);
    var g = gr(gLab, { 'data-part': L.id, transform: 'translate(' + L.tx + ' ' + L.ty + ')', style: 'cursor:pointer' });
    var r = rect(g, -w / 2, -h / 2, w, h, NAVY, 3);
    var t = el('text', { x: 0, y: 5.2, 'text-anchor': 'middle', fill: '#FFFFFF', 'font-size': 15, 'font-weight': 700,
      'font-family': FONT, 'letter-spacing': 0.3 }, g);
    t.textContent = L.t;
    var o = { g: g, rect: r, def: L, w: w };
    R.labels.push(o);
    if (L.id === 'reactor') R.labelReactor = o;
  });
  /* SCRAM tag */
  R.scram = gr(gLab, { transform: 'translate(395 138)', visibility: 'hidden' });
  rect(R.scram, -34, -13, 68, 26, RED, 4);
  var st2 = el('text', { x: 0, y: 5.5, 'text-anchor': 'middle', fill: '#fff', 'font-size': 15, 'font-weight': 800, 'font-family': FONT, 'letter-spacing': 1 }, R.scram);
  st2.textContent = 'SCRAM';
  R.scramK = 1;

  /* ===== rod drag handle ===== */
  var hx = R.V[0], TOP = 72, TR = 56;
  var hg = gr(gTop);
  path(hg, pd([[hx, TOP], [hx, TOP + TR]]), '#B3ABA1', 7, null);
  path(hg, pd([[hx, TOP], [hx, TOP + TR]]), '#E6E1DA', 3, null);
  poly(hg, [[hx - 6, TOP - 6], [hx + 6, TOP - 6], [hx, TOP - 14]], '#818E9B');
  poly(hg, [[hx - 6, TOP + TR + 6], [hx + 6, TOP + TR + 6], [hx, TOP + TR + 14]], '#818E9B');
  R.knob = gr(hg, { transform: 'translate(' + hx + ' ' + (TOP + TR) + ')' }); R.knob._c = {};
  rect(R.knob, -24, -11, 48, 22, '#B85A22', 6); rect(R.knob, -24, -12.5, 48, 22, '#E8782F', 6);
  [-5, 0, 5].forEach(function (dy) { rect(R.knob, -12, dy - 1.5 - 1, 24, 2.2, '#FFE2C8', 1); });
  /* ===== hit areas ===== */
  function hit(id, cx, cy, w, h) {
    w = Math.max(w, 104); h = Math.max(h, 104);
    var r = el('rect', { x: f(cx - w / 2), y: f(cy - h / 2), width: w, height: h, fill: '#fff', 'fill-opacity': 0, 'data-part': id, style: 'cursor:pointer' }, gHit);
    return r;
  }
  hit('reactor', R.V[0] - 30, 265, 160, 220);
  hit('sg', R.sg.x, R.sg.y - 60, 104, 140);
  hit('turbine', 320, 345, 130, 120);
  hit('generator', 232, 335, 104, 110);
  hit('tower', 631, 300, 160, 240);
  hit('grid', R.pyl.x, R.pyl.y - 70, 104, 170);
  var hh = el('rect', { x: f(hx - 52), y: f(TOP + TR / 2 - 52), width: 104, height: 104, fill: '#fff', 'fill-opacity': 0, style: 'cursor:ns-resize;touch-action:none' }, gHit);
  hh.setAttribute('touch-action', 'none');
  R.knobTop = TOP; R.knobTR = TR;

  /* ---------- interaction ---------- */
  svg.addEventListener('click', function (e) {
    var n = e.target;
    while (n && n !== svg) {
      var id = n.getAttribute && n.getAttribute('data-part');
      if (id) { if (cb.onPartTap) cb.onPartTap(id); return; }
      n = n.parentNode;
    }
  });
  var drag = null, dragW = null, curW = 0;
  hh.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
  hh.addEventListener('pointerdown', function (e) {
    var rc = svg.getBoundingClientRect();
    drag = { y: e.clientY, w: dragW !== null ? dragW : curW, u: 800 / Math.max(1, rc.width), last: -1 };
    try { hh.setPointerCapture(e.pointerId); } catch (x) {}
    e.preventDefault();
  });
  hh.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var w = drag.w - (e.clientY - drag.y) * drag.u / TR * 100;
    w = Math.max(0, Math.min(100, w)); dragW = w;
    setKnob(w);
    var r = Math.round(w);
    if (r !== drag.last) { drag.last = r; if (cb.onRodDrag) cb.onRodDrag(r); }
    e.preventDefault();
  });
  function endDrag(e) { if (!drag) return; drag = null; try { hh.releasePointerCapture(e.pointerId); } catch (x) {} setTimeout(function () { if (!drag) dragW = null; }, 400); }
  hh.addEventListener('pointerup', endDrag); hh.addEventListener('pointercancel', endDrag);
  function setKnob(w) {
    var y = TOP + (1 - w / 100) * TR;
    if (R.knob._c.y !== undefined && Math.abs(R.knob._c.y - y) < 0.25) return;
    R.knob._c.y = y; R.knob.setAttribute('transform', 'translate(' + hx + ' ' + f(y) + ')');
  }

  /* label readability: grow tags on small screens (resize only, never in update) */
  function relabel() {
    var w = container.clientWidth || 360, ppu = w / 800, k = Math.max(1, Math.min(2, 11.5 / (15 * ppu)));
    k = Math.round(k * 20) / 20; R.k = k;
    R.labels.forEach(function (o) { o.g.setAttribute('transform', 'translate(' + o.def.tx + ' ' + o.def.ty + ') scale(' + k + ')'); });
    R.scram.setAttribute('transform', 'translate(395 138) scale(' + Math.min(k, 1.5) + ')');
  }
  container.appendChild(svg);
  relabel();
  if (global.ResizeObserver) new ResizeObserver(relabel).observe(container); else global.addEventListener('resize', relabel);

  /* ---------- update ---------- */
  var reduced = false, T = 0, blinkT = 0, rotor = 0, plumeT = 0, bubT = 0, sgT = 0, truckX = 0, lastStatus = '', lastBlink = true;
  function wr(e, k, v) { if (e._c[k] === v) return; e._c[k] = v; e.setAttribute(k, v); }
  function wn(e, k, v, eps, str) { var o = e._c[k]; if (o !== undefined && Math.abs(o - v) < eps) return; e._c[k] = v; e.setAttribute('transform', str); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  var th = [280, 320, 350];

  function update(s, dtReal) {
    s = s || {};
    var dtR = clamp(dtReal || 0.016, 0, 0.1), mk = reduced ? 0.3 : 1, dt = dtR * mk, i, e;
    curW = s.w || 0;
    if (dragW === null) setKnob(clamp(s.w || 0, 0, 100));
    /* core colour (4 flat steps) */
    var tc = s.tCore || 0, ci = tc < th[0] ? 0 : tc < th[1] ? 1 : tc < th[2] ? 2 : 3;
    wr(R.core, 'fill', CORE_COL[ci]);
    /* control rods: rodPos = % withdrawn (100 = fully out) */
    var wd = clamp((s.rodPos === undefined ? s.w : s.rodPos) / 100, 0, 1), tip = R.coreTop + R.coreH - 2 - wd * (R.coreH - 4);
    var sy = (tip - R.rodTop) / R.rods[0].__len;
    for (i = 0; i < R.rods.length; i++) {
      e = R.rods[i];
      wn(e, 'sy', sy, 0.004, 'translate(' + f(e.__x) + ' ' + f(R.rodTop) + ') scale(1 ' + (Math.round(sy * R.rods[0].__len * 10) / 10) + ')');
    }
    /* steam generator: water level + bubbles */
    var pf = clamp((s.pTh || 0) / 3000, 0, 1.2);
    sgT += dt; bubT += dt * (0.25 + pf * 1.3);
    var lvl = 0.62 + 0.012 * Math.sin(sgT * 1.3), wh = R.sgH * lvl;
    wn(R.water, 'h', wh, 0.12, 'translate(' + f(R.water.__x) + ' ' + f(R.sgBot) + ') scale(' + R.water.__w + ' ' + f(wh) + ')');
    var act = (s.pTh || 0) < 20 ? 0 : Math.ceil(16 * clamp(pf, 0.12, 1));
    for (i = 0; i < 16; i++) {
      e = R.bubbles[i];
      if (i >= act) { wr(e, 'opacity', 0); continue; }
      var ph = (bubT + e.__ph) % 1, by = R.sgBot - 3 - ph * (wh - 5);
      wn(e, 'y', by + e.__x * 0.0001, 0.05, 'translate(' + f(e.__x + Math.sin((ph + e.__ph) * 12) * 1.2) + ' ' + f(by) + ')');
      wr(e, 'opacity', ph > 0.85 ? Math.round((1 - ph) * 53) / 10 : 0.9);
    }
    /* turbine rotor discs: capped visual spin */
    var rr = clamp((s.rpm || 0) / 1800, 0, 1);
    rotor = (rotor + rr * 150 * dt) % 360;
    for (i = 0; i < R.discs.length; i++) wn(R.discs[i], 'a', rotor, 0.4, 'rotate(' + f(rotor) + ')');
    /* pipes */
    var fl = { flowPrimary: s.flowPrimary || 0, flowSteam: s.flowSteam || 0, flowCooling: s.flowCooling || 0, power: clamp((s.pElec || 0) / 1000, 0, 1.2) };
    for (i = 0; i < R.pipes.length; i++) {
      e = R.pipes[i]; var v = fl[e.__key];
      if (v < 0.02) continue;
      e.__off = (e.__off - dt * (6 + v * 56)) % 14;
      if (e._c.o === undefined || Math.abs(e._c.o - e.__off) >= 0.3) { e._c.o = e.__off; e.setAttribute('stroke-dashoffset', f(e.__off)); }
    }
    /* cooling-tower plume (pooled, size follows pElec) */
    var pe = clamp((s.pElec || 0) / 1000, 0, 1.1), cnt = pe < 0.02 ? 2 : Math.round(4 + 6 * Math.min(pe, 1));
    plumeT += dt * (0.1 + 0.12 * pe);
    var tt = R.tTop, size = 0.45 + 0.75 * Math.min(pe, 1);
    for (i = 0; i < 10; i++) {
      e = R.puffs[i];
      if (i >= cnt) { wr(e, 'opacity', 0); continue; }
      var q = (plumeT + e.__ph) % 1, sc = (0.7 + q * 1.5) * size * 1.15, px = tt[0] + e.__dx * 4 + q * 38 + Math.sin(q * 5 + i) * 3, py = tt[1] - 6 - q * 105 * (0.6 + 0.4 * size);
      e.setAttribute('transform', 'translate(' + f(px) + ' ' + f(py) + ') scale(' + f(sc) + ')');
      e.setAttribute('opacity', f(Math.min(1, q * 5) * (1 - q * q) * 0.98 * (pe < 0.02 ? 0.5 : 1)));
    }
    /* truck */
    truckX += dt * 0.7; if (truckX > 19) truckX = -2.5;
    wn(R.truck, 'x', truckX, 0.06, 'translate(' + f(truckX * S) + ' ' + f(truckX * S / 2) + ')');
    /* status */
    blinkT += dtR;
    var st = s.status || 'safe', on = reduced || Math.floor(blinkT * 2) % 2 === 0;
    var sc2 = st === 'danger' ? RED : st === 'warn' ? AMBER : null;
    if (st !== lastStatus) {
      lastStatus = st;
      R.outline.setAttribute('stroke', sc2 || '#B3ABA1'); R.outline.setAttribute('stroke-width', sc2 ? 4 : 3);
      R.labelReactor.rect.setAttribute('fill', sc2 || NAVY);
    }
    var bl = st === 'danger' ? on : true;
    if (bl !== lastBlink) {
      lastBlink = bl;
      R.outline.setAttribute('opacity', bl ? 1 : 0.2); R.labelReactor.g.setAttribute('opacity', bl ? 1 : 0.35);
    }
    var sv = s.scrammed ? 'visible' : 'hidden';
    if (R.scram._v !== sv) { R.scram._v = sv; R.scram.setAttribute('visibility', sv); }
  }

  var api = {
    svg: svg,
    update: update,
    setReducedMotion: function (b) { reduced = !!b; lastBlink = null; },
    nodeCount: function () { return svg.getElementsByTagName('*').length + 1; }
  };
  return api;
}

global.Scene = { mount: mount };
})(window);
