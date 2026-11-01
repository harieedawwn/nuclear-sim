// engine.js - procedural sound for the plant (Web Audio API). Every layer follows the simulation state.
// buildGraph() works on any BaseAudioContext (live or OfflineAudioContext, used by the tests);
// createAudio() wraps it for the page: iOS unlock, enable/volume, tab suspend, quality tier.
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/* ------------------------------------------------------------------ buffers (generated once) */
function noiseBuffers(ctx, seconds) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const mk = () => ctx.createBuffer(2, n, sr);
  const white = mk(), pink = mk(), brown = mk();
  for (let ch = 0; ch < 2; ch++) {
    const w = white.getChannelData(ch), p = pink.getChannelData(ch), b = brown.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 2 - 1;
      w[i] = x * 0.5;
      // Paul Kellet's pink filter
      b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.08; b6 = x * 0.115926;
      last = (last + 0.02 * x) / 1.02; b[i] = last * 3.2;
    }
    // crossfade the loop seam
    const f = Math.min(2048, n >> 3);
    [w, p, b].forEach((d) => { for (let i = 0; i < f; i++) { const k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; } });
  }
  return { white, pink, brown };
}

function impulse(ctx, seconds) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds), buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const k = 0.18 + 0.75 * (t / seconds);            // darker towards the tail
      lp += (Math.random() * 2 - 1 - lp) * (1 - k);
      d[i] = lp * Math.exp(-t * 3.2) * 0.6;
    }
    // a few early reflections
    [0.011, 0.019, 0.027, 0.041].forEach((t, j) => { const i = Math.floor(t * sr) + ch * 7; if (i < n) d[i] += (0.5 - j * 0.09) * (ch ? -1 : 1); });
  }
  return buf;
}

// small one-shot buffers built from decaying partials
function shot(ctx, seconds, fn) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < n; i++) { d[i] = fn(i / sr); peak = Math.max(peak, Math.abs(d[i])); }
  if (peak > 0) for (let i = 0; i < n; i++) d[i] *= 0.9 / peak;
  return buf;
}
const TAU = Math.PI * 2;
const rn = () => Math.random() * 2 - 1;
function shots(ctx) {
  return {
    // CRDM magnetic latch step: sharp transient + metallic ring + small knock
    click: shot(ctx, 0.07, (t) => rn() * Math.exp(-t * 900) * 0.8 +
      (Math.sin(TAU * 1420 * t) * 0.5 + Math.sin(TAU * 2330 * t) * 0.35 + Math.sin(TAU * 3710 * t) * 0.2) * Math.exp(-t * 110) +
      Math.sin(TAU * 190 * t) * Math.exp(-t * 70) * 0.6),
    // SCRAM: latch release clank and the rods landing
    clank: shot(ctx, 0.6, (t) => rn() * Math.exp(-t * 160) * 0.7 +
      [[380, 9], [640, 12], [1130, 16], [1870, 22], [2590, 30]].reduce((s, p) => s + Math.sin(TAU * p[0] * t + p[0]) * Math.exp(-t * p[1]) * 0.35, 0)),
    thud: shot(ctx, 0.9, (t) => Math.sin(TAU * (34 * t + 30 * (1 - Math.exp(-t * 8)) / 8)) * Math.exp(-t * 5.5) +
      rn() * Math.exp(-t * 40) * 0.35),
    // generator breaker
    breaker: shot(ctx, 0.35, (t) => rn() * Math.exp(-t * 300) * 0.6 + Math.sin(TAU * 95 * t) * Math.exp(-t * 18) * 0.9 +
      Math.sin(TAU * 610 * t) * Math.exp(-t * 60) * 0.4),
    // steam-generator bubbles: 12 grains of 50 ms with rising pitch
    bubbles: shot(ctx, 0.6, (t) => {
      const k = Math.floor(t / 0.05), u = t - k * 0.05, f = 380 + ((k * 137) % 11) * 70;
      return Math.sin(TAU * f * u * (1 + 3.5 * u)) * Math.exp(-u * 70) * (u < 0.002 ? u / 0.002 : 1);
    }),
    tick: shot(ctx, 0.03, (t) => rn() * Math.exp(-t * 1400) * 0.6 + Math.sin(TAU * 2600 * t) * Math.exp(-t * 300) * 0.5)
  };
}

