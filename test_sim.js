/* test_sim.js - run with: node test_sim.js */
'use strict';
var SimCore = require('./sim-core.js');
var C = SimCore.CONFIG;
var DT = C.dt;
var passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + ' -> ' + e.message); }
}
function assert(cond, msg) { if (!cond) { throw new Error(msg); } }
function near(a, b, tol, label) {
  assert(Math.abs(a - b) <= tol, label + ': got ' + a.toFixed(3) + ', expected ' + b + ' +/-' + tol);
}
function noScram(fn) {
  var saved = C.scramDelay; C.scramDelay = 1e9;
  try { fn(); } finally { C.scramDelay = saved; }
}
function run(s, seconds) {
  var n = Math.round(seconds / DT), i;
  for (i = 0; i < n; i++) { SimCore.step(s, DT); }
}
function settle(w, seconds) {
  var s = SimCore.createState();
  SimCore.setRods(s, w);
  run(s, seconds || 900);
  return s;
}
var FIELDS = ['rodPos', 'pTh', 'tCore', 'tSec', 'pSteam', 'rpm', 'pElec', 'flowPrimary', 'flowSteam', 'flowCooling'];
var RANGE = { rodPos: 100, pTh: 3600, tCore: 320, tSec: 320, pSteam: 145, rpm: 3600, pElec: 1250,
  flowPrimary: 1, flowSteam: 1, flowCooling: 1 };

test('calibration: default state (w=60) stays at rated values and is safe', function () {
  var s = SimCore.createState();
  run(s, 300);
  near(s.tCore, 315, 1, 'tCore'); near(s.pSteam, 69.2, 1.5, 'pSteam');
  near(s.rpm, 3000, 30, 'rpm'); near(s.pElec, 1000, 10, 'pElec'); near(s.pTh, 3000, 30, 'pTh');
  assert(s.status === 'safe', 'status ' + s.status);
  var t = settle(60);
  near(t.tCore, 315, 1, 'settled tCore'); near(t.pElec, 1000, 10, 'settled pElec');
});

test('calibration: w=0 gives 0 MW and 0 rpm within 120 s, tCore -> 40', function () {
  var s = SimCore.createState();
  SimCore.setRods(s, 0);
  run(s, 120);
  assert(s.pElec === 0, 'pElec ' + s.pElec);
  assert(s.rpm < 1, 'rpm ' + s.rpm);
  assert(s.pTh < 1, 'pTh ' + s.pTh);
  run(s, 780);
  near(s.tCore, 40, 0.5, 'tCore at w=0');
});

test('calibration: w=100 gives tCore ~ 360', function () {
  noScram(function () { near(settle(100).tCore, 360, 1.5, 'tCore at w=100'); });
});

test('steady states rise monotonically with w (0,25,50,60,75,100)', function () {
  noScram(function () {
    var ws = [0, 25, 50, 60, 75, 100], prev = null, log = [];
    ws.forEach(function (w) {
      var s = settle(w);
      log.push('w=' + w + ' T=' + s.tCore.toFixed(1) + ' p=' + s.pSteam.toFixed(1) +
        ' rpm=' + s.rpm.toFixed(0) + ' MW=' + s.pElec.toFixed(0));
      if (prev) {
        assert(s.pTh > prev.pTh, 'pTh not rising at w=' + w);
        assert(s.tCore > prev.tCore, 'tCore not rising at w=' + w);
        assert(s.tSec > prev.tSec, 'tSec not rising at w=' + w);
        assert(s.pSteam > prev.pSteam, 'pSteam not rising at w=' + w);
        ['rpm', 'pElec'].forEach(function (f) {
          assert(s[f] >= prev[f] - 1e-6, f + ' fell at w=' + w);
          if (s[f] > 0) { assert(s[f] > prev[f], f + ' not rising at w=' + w); }
        });
      }
      prev = s;
    });
    console.log('      ' + log.join('\n      '));
  });
});

