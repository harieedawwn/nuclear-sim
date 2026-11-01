// quick screenshot helper: node tests/shot.mjs <url> <out.png> <w> <h> [waitMs] [js]
import { chromium } from 'playwright';
const [url, out, w = 1440, h = 900, wait = 4000, js = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(url);
await page.waitForTimeout(+wait);
if (js) console.log('eval:', JSON.stringify(await page.evaluate(js)));
await page.screenshot({ path: out });
console.log(logs.slice(0, 15).join('\n'));
await browser.close();