/* ------------------------------------------------------------------ graph */
// focus groups: which camera focus makes a layer louder and clearer
const GROUPS = {
  reactor: ['reactor', 'pressurizer', 'pump', 'containment', 'sg'],
  steam: ['sg', 'turbine', 'condenser'],
  turbine: ['turbine', 'condenser'],
  generator: ['generator', 'grid'],
  tower: ['tower'],
  wind: []
};

export function buildGraph(ctx, opts) {
  opts = opts || {};
  const tier = opts.tier || 'medium';
  const lowTier = tier === 'low';
  const N = noiseBuffers(ctx, lowTier ? 2 : 3);
  const S = shots(ctx);
  const now = () => ctx.currentTime;
  const nodes = [];
  const keep = (n) => { nodes.push(n); return n; };

  // master: volume -> compressor -> limiter -> soft clip (guarantees |x| < 1)
  const master = ctx.createGain(); master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
  const clip = ctx.createWaveShaper();
  const curve = new Float32Array(2049);
  for (let i = 0; i < 2049; i++) { const x = (i / 1024) - 1; curve[i] = Math.tanh(1.4 * x) / Math.tanh(1.4) * 0.96; }
  clip.curve = curve;
  master.connect(comp); comp.connect(lim); lim.connect(clip);
  const out = ctx.createGain(); out.gain.value = 1;
  clip.connect(out);
  out.connect(opts.destination || ctx.destination);

  const sim = ctx.createGain(); sim.connect(master);           // all plant layers (ducked when paused)
  const alarmBus = ctx.createGain(); alarmBus.gain.value = 0.9; alarmBus.connect(master);
  const uiBus = ctx.createGain(); uiBus.gain.value = 0.5; uiBus.connect(master);
  const fxBus = ctx.createGain(); fxBus.connect(sim);
  // reverb send
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, lowTier ? 1.0 : 2.2);
  const verbIn = ctx.createGain(); verbIn.gain.value = lowTier ? 0.18 : 0.28;
  const verbOut = ctx.createGain(); verbOut.gain.value = 0.9;
  verbIn.connect(verb); verb.connect(verbOut); verbOut.connect(master);
  alarmBus.connect(verbIn);

  const noise = (kind, rate) => {
    const s = ctx.createBufferSource();
    s.buffer = N[kind]; s.loop = true; s.playbackRate.value = rate || 1;
    s.start(0, Math.random() * (N[kind].duration - 0.1));
    keep(s);
    return s;
  };
  const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); keep(o); return o; };
  const filt = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 0.707; return b; };
  const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const chain = (...ns) => { for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; };

  const layers = {};
  // spatial strip: level (state) -> focus gain -> focus low-pass -> pan -> sim (+ reverb send)
  function strip(name, group, pan, send) {
    const level = gain(0), focus = gain(1), lp = filt('lowpass', 9000, 0.5);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) p.pan.value = pan;
    chain(level, focus, lp);
    if (p) { lp.connect(p); p.connect(opts.solo ? (opts.solo === name ? out : gain(0)) : sim); }
    else lp.connect(opts.solo ? (opts.solo === name ? out : gain(0)) : sim);
    const sendG = gain(send || 0.15); lp.connect(sendG); sendG.connect(verbIn);
    layers[name] = { level, focus, lp, pan: p, group, basePan: pan };
    return level;
  }

  // 1. reactor hall room tone
  {
    const L = strip('room', 'reactor', -0.35, 0.3);
    chain(noise('brown', 0.8), filt('lowpass', 220, 0.6), gain(0.7), L);
    const hum = osc('sine', 120); chain(hum, gain(0.03), L);
  }
  // 2. reactor coolant pumps: motor tone with harmonics + bladed whir
  const pump = {};
  {
    const L = strip('pump', 'reactor', -0.3, 0.25);
    pump.f = [osc('triangle', 50), osc('sine', 100), osc('sine', 150.6), osc('sine', 297)];
    const g = [0.10, 0.08, 0.05, 0.025];
    pump.f.forEach((o, i) => chain(o, gain(g[i]), L));
    if (!lowTier) {
      pump.bp = filt('bandpass', 700, 3);
      chain(noise('white', 1), pump.bp, gain(0.5), L);
    }
  }
  // 3. control rod drives: stepping clicks (event-driven) on their own strip
  const crdmIn = strip('crdm', 'reactor', -0.25, 0.35);
  layers.crdm.level.gain.value = 1;
  // 4. steam: hiss (brightness follows pressure) + rumble (follows steam flow)
  const steam = {};
  {
    const L = strip('steam', 'steam', -0.05, 0.2);
    steam.hp = filt('highpass', 1200, 0.5); steam.bp = filt('bandpass', 3800, 0.6);
    steam.hiss = gain(0.6);
    chain(noise('white', 1), steam.hp, steam.bp, steam.hiss, L);
    steam.rum = gain(0.0);
    chain(noise('brown', 1), filt('lowpass', 140, 0.7), steam.rum, L);
  }
  // 5. SG boiling texture (granular, event-driven)
  const boilIn = strip('boil', 'reactor', -0.4, 0.3);
  layers.boil.level.gain.value = 1;
  // 6. turbine: blade-pass whine + broadband roar
  const turb = {};
  {
    const L = strip('turbine', 'turbine', 0.05, 0.22);
    turb.w1 = osc('sine', 1500); turb.w2 = osc('sine', 3000); turb.w3 = osc('triangle', 50);
    turb.g1 = gain(0.05); turb.g2 = gain(0.018); turb.g3 = gain(0.08);
    chain(turb.w1, turb.g1, L); chain(turb.w2, turb.g2, L); chain(turb.w3, filt('lowpass', 300), turb.g3, L);
    turb.bp = filt('bandpass', 600, 0.8); turb.roar = gain(0.7);
    chain(noise('pink', 1), turb.bp, turb.roar, L);
  }
  // 7. generator: 50 Hz hum with harmonics (100 Hz magnetostriction dominant)
  const gen = {};
  {
    const L = strip('gen', 'generator', 0.25, 0.15);
    gen.o = [osc('sine', 50), osc('sine', 100), osc('sine', 150), osc('sine', 200), osc('sine', 300)];
    const g = [0.10, 0.16, 0.05, 0.05, 0.025];
    gen.o.forEach((o, i) => chain(o, gain(g[i]), L));
  }
  // 8. cooling tower rain + outdoor wind
  const tower = {};
  {
    const L = strip('rain', 'tower', 0.5, 0.1);
    tower.bp = filt('bandpass', 2200, 0.5);
    tower.am = gain(0.8);
    chain(noise('white', 1), filt('highpass', 500), tower.bp, tower.am, L);
    if (!lowTier) {
      const lfo = osc('sine', 7.3), lg = gain(0.15); lfo.connect(lg); lg.connect(tower.am.gain);
      chain(noise('pink', 0.7), filt('lowpass', 500), gain(0.5), L);
    }
    const W = strip('wind', 'wind', 0.1, 0.05);
    tower.wbp = filt('bandpass', 420, 0.9);
    tower.wg = gain(0.5);
    chain(noise('pink', 1), tower.wbp, tower.wg, W);
    const lfo1 = osc('sine', 0.07), lfo1g = gain(160); lfo1.connect(lfo1g); lfo1g.connect(tower.wbp.frequency);
    const lfo2 = osc('sine', 0.11), lfo2g = gain(0.25); lfo2.connect(lfo2g); lfo2g.connect(tower.wg.gain);
  }

  /* ---------------------------------------------------------------- events */
  function play(buf, dest, when, g, rate, offset, dur) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate || 1;
    const v = ctx.createGain(); v.gain.value = g;
    s.connect(v); v.connect(dest);
    if (dur) s.start(when, offset || 0, dur); else s.start(when, offset || 0);
    s.onended = () => { try { v.disconnect(); } catch (e) { /* ignore */ } };
    return s;
  }
  // alarms: scheduled tone patterns, cancellable
  let alarmMode = 'none', alarmNext = 0;
  const alarmNodes = [];
  function tone(when, f, dur, g, type, f2) {
    const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, when);
    if (f2) o.frequency.linearRampToValueAtTime(f2, when + dur);
    const v = ctx.createGain();
    v.gain.setValueAtTime(0, when);
    v.gain.linearRampToValueAtTime(g, when + 0.015);
    v.gain.setTargetAtTime(0, when + dur * 0.6, dur * 0.25);
    let node = o;
    if (type === 'sawtooth' || type === 'square') { const lp = filt('lowpass', 1800, 0.7); o.connect(lp); node = lp; }
    node.connect(v); v.connect(alarmBus);
    o.start(when); o.stop(when + dur * 1.6 + 0.1);
    alarmNodes.push(o);
    o.onended = () => { const i = alarmNodes.indexOf(o); if (i >= 0) alarmNodes.splice(i, 1); try { v.disconnect(); } catch (e) { /* ignore */ } };
  }
  function chime(when) {                     // soft two-note bell for Cảnh báo
    [[880, 0], [1318.5, 0.32]].forEach(([f, d]) => {
      tone(when + d, f, 1.4, 0.10, 'sine'); tone(when + d, f * 2.01, 0.8, 0.025, 'sine'); tone(when + d, f * 3.0, 0.5, 0.01, 'sine');
    });
  }
  function horn(when) {                      // urgent hi-lo horn for Nguy hiểm (filtered, not shrill)
    for (let k = 0; k < 2; k++) {
      tone(when + k * 0.9, 622, 0.42, 0.15, 'sawtooth');
      tone(when + k * 0.9 + 0.45, 466, 0.42, 0.15, 'sawtooth');
    }
  }
  function scramAlarm(when) {                // distinct triple pulse for SCRAM
    for (let k = 0; k < 3; k++) { tone(when + k * 0.16, 1046.5, 0.11, 0.13, 'square'); tone(when + k * 0.16, 523.25, 0.11, 0.08, 'sine'); }
  }
  function setAlarm(mode) {
    if (mode === alarmMode) return;
    alarmMode = mode;
    const t = now();
    // cut whatever is sounding or scheduled
    alarmBus.gain.cancelScheduledValues(t);
    alarmBus.gain.setValueAtTime(alarmBus.gain.value, t);
    alarmBus.gain.linearRampToValueAtTime(0, t + 0.05);
    alarmNodes.slice().forEach((o) => { try { o.stop(t + 0.06); } catch (e) { /* ignore */ } });
    alarmBus.gain.setValueAtTime(0.9, t + 0.08);
    alarmNext = t + 0.1;
  }
  function runAlarm(t) {
    if (alarmMode === 'none' || t + 0.25 < alarmNext) return;
    const at = Math.max(alarmNext, t + 0.02);
    if (alarmMode === 'warn') { chime(at); alarmNext = at + 7; }
    else if (alarmMode === 'danger') { horn(at); alarmNext = at + 2.4; }
    else if (alarmMode === 'scram') { scramAlarm(at); alarmNext = at + 1.6; }
    else if (alarmMode === 'scramQuiet') { scramAlarm(at); alarmNext = at + 9; }
  }

  /* ---------------------------------------------------------------- per-frame update */
  const prev = { rodPos: null, scrammed: false, pElecOn: null, status: 'safe' };
  let clickAcc = 0, boilNext = 0, scramAt = -1, focus = null, pausedNow = false;
  const set = (p, v, tc) => { const t = now(); p.setTargetAtTime(v, t, tc || 0.12); };

  function update(s, dt, o) {
    o = o || {};
    const t = now();
    if (!s) return;
    const paused = !!o.paused;
    if (paused !== pausedNow) { pausedNow = paused; set(sim.gain, paused ? 0.18 : 1, 0.3); }

    const fp = clamp(s.flowPrimary || 0, 0, 1.2), fs = clamp(s.flowSteam || 0, 0, 1.2), fc = clamp(s.flowCooling || 0, 0, 1.2);
    const pf = clamp((s.pTh || 0) / 3000, 0, 1.3), ps = clamp((s.pSteam || 0) / 70, 0, 2.2);
    const rpm = clamp((s.rpm || 0) / 3000, 0, 1.3), pe = clamp((s.pElec || 0) / 1000, 0, 1.3);

    // continuous layers
    set(layers.room.level.gain, 0.22 + 0.1 * fp);
    set(layers.pump.level.gain, 0.65 * Math.pow(fp, 0.8));
    const pf0 = 30 + 22 * fp;
    pump.f.forEach((osc, i) => set(osc.frequency, pf0 * [1, 2, 3.01, 5.93][i], 0.3));
    if (pump.bp) set(pump.bp.frequency, 380 + 620 * fp, 0.3);
    set(layers.steam.level.gain, 0.5 * Math.pow(fs, 1.2) * Math.min(1.4, 0.3 + ps));
    set(steam.bp.frequency, 1800 + 3400 * Math.min(1.5, ps), 0.3);
    set(steam.hiss.gain, 0.35 + 0.35 * Math.min(1.5, ps));
    set(steam.rum.gain, 0.9 * fs);
    set(layers.turbine.level.gain, 0.6 * Math.pow(rpm, 1.3));
    set(turb.w1.frequency, 30 + 1470 * rpm, 0.08); set(turb.w2.frequency, 60 + 2940 * rpm, 0.08); set(turb.w3.frequency, 8 + 42 * rpm, 0.08);
    set(turb.g1.gain, 0.05 * Math.pow(rpm, 1.5)); set(turb.g2.gain, 0.018 * Math.pow(rpm, 2));
    set(turb.bp.frequency, 160 + 700 * rpm, 0.15); set(turb.roar.gain, 0.4 + 0.5 * fs);
    set(layers.gen.level.gain, 0.55 * Math.pow(pe, 0.7));
    const gf = 50 * Math.max(0.2, rpm);
    gen.o.forEach((osc, i) => set(osc.frequency, gf * [1, 2, 3, 4, 6][i], 0.1));
    set(layers.rain.level.gain, 0.42 * Math.pow(fc, 0.9));
    set(tower.bp.frequency, 1500 + 1500 * fc, 0.4);
    set(layers.wind.level.gain, 0.16);

    // focus mix: the part in focus is louder and brighter, others softer and duller
    if (o.focus !== focus) {
      focus = o.focus || null;
      for (const k in layers) {
        const L = layers[k];
        const match = focus && GROUPS[L.group] && GROUPS[L.group].indexOf(focus) >= 0;
        const g = !focus ? 1 : (match ? 1.7 : (L.group === 'wind' ? 0.6 : 0.32));
        const f = !focus ? 9000 : (match ? 16000 : 1300);
        set(L.focus.gain, g, 0.35); set(L.lp.frequency, f, 0.35);
        if (L.pan) set(L.pan.pan, focus ? (match ? 0 : L.basePan * 1.4) : L.basePan, 0.4);
      }
    }

    // control rod drive stepping: clicks while rods move, rate follows rod speed
    if (prev.rodPos === null) prev.rodPos = s.rodPos;
    const moved = Math.abs((s.rodPos || 0) - prev.rodPos);
    prev.rodPos = s.rodPos;
    if (!paused && moved > 1e-4 && !s.scrammed) {
      clickAcc += moved * 0.45;                         // ~9 steps per second at 20 %/s
      let k = 0;
      while (clickAcc >= 1 && k < 4) {
        clickAcc -= 1;
        play(S.click, crdmIn, t + 0.01 + k * 0.045 + Math.random() * 0.02, 0.32 + Math.random() * 0.12, 0.92 + Math.random() * 0.16);
        k++;
      }
    } else clickAcc = Math.min(clickAcc, 0.9);

    // SCRAM: heavy release + thud
    if (s.scrammed && !prev.scrammed) {
      play(S.clank, fxBus, t + 0.01, 0.75, 1);
      play(S.clank, fxBus, t + 0.05, 0.4, 0.83);
      play(S.thud, fxBus, t + 0.62, 0.95, 1);
      scramAt = t;
    }
    prev.scrammed = !!s.scrammed;

    // breaker clunk when the generator connects or disconnects
    const on = (s.pElec || 0) > 0.5;
    if (prev.pElecOn !== null && on !== prev.pElecOn) play(S.breaker, fxBus, t + 0.01, 0.6, on ? 1 : 0.9);
    prev.pElecOn = on;

    // boiling grains in the steam generator
    if (!paused && pf > 0.02 && !lowTier) {
      if (boilNext < t) boilNext = t;
      const rate = 3 + 26 * Math.min(1.2, pf);         // grains per second
      let guard = 0;
      while (boilNext < t + 0.12 && guard++ < 8) {
        const k = Math.floor(Math.random() * 12);
        play(S.bubbles, boilIn, boilNext, 0.05 + 0.1 * Math.random() * Math.min(1, pf), 0.8 + Math.random() * 0.5, k * 0.05, 0.05);
        boilNext += (0.4 + Math.random() * 1.2) / rate;
      }
    }

    // alarms follow the safety state; all stop on recover/reset
    const mode = paused ? 'none' : s.scrammed ? (t - scramAt < 6 ? 'scram' : 'scramQuiet') : s.status === 'danger' ? 'danger' : s.status === 'warn' ? 'warn' : 'none';
    setAlarm(mode);
    runAlarm(t);
    prev.status = s.status;
  }

  function ui(kind) {
    const t = now();
    const g = kind === 'press' ? 0.5 : kind === 'open' ? 0.3 : 0.35, r = kind === 'press' ? 0.7 : kind === 'open' ? 0.85 : 1;
    play(S.tick, uiBus, t + 0.005, g, r);
  }

  return {
    master, out, layers, update, ui,
    setVolume(v) { set(master.gain, 0.95 * v * v, 0.05); },
    alarmMode: () => alarmMode,
    dispose() { nodes.forEach((n) => { try { n.stop(); } catch (e) { /* ignore */ } }); try { out.disconnect(); } catch (e) { /* ignore */ } }
  };
}

