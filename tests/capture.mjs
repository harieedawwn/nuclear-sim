// Capture README screenshots, the Open Graph image and the app icons.
//   npm run build && npx vite preview --port 4173   (then)   node tests/capture.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function app(vp, mobile, opts = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: opts.dpr || (mobile ? 3 : 1), hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('pwr_tour_done', '1'); localStorage.setItem('pwr_hint_seen', '1'); localStorage.setItem('pwr_quality', 'high'); } catch (e) { /* ignore */ } });
  await page.goto(base);
  await page.waitForSelector('#btn-start:not([disabled])', { timeout: 30000 });
  await page.click('#btn-start');
  await page.waitForTimeout(4500);
  return { ctx, page };
}

{ // desktop hero
  const { ctx, page } = await app({ width: 1440, height: 900 }, false, { dpr: 1.5 });
  await page.screenshot({ path: 'docs/hero.jpg', type: 'jpeg', quality: 86 });
  await page.evaluate(() => window.__scene.focusPart('reactor'));
  await page.waitForTimeout(2600);
  await page.screenshot({ path: 'docs/reactor.jpg', type: 'jpeg', quality: 86 });
  await page.evaluate(() => window.__scene.focusPart('turbine'));
  await page.waitForTimeout(2600);
  await page.screenshot({ path: 'docs/turbine.jpg', type: 'jpeg', quality: 86 });
  await ctx.close();
}
{ // phone
  const { ctx, page } = await app({ width: 390, height: 844 }, true);
  await page.screenshot({ path: 'docs/phone.jpg', type: 'jpeg', quality: 86 });
  await ctx.close();
}
{ // Open Graph 1200x630: scene only with a title
  const { ctx, page } = await app({ width: 1200, height: 630 }, false, { dpr: 1 });
  await page.addStyleTag({ content: `
    .panel, .toolbar, .hint, .labels, .tip, .info { display: none !important; }
    .brand { left: 44px; top: 40px; gap: 16px; }
    .brand .logo { width: 54px; height: 54px; }
    .brand h1 { font-size: 40px; letter-spacing: -.02em; }
    .brand p { font-size: 20px; margin-top: 4px; }` });
  await page.evaluate(() => { window.__scene.setInsets(0, 0); window.__scene.overview(); });
  await page.waitForTimeout(2200);
  await page.evaluate(() => { document.querySelector('.brand p').textContent = 'Mô phỏng 3D tương tác · Lò nước áp lực 1000 MW'; });
  await page.screenshot({ path: 'public/og-image.jpg', type: 'jpeg', quality: 88 });
  await ctx.close();
}
{ // icons from the SVG
  const svg = readFileSync('public/favicon.svg', 'utf8');
  for (const [file, size] of [['public/apple-touch-icon.png', 180], ['public/favicon-32.png', 32]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const body = file.includes('apple') ? svg.replace('rx="14"', 'rx="0"') : svg;
    await page.setContent(`<html><body style="margin:0;background:transparent">${body.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: file, omitBackground: true });
    await page.close();
  }
}
await browser.close();
console.log('captured');
