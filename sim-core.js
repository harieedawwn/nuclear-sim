/* sim-core.js - physics core of the 2D PWR teaching simulator. No DOM. ES2017 or older.
 *
 * TIME SCALE: time runs much faster than in a real plant (real thermal time constants are
 * minutes to hours; here they are seconds) so students see the whole chain respond in class.
 *
 * Simplifications (honest ones): no xenon, no decay heat after SCRAM, one lumped core node,
 * linear heat removal, turbine governor modelled as a soft pressure limiter.
 */
(function () {
  'use strict';

  var CONFIG = {
    dt: 0.05,               // s, fixed simulated step
    // plant ratings
    pRated: 3000,           // MWt
    pElecRated: 1000,       // MWe
    rpmRated: 3000,
    tRated: 315,            // degC core temperature at rated power (w = ratedW)
    tMax: 360,              // degC core temperature with rods fully out (w = 100)
    tCold: 40,              // degC, core cools toward this when power is 0
    ratedW: 60,             // % rod withdrawal that gives rated power
    deltaTRated: 30,        // degC primary-to-secondary difference at rated power
    // rods
    rodSpeed: 20,           // %/s normal movement   (TEACHER: how fast rods move)
    scramSpeed: 100,        // %/s on SCRAM
    // time constants (s)
    tauPower: 2,
    tauCore: 6,             // (TEACHER: how sluggish the heat-up is)
    tauPressure: 3,
    tauTurbine: 8,
    tauFlow: 3,
    feedbackAlpha: 0.03,    // fractional power loss per 100 degC above tRated (mild negative feedback)
    // turbine
    pMinDrive: 5,           // bar, below this the steam cannot drive the turbine
    govSlope: 0.25,         // above rated steam pressure the governor passes only this fraction
    frictionFrac: 0.2,      // share of the rotor loss that is friction
    loadFrac: 0.8,          // share that is the generator load
    rpmMinElec: 300,        // below this rpm pElec = 0
    // flows
    minPrimaryFlow: 0.15,
    pumpTempOn: 60,         // degC; primary pump keeps the minimum flow while tCore is above this
    // safety
    warnT: 330,
    dangerT: 350,
    hysteresis: 3,
    scramDelay: 5,          // s in danger before automatic SCRAM   (TEACHER: how forgiving the plant is)
    recoverT: 330
  };

  // saturation table: degC -> bar
  var SAT = [[100, 1.0], [150, 4.8], [200, 15.5], [250, 39.8], [275, 59.5], [285, 69.2],
    [300, 85.9], [310, 98.7], [320, 112.9], [330, 128.6], [340, 146.0]];

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

  function satPressure(t) {
    var i;
    if (t <= SAT[0][0]) { return SAT[0][1]; }
    if (t >= SAT[SAT.length - 1][0]) { return SAT[SAT.length - 1][1]; }
    for (i = 1; i < SAT.length; i++) {
      if (t <= SAT[i][0]) {
        var a = SAT[i - 1], b = SAT[i];
        return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
      }
    }
    return SAT[SAT.length - 1][1];
  }

  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

  // Constants derived from the calibration targets (so tuning CONFIG keeps the plant calibrated).
  var D = (function () {
    var c = CONFIG;
    var kHeat = (c.tRated - c.tCold) / c.pRated;                       // degC per MWt
    var p100 = c.pRated * (c.tMax - c.tCold) / (c.tRated - c.tCold);   // MWt needed for tMax
    var pMax = p100 / (1 - c.feedbackAlpha * (c.tMax - c.tRated) / 100);
    var r = c.pRated / pMax;
    var s = smooth(c.ratedW / 100);
    var k = s * (1 - r) / (r - s);                                     // rod-worth saturation shape
    return { kHeat: kHeat, pMax: pMax, k: k,
      pSteamRated: satPressure(c.tRated - c.deltaTRated) };
  })();

  // S-curve rod worth: weak near both ends, mild saturation near the top. 0..1
  function rodWorth(pos) {
    var s = smooth(pos / 100);
    return s * (1 + D.k) / (s + D.k);
  }

  function governed(p) {
    return p <= D.pSteamRated ? p : D.pSteamRated + CONFIG.govSlope * (p - D.pSteamRated);
  }

  function elecFromRpm(rpm) {
    var c = CONFIG;
    if (rpm < c.rpmMinElec) { return 0; }
    return c.pElecRated * (rpm - c.rpmMinElec) / (c.rpmRated - c.rpmMinElec);
  }

  function classify(prev, t) {
    var c = CONFIG, h = c.hysteresis, s = prev;
    if (s === 'safe') {
      if (t >= c.dangerT) { s = 'danger'; } else if (t >= c.warnT) { s = 'warn'; }
    } else if (s === 'warn') {
      if (t >= c.dangerT) { s = 'danger'; } else if (t < c.warnT - h) { s = 'safe'; }
    } else if (t < c.dangerT - h) {
      s = t < c.warnT - h ? 'safe' : 'warn';
    }
    return s;
  }

  function createState() {
    var c = CONFIG;
    return {
      w: c.ratedW, rodPos: c.ratedW,
      pTh: c.pRated, tCore: c.tRated, tSec: c.tRated - c.deltaTRated,
      pSteam: D.pSteamRated, rpm: c.rpmRated, pElec: c.pElecRated,
      flowPrimary: 1, flowSteam: 1, flowCooling: 1,
      status: 'safe', scrammed: false, canRecover: false,
      simTime: 0, dangerTime: 0
    };
  }

  function step(state, dt) {
    var c = CONFIG;
    if (!(dt > 0)) { return; }

    // rods
    var rodTarget = state.scrammed ? 0 : state.w;
    var maxMove = (state.scrammed ? c.scramSpeed : c.rodSpeed) * dt;
    state.rodPos = clamp(state.rodPos + clamp(rodTarget - state.rodPos, -maxMove, maxMove), 0, 100);

    // thermal power: first-order lag toward rod-set target, with negative temperature feedback
    // feedback acts only above rated temperature (a cold core gives no power surge)
    var fb = Math.max(0, 1 - c.feedbackAlpha * Math.max(0, state.tCore - c.tRated) / 100);
    var pTarget = D.pMax * rodWorth(state.rodPos) * fb;
    state.pTh += (pTarget - state.pTh) * Math.min(1, dt / c.tauPower);

    // core temperature: heat balance
    state.tCore += (state.pTh * D.kHeat - (state.tCore - c.tCold)) * Math.min(1, dt / c.tauCore);

    // secondary side
    state.tSec = state.tCore - c.deltaTRated * state.pTh / c.pRated;
    state.pSteam += (satPressure(state.tSec) - state.pSteam) * Math.min(1, dt / c.tauPressure);

    // turbine (torque balance in rpm units: steam drive minus friction and load)
    var drive = c.rpmRated * Math.max(0, governed(state.pSteam) - c.pMinDrive) /
      (D.pSteamRated - c.pMinDrive);
    var loss = (c.frictionFrac + c.loadFrac) * state.rpm;
    state.rpm = Math.max(0, state.rpm + (drive - loss) * Math.min(1, dt / c.tauTurbine));
    state.pElec = elecFromRpm(state.rpm);

    // flows
    var kf = Math.min(1, dt / c.tauFlow);
    var tgtPrimary = Math.max(clamp(state.pTh / c.pRated, 0, 1),
      state.tCore > c.pumpTempOn ? c.minPrimaryFlow : 0);
    state.flowPrimary += (tgtPrimary - state.flowPrimary) * kf;
    state.flowSteam += (clamp(state.pSteam / D.pSteamRated, 0, 1) - state.flowSteam) * kf;
    state.flowCooling += (clamp(state.pElec / c.pElecRated, 0, 1) - state.flowCooling) * kf;

    // safety
    state.status = classify(state.status, state.tCore);
    if (state.status === 'danger') { state.dangerTime += dt; } else { state.dangerTime = 0; }
    if (!state.scrammed && state.dangerTime >= c.scramDelay) { scram(state); }
    state.canRecover = state.scrammed && state.tCore < c.recoverT;

    state.simTime += dt;
  }

  function setRods(state, w) {
    if (state.scrammed || typeof w !== 'number' || !isFinite(w)) { return; }
    state.w = clamp(w, 0, 100);
  }

  function scram(state) {
    state.scrammed = true;
    state.w = 0;
    state.dangerTime = 0;
    state.canRecover = state.tCore < CONFIG.recoverT;
  }

  // Ignored until canRecover is true (tCore < recoverT).
  function recover(state) {
    if (!state.scrammed || !state.canRecover) { return; }
    state.scrammed = false;
    state.canRecover = false;
    state.w = 0;
    state.dangerTime = 0;
  }

  function reset(state) {
    var fresh = createState(), k;
    for (k in fresh) { if (Object.prototype.hasOwnProperty.call(fresh, k)) { state[k] = fresh[k]; } }
  }

  var SimCore = {
    CONFIG: CONFIG, DERIVED: D,
    createState: createState, step: step, setRods: setRods,
    scram: scram, recover: recover, reset: reset,
    _classify: classify, _satPressure: satPressure
  };

  if (typeof window !== 'undefined') { window.SimCore = SimCore; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = SimCore; }
})();