/* ------------------------------------------------------------------ page wrapper */
export function createAudio() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  let ctx = null, graph = null, enabled = false, volume = 0.7, tier = 'medium', failed = !AC;
  let wantRunning = false;

  function ensure() {
    if (ctx || failed) return !!ctx;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
      graph = buildGraph(ctx, { tier });
      graph.setVolume(enabled ? volume : 0);
      return true;
    } catch (e) { failed = true; ctx = null; graph = null; return false; }
  }
  function resume() { if (ctx && ctx.state !== 'running' && wantRunning) ctx.resume().catch(() => {}); }

  return {
    get supported() { return !failed; },
    // must be called inside a user gesture (iOS)
    unlock() {
      if (!ensure()) return Promise.resolve(false);
      try {
        const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
      } catch (e) { /* ignore */ }
      wantRunning = true;
      return ctx.resume().then(() => true).catch(() => false);
    },
    setEnabled(on) {
      enabled = !!on;
      if (!ctx) return;
      graph.setVolume(enabled ? volume : 0);
      wantRunning = enabled;
      if (enabled) resume();
      else setTimeout(() => { if (!enabled && ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 300);
    },
    setVolume(v) { volume = clamp(v, 0, 1); if (graph && enabled) graph.setVolume(volume); },
    setTier(t) { tier = t; /* layer set is fixed per context; tier applies on next creation */ },
    update(state, dt, o) { if (graph && enabled && ctx.state === 'running') graph.update(state, dt, o); },
    ui(kind) { if (graph && enabled && ctx.state === 'running') { try { graph.ui(kind); } catch (e) { /* ignore */ } } },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); },
    resume() { if (enabled) { wantRunning = true; resume(); } },
    _graph: () => graph
  };
}
