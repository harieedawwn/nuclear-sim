// UI screenshots at phone + desktop: node tests/ui-shots.mjs <outdir> [url]
import { chromium } from 'playwright';
const [out, url = 'http://localhost:4173/?zarsrc=31&utm_source=zalo'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [name, vp, mobile] of [['desk', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true], ['land', { width: 844, height: 390 }, true]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(name, 'pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(name, m.type(), m.text().slice(0, 160)); });
  await page.goto(url);
  await page.waitForSelector('#btn-start:not([disabled])', { timeout: 20000 });
  await page.screenshot({ path: `${out}/${name}-0start.png` });
  await page.click('#btn-start');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}-1tour.png` });
  await page.click('#coach-skip');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}-2main.png` });
  if (name === 'phone') { await page.click('#grip'); await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}-3sheet.png` }); }
  await ctx.close();
}
await browser.close();