test('overshoot < 5 % on upward steps', function () {
  noScram(function () {
    var cases = [[0, 60], [0, 100], [0, 50], [25, 60], [60, 75], [60, 100]], worst = 0;
    cases.forEach(function (cs) {
      var s = settle(cs[0], 600), init = {}, peak = {}, f;
      ['pTh', 'tCore', 'pSteam', 'rpm', 'pElec'].forEach(function (k) { init[k] = s[k]; peak[k] = s[k]; });
      SimCore.setRods(s, cs[1]);
      var i, n = Math.round(900 / DT);
      for (i = 0; i < n; i++) {
        SimCore.step(s, DT);
        for (f in peak) { if (s[f] > peak[f]) { peak[f] = s[f]; } }
      }
      for (f in peak) {
        var change = s[f] - init[f];
        if (change > 1e-6) {
          var ov = (peak[f] - s[f]) / change;
          if (ov > worst) { worst = ov; }
          assert(ov < 0.05, f + ' overshoot ' + (ov * 100).toFixed(2) + '% for ' + cs[0] + '->' + cs[1]);
        }
      }
    });
    console.log('      worst overshoot ' + (worst * 100).toFixed(2) + ' %');
  });
});

test('smoothness: no field jumps > 2 % of its range in one step', function () {
  noScram(function () {
    var cases = [[0, 60], [0, 100], [60, 100], [100, 0], [60, 0]], worst = 0;
    cases.forEach(function (cs) {
      var s = settle(cs[0], 600), prev = {}, i, n = Math.round(300 / DT);
      SimCore.setRods(s, cs[1]);
      FIELDS.forEach(function (f) { prev[f] = s[f]; });
      for (i = 0; i < n; i++) {
        SimCore.step(s, DT);
        FIELDS.forEach(function (f) {
          var r = Math.abs(s[f] - prev[f]) / RANGE[f];
          if (r > worst) { worst = r; }
          assert(r <= 0.02, f + ' jumped ' + (r * 100).toFixed(2) + '% in one step (' + cs[0] + '->' + cs[1] + ')');
          prev[f] = s[f];
        });
      }
    });
    console.log('      worst single-step jump ' + (worst * 100).toFixed(2) + ' % of range');
  });
});

test('lag: after w 0->60, tCore reaches half its change before rpm', function () {
  var s = settle(0, 600);
  var tStart = s.simTime, t0 = s.tCore, r0 = s.rpm, tHalfT = null, tHalfR = null, i, n = Math.round(900 / DT);
  SimCore.setRods(s, 60);
  for (i = 0; i < n; i++) {
    SimCore.step(s, DT);
    if (tHalfT === null && s.tCore >= t0 + 0.5 * (315 - t0)) { tHalfT = s.simTime - tStart; }
    if (tHalfR === null && s.rpm >= r0 + 0.5 * (3000 - r0)) { tHalfR = s.simTime - tStart; }
  }
  assert(tHalfT !== null && tHalfR !== null, 'half points not reached');
  console.log('      tCore half at ' + tHalfT.toFixed(1) + ' s, rpm half at ' + tHalfR.toFixed(1) + ' s (after the step)');
  assert(tHalfT < tHalfR, 'tCore half ' + tHalfT + ' not before rpm half ' + tHalfR);
});

