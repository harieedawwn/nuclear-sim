// End-to-end checks (Chromium). Run against a preview server:
//   npm run build && npx vite preview --port 4173   (then)   node tests/e2e.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:4173/';
const url = base + '?zarsrc=31&utm_source=zalo';
const GPU = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
const skipPerf = process.argv.includes('--no-perf');
let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) failed++; };

async function open(browser, vp, touch) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  // the injected in-app-browser error below is foreign: not counted as ours
  page.on('pageerror', (e) => { if (!/zaloJSV2/.test(e.message)) errors.push('pageerror ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector('#btn-start:not([disabled])', { timeout: 30000 });
  await page.click('#btn-start');
  await page.waitForTimeout(700);
  if (await page.isVisible('#coach')) await page.click('#coach-skip');
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth);

const browser = await chromium.launch({ args: GPU });
for (const [name, vp, touch] of [['390x844', { width: 390, height: 844 }, true], ['844x390', { width: 844, height: 390 }, true], ['1440x900', { width: 1440, height: 900 }, false]]) {
  const { ctx, page, errors } = await open(browser, vp, touch);
  ok(await page.evaluate(() => !!window.__scene && window.__scene.kind === '3d'), `${name}: 3D scene mounted`);
  // a foreign in-app-browser script error must be ignored silently
  await page.addScriptTag({ content: 'setTimeout(function () { zaloJSV2.getInfo(); }, 0);' });
  await page.waitForTimeout(500);
  ok(await page.isHidden('#toast'), `${name}: zaloJSV2 ReferenceError ignored (no toast)`);
  ok(await noHScroll(page), `${name}: no horizontal scroll`);
  // slider: keyboard and buttons
  await page.focus('#rods');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  ok(await page.evaluate(() => window.__sim.state.w === 58), `${name}: slider keyboard moves rods (w=58)`);
  await page.click('#btn-plus');
  ok(await page.evaluate(() => window.__sim.state.w === 60), `${name}: + button snaps to 60`);
  // 3D rod handle drag (mouse on desktop, touch on phones)
  await page.evaluate(() => window.__scene.focusPart('reactor'));
  await page.waitForTimeout(1700);
  await page.click('#info-close').catch(() => {});
  const h = await page.evaluate(() => window.__scene.handlePoint());
  const w0 = await page.evaluate(() => window.__sim.state.w);
  if (touch) {
    const cdp = await ctx.newCDPSession(page);
    const tp = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: h.x, y }] });
    await tp('touchStart', h.y);
    for (let i = 1; i <= 8; i++) await tp('touchMove', h.y - i * 10);
    await tp('touchEnd');
  } else {
    await page.mouse.move(h.x, h.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(h.x, h.y - i * 10);
    await page.mouse.up();
  }
  await page.waitForTimeout(200);
  const w1 = await page.evaluate(() => window.__sim.state.w);
  ok(w1 > w0 + 5, `${name}: dragging the 3D rod handle up raises rods (${w0} -> ${w1.toFixed(1)})`);
  // force danger -> auto SCRAM -> recover
  await page.evaluate(() => { const s = window.__sim.state, SC = window.__sim.SC; SC.setRods(s, 100); s.rodPos = 100; s.tCore = 358; s.pTh = SC.DERIVED.pMax * 0.97; });
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => document.getElementById('app').dataset.s === 'danger'), `${name}: danger state shown`);
  await page.waitForFunction(() => window.__sim.state.scrammed, null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => window.__sim.state.scrammed), `${name}: auto-SCRAM after 5 s in danger`);
  ok(await page.isDisabled('#rods'), `${name}: slider locked after SCRAM`);
  await page.waitForFunction(() => !document.getElementById('btn-recover').disabled, null, { timeout: 15000 }).catch(() => {});
  await page.click('#btn-recover');
  ok(await page.evaluate(() => !window.__sim.state.scrammed), `${name}: Khôi phục restores control`);
  await page.click('#btn-reset');
  ok(await page.evaluate(() => window.__sim.state.w === 60 && !window.__sim.state.scrammed), `${name}: Đặt lại`);
  // part info via label
  await page.evaluate(() => window.__scene.overview());
  await page.waitForTimeout(1700);
  const tag = page.locator('.tag[data-part="turbine"]:not(.off)');
  if (await tag.count()) {
    await tag.click(); await page.waitForTimeout(300);
    ok(await page.isVisible('#info') && (await page.textContent('#info-title')) === 'Tuabin', `${name}: tapping a label opens part info`);
  } else ok(false, `${name}: turbine label visible`);
  ok(await noHScroll(page), `${name}: still no horizontal scroll`);
  const info = await page.evaluate(() => window.__scene.info());
  console.log(`      ${name}: tier=${info.tier} drawCalls=${info.calls} tris=${info.tris} textures=${info.tex}`);
  ok(info.calls <= 150, `${name}: draw calls ${info.calls} <= 150`);
  ok(errors.length === 0, `${name}: no console errors` + (errors.length ? ' -> ' + errors.join(' | ').slice(0, 300) : ''));
  await ctx.close();
}

// frame time with 4x CPU throttling, per tier
if (!skipPerf) {
  const { ctx, page } = await open(browser, { width: 1440, height: 900 }, false);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (const tier of ['low', 'medium', 'high']) {
    await page.evaluate((t) => { window.__scene.setQuality(t); }, tier);
    await page.waitForTimeout(2000);
    const ms = await page.evaluate(() => new Promise((res) => {
      const t = []; let last = performance.now();
      function f(n) { t.push(n - last); last = n; if (t.length < 130) requestAnimationFrame(f); else res(t.slice(10).reduce((a, b) => a + b) / (t.length - 10)); }
      requestAnimationFrame(f);
    }));
    console.log(`      4x CPU throttle, tier ${tier}: ${ms.toFixed(1)} ms/frame (${(1000 / ms).toFixed(0)} fps)`);
  }
  await ctx.close();
}
await browser.close();

// 2D fallback when WebGL is unavailable
{
  const b = await chromium.launch({ args: ['--disable-3d-apis'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector('#btn-start:not([disabled])', { timeout: 15000 });
  ok(await page.locator('#scene svg').count() === 1 && await page.locator('canvas.gl').count() === 0, '2D fallback used without WebGL');
  ok(await page.isHidden('#toast') && errors.length === 0, '2D fallback: no error shown' + (errors.length ? ' -> ' + errors.join(' | ') : ''));
  await b.close();
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
