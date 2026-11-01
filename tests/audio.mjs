// Offline audio checks: graph builds, every layer follows its state variable, alarms start/stop, no clipping.
//   node tests/audio.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5199/tests/blank.html').catch(() => {});
const res = await page.evaluate(async () => {
  const { buildGraph } = await import('/src/audio/engine.js');
  const ZERO = { flowPrimary: 0, flowSteam: 0, flowCooling: 0, pTh: 0, pSteam: 0, rpm: 0, pElec: 0, rodPos: 0, scrammed: false, status: 'safe' };
  async function render(solo, stateAt, secs, tier) {
    const sr = 22050, ctx = new OfflineAudioContext(2, sr * secs, sr);
    const g = buildGraph(ctx, { tier: tier || 'high', solo });
    g.setVolume(1);
    g.update(stateAt(0), 0.05, {});
    for (let t = 0.05; t < secs - 0.01; t += 0.05) {
      const tt = Math.round(t * 1000) / 1000;
      ctx.suspend(tt).then(() => { g.update(stateAt(tt), 0.05, {}); ctx.resume(); });
    }
    const buf = await ctx.startRendering();
    const d = [buf.getChannelData(0), buf.getChannelData(1)];
    const rms = (a, b) => { let s = 0, n = 0; for (const ch of d) for (let i = Math.floor(a * sr); i < Math.floor(b * sr); i++) { s += ch[i] * ch[i]; n++; } return Math.sqrt(s / n); };
    let peak = 0; for (const ch of d) for (const v of ch) peak = Math.max(peak, Math.abs(v));
    return { rms, peak, nan: d.some((ch) => ch.some((v) => !isFinite(v))) };
  }
  const st = (o) => () => Object.assign({}, ZERO, o);
  const out = {};
  const pairs = {
    room: [{ flowPrimary: 0 }, { flowPrimary: 1 }],
    pump: [{ flowPrimary: 0.05 }, { flowPrimary: 1 }],
    steam: [{ flowSteam: 0.05, pSteam: 5 }, { flowSteam: 1, pSteam: 70 }],
    turbine: [{ rpm: 300 }, { rpm: 3000, flowSteam: 1 }],
    gen: [{ pElec: 0, rpm: 3000 }, { pElec: 1000, rpm: 3000 }],
    rain: [{ flowCooling: 0 }, { flowCooling: 1 }],
    boil: [{ pTh: 0 }, { pTh: 3000 }]
  };
  for (const k in pairs) {
    const lo = await render(k, st(pairs[k][0]), 1.5), hi = await render(k, st(pairs[k][1]), 1.5);
    out[k] = { lo: lo.rms(0.8, 1.5), hi: hi.rms(0.8, 1.5) };
  }
  { // rods: still vs moving
    const still = await render('crdm', st({ rodPos: 50 }), 1.5), move = await render('crdm', (t) => Object.assign({}, ZERO, { rodPos: 30 + t * 20 }), 1.5);
    out.crdm = { lo: still.rms(0.3, 1.5), hi: move.rms(0.3, 1.5) };
  }
  { // alarms: warn, danger, scram each audible; danger then safe goes silent again
    const base = await render(null, st({}), 3);
    const warn = await render(null, st({ status: 'warn' }), 3);
    const danger = await render(null, st({ status: 'danger' }), 3);
    const scram = await render(null, (t) => Object.assign({}, ZERO, { scrammed: t > 0.5, status: t > 0.5 ? 'safe' : 'danger' }), 3);
    const stop = await render(null, (t) => Object.assign({}, ZERO, { status: t < 1.5 ? 'danger' : 'safe' }), 4.5);
    out.alarm = { base: base.rms(0.5, 3), warn: warn.rms(0.1, 1.5), danger: danger.rms(0.1, 3), scram: scram.rms(0.5, 2.5), afterStop: stop.rms(2.6, 4.5), baseLate: base.rms(1.5, 3) };
    const brk = await render(null, (t) => Object.assign({}, ZERO, { pElec: t > 0.5 ? 1000 : 0 }), 1.2);
    out.breaker = { before: brk.rms(0.1, 0.5), after: brk.rms(0.5, 0.8) };
  }
  { // worst case for clipping: everything at max, danger horn, rods moving, scram on the way
    const worst = await render(null, (t) => ({ flowPrimary: 1.2, flowSteam: 1.2, flowCooling: 1.2, pTh: 3700, pSteam: 146, rpm: 3700, pElec: 1250,
      rodPos: (t * 60) % 100, scrammed: t > 3, status: 'danger' }), 5);
    const low = await render(null, (t) => ({ flowPrimary: 1, flowSteam: 1, flowCooling: 1, pTh: 3000, pSteam: 69, rpm: 3000, pElec: 1000, rodPos: 60, scrammed: false, status: 'safe' }), 2, 'low');
    out.clip = { peak: worst.peak, nan: worst.nan, lowTierPeak: low.peak, lowTierRms: low.rms(0.5, 2) };
  }
  return out;
});
let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) failed++; };
for (const k of ['room', 'pump', 'steam', 'turbine', 'gen', 'rain', 'boil', 'crdm']) {
  const r = res[k];
  ok(r.hi > r.lo * 1.3 && r.hi > 1e-4, `layer ${k} follows its state (rms ${r.lo.toExponential(2)} -> ${r.hi.toExponential(2)})`);
}
const a = res.alarm;
ok(a.warn > a.base * 1.8, `Cảnh báo chime audible (${a.base.toExponential(2)} -> ${a.warn.toExponential(2)})`);
ok(a.danger > a.base * 1.8, `Nguy hiểm horn audible (${a.danger.toExponential(2)})`);
ok(a.scram > a.base * 1.8, `SCRAM alarm + thud audible (${a.scram.toExponential(2)})`);
ok(a.afterStop < a.baseLate * 1.5 + 1e-4, `alarm stops after returning to safe (${a.afterStop.toExponential(2)} vs ${a.baseLate.toExponential(2)})`);
ok(res.breaker.after > res.breaker.before * 2, `breaker clunk on connect (${res.breaker.before.toExponential(2)} -> ${res.breaker.after.toExponential(2)})`);
ok(res.clip.peak < 1 && !res.clip.nan, `no clipping in worst case (peak ${res.clip.peak.toFixed(3)})`);
ok(res.clip.lowTierPeak < 1 && res.clip.lowTierRms > 1e-3, `low tier graph builds and plays (peak ${res.clip.lowTierPeak.toFixed(3)})`);
await browser.close();
await server.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