test('sequence: danger -> auto-scram -> canRecover -> recover -> safe', function () {
  var s = SimCore.createState(), tDanger = null, tScram = null, i;
  SimCore.setRods(s, 100);
  for (i = 0; i < 6000 && tScram === null; i++) {
    SimCore.step(s, DT);
    if (tDanger === null && s.status === 'danger') { tDanger = s.simTime; }
    if (s.scrammed) { tScram = s.simTime; }
  }
  assert(tDanger !== null, 'never reached danger');
  assert(tScram !== null, 'never scrammed');
  assert(tScram - tDanger >= 4.9 && tScram - tDanger <= 5.2, 'scram delay ' + (tScram - tDanger).toFixed(2));
  assert(s.canRecover === false, 'canRecover true while still hot');
  SimCore.recover(s);
  assert(s.scrammed, 'recover() worked while too hot');
  var j, got = null;
  for (j = 0; j < 4000 && got === null; j++) {
    SimCore.step(s, DT);
    if (s.canRecover) { got = s.simTime; }
  }
  assert(got !== null, 'canRecover never became true');
  assert(s.tCore < 330, 'canRecover with tCore ' + s.tCore);
  SimCore.recover(s);
  assert(!s.scrammed && s.w === 0 && !s.canRecover, 'recover did not clear scram / set w=0');
  run(s, 300);
  assert(s.status === 'safe', 'status ' + s.status);
  SimCore.setRods(s, 60);
  assert(s.w === 60, 'setRods not accepted after recovery');
  console.log('      danger at ' + tDanger.toFixed(1) + ' s, scram at ' + tScram.toFixed(1) +
    ' s, canRecover at ' + got.toFixed(1) + ' s');
});

test('hysteresis: 3 degC on every boundary', function () {
  var cl = SimCore._classify;
  assert(cl('safe', 329.9) === 'safe' && cl('safe', 330) === 'warn', 'safe->warn');
  assert(cl('warn', 327.5) === 'warn' && cl('warn', 326.9) === 'safe', 'warn->safe');
  assert(cl('warn', 349.9) === 'warn' && cl('warn', 350) === 'danger', 'warn->danger');
  assert(cl('danger', 347.5) === 'danger' && cl('danger', 346.9) === 'warn', 'danger->warn');
  assert(cl('danger', 320) === 'safe', 'danger->safe');
  assert(cl('safe', 355) === 'danger', 'safe->danger');
});

test('setRods ignored while scrammed', function () {
  var s = SimCore.createState();
  SimCore.scram(s);
  SimCore.setRods(s, 80);
  assert(s.w === 0, 'w changed to ' + s.w);
  run(s, 5);
  assert(s.rodPos === 0, 'rodPos ' + s.rodPos);
  SimCore.setRods(s, NaN);
  assert(s.w === 0, 'NaN accepted');
});

test('no NaN over 1 simulated hour of random w changes', function () {
  var seed = 12345;
  function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  var s = SimCore.createState(), n = Math.round(3600 / DT), i, next = 0, scrams = 0, wasScram = false;
  for (i = 0; i < n; i++) {
    if (i >= next) {
      var r = rnd();
      if (r < 0.03) { SimCore.scram(s); } else { SimCore.setRods(s, Math.round(rnd() * 100)); }
      if (s.canRecover && rnd() < 0.7) { SimCore.recover(s); }
      next = i + Math.round((5 + rnd() * 60) / DT);
    }
    if (s.scrammed && s.canRecover && rnd() < 0.002) { SimCore.recover(s); }
    SimCore.step(s, DT);
    if (s.scrammed && !wasScram) { scrams++; }
    wasScram = s.scrammed;
    FIELDS.forEach(function (f) {
      assert(isFinite(s[f]), f + ' not finite at step ' + i);
    });
    assert(s.tCore >= 39.9 && s.tCore < 400, 'tCore out of range ' + s.tCore);
    assert(s.rpm >= 0 && s.rpm < 6000, 'rpm out of range ' + s.rpm);
    assert(s.pElec >= 0 && s.pElec < 2000, 'pElec out of range ' + s.pElec);
    assert(s.flowPrimary >= 0 && s.flowPrimary <= 1.0001, 'flowPrimary ' + s.flowPrimary);
  }
  console.log('      ' + n + ' steps, ' + scrams + ' scrams, all finite');
});

test('reset returns to createState()', function () {
  var s = SimCore.createState();
  SimCore.setRods(s, 100); run(s, 60); SimCore.scram(s); run(s, 10);
  SimCore.reset(s);
  var fresh = SimCore.createState();
  assert(JSON.stringify(s) === JSON.stringify(fresh), 'state differs after reset');
  assert(s.w === 60 && !s.scrammed && s.status === 'safe', 'bad defaults');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
