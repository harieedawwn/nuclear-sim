// capture close-up views: node tests/views.mjs <outdir> part1,part2,...
import { chromium } from 'playwright';
const [out, list = 'reactor,turbine,tower', w = 1100, h = 800] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
await page.goto('http://localhost:4173/');
await page.addStyleTag({ content: '#scene.is3d{height:100vh!important} .side,.controls,.status,.head{display:none!important}' });
await page.waitForTimeout(3000);
for (const p of list.split(',')) {
  await page.evaluate((id) => (id === 'overview' ? window.__scene.overview() : window.__scene.focusPart(id)), p);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${out}/v-${p}.png` });
}
await browser.close();
