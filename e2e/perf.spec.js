// Speed measurements (PERF-01 to PERF-04). Run with:  PERF_LABEL=before npx playwright test e2e/perf.spec.js
// The numbers are printed and saved to e2e/.results/perf-<label>.json. They describe a SLOW phone on a SLOW connection on purpose:
// the network is limited to about 1.6 Mbit/s with 150 ms delay and the processor is made 4 times slower, because that is where speed matters.
import { test, expect } from '@playwright/test';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { library } from './helpers.js';

const LABEL = process.env.PERF_LABEL || 'run';
const RUNS = Number(process.env.PERF_RUNS) || 5;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

/* A bigger invented library than the functional tests use, so lists are long enough to show lag: 300 documents, 2,400 records. */
function bigLibrary(nDocs = 300) {
  const base = library();
  const index = []; const records = []; const docs = [];
  const industries = ['Trading / Retail', 'Services', 'Manufacturing', 'Construction', 'Healthcare', 'Technology'];
  const levers = ['price', 'volume', 'cogs', 'overheads', 'ar_days', 'inventory_days', 'ap_days', 'talent_strategy'];
  for (let i = 0; i < nDocs; i++) {
    const id = `p${i}`;
    const meta = { id, status: 'active', title: `Case ${i}: ${['Acme', 'Northwind', 'Globex', 'Initech', 'Umbrella'][i % 5]} ${['Bakery', 'Clinics', 'Furniture', 'Logistics', 'Studio'][i % 5]} improves ${['margin', 'cash', 'growth', 'retention'][i % 4]}`, doc_type: 'case_study', industry: `${industries[i % 6]} (invented)`, industry_main: industries[i % 6], industry_sub: `Sub ${i % 9}`, language: 'en', problem_signature: `A made-up problem number ${i} that wraps over a line or two of text`, created: 1760000000000 + i * 3600000 };
    index.push(meta);
    docs.push({ ...meta, sections: base.docs[0].sections, full_text: `${meta.title}\n\nPricing\n\nInvented text.`, html: base.docs[0].html });
    for (let k = 0; k < 8; k++) records.push({ id: `pr${i}-${k}`, status: 'active', doc_id: id, doc_title: meta.title, lever: levers[k], claim_en: `Strategy ${k} of case ${i}: invented words about changing the way the business works so the numbers improve.`, impact: k % 2 ? 'N/A' : `Result ${k} improved by ${k + i % 7} percent.`, section: 'Pricing' });
  }
  return { index, records, docs };
}

async function throttle(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return cdp;
}

async function seedBig(page, lib) {
  await page.addInitScript(({ lib }) => {
    if (localStorage.getItem('kb:config')) return;
    localStorage.setItem('kb:config', JSON.stringify({ adminPass: '12345' }));
    localStorage.setItem('kb:index', JSON.stringify(lib.index));
    localStorage.setItem('kb:levers', JSON.stringify(lib.records));
    for (const d of lib.docs.slice(0, 5)) localStorage.setItem('kb:doc:' + d.id, JSON.stringify(d));
  }, { lib });
}

test('PERF measurements', async ({ browser }) => {
  test.setTimeout(600_000);
  const lib = bigLibrary();
  const out = { label: LABEL, runs: RUNS, at: new Date().toISOString() };
  const loads = [];

  // ── 1. First visit: bytes downloaded and time until the first document card is on screen ──
  for (let r = 0; r < RUNS; r++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await seedBig(page, lib);
    await throttle(ctx, page);
    const js = []; const pending = [];
    page.on('response', (res) => { const u = res.url(); if (/\.js(\?|$)/.test(u)) pending.push(res.body().then((b) => js.push({ url: u.split('/').pop(), raw: b.length, gz: zlib.gzipSync(b).length })).catch(() => {})); });
    const t0 = Date.now();
    await page.goto('/', { waitUntil: 'commit' });
    await page.locator('.yyc-doc').first().waitFor({ timeout: 90_000 });
    const firstCard = Date.now() - t0;
    await page.waitForLoadState('load');
    await Promise.all(pending);
    const paint = await page.evaluate(() => { const p = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint'); return p ? Math.round(p.startTime) : null; });
    loads.push({ firstCard, fcp: paint, jsGz: js.reduce((s, x) => s + x.gz, 0), jsRaw: js.reduce((s, x) => s + x.raw, 0), files: js.map((x) => `${x.url} ${(x.gz / 1024).toFixed(0)}kB`) });
    await ctx.close();
  }
  out.firstVisit = { firstCardMs: median(loads.map((l) => l.firstCard)), fcpMs: median(loads.map((l) => l.fcp || 0)), jsGzipKB: +(median(loads.map((l) => l.jsGz)) / 1024).toFixed(0), jsRawKB: +(median(loads.map((l) => l.jsRaw)) / 1024).toFixed(0), files: loads[0].files };

  // ── 2. Typing: how long each keystroke takes to show on screen, with 300 documents loaded ──
  const typing = { search: [], ask: [] };
  for (let r = 0; r < RUNS; r++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await seedBig(page, lib);
    await page.goto('/');
    await page.locator('.yyc-doc').first().waitFor();
    await throttle(ctx, page);
    await page.waitForTimeout(1500); // let start-up work (idle downloads, the library fetch) finish, so only typing is measured
    await page.evaluate(() => { window.__lag = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'keydown' || e.name === 'keyup' || e.name === 'input') window.__lag.push(e.duration); }).observe({ type: 'event', durationThreshold: 16, buffered: false }); });
    const text = 'delivery fees without losing customers';
    const box = page.getByPlaceholder('Search materials…');
    await box.click();
    const t0 = Date.now();
    await page.keyboard.type(text, { delay: 30 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const total = Date.now() - t0 - text.length * 30;
    const lags = await page.evaluate(() => window.__lag.splice(0));
    typing.search.push({ extraMs: Math.max(0, total), worst: Math.max(0, ...lags), p95: lags.length ? pct(lags, 0.95) : 0 });
    // the Ask box
    await page.locator('.yyc-nav-item:visible').filter({ hasText: 'Ask the Brain' }).first().click();
    const ask = page.getByPlaceholder(/Ask anything/);
    await ask.waitFor();
    await page.waitForTimeout(1500); // the screen has just been downloaded: let it settle
    await page.evaluate(() => window.__lag.splice(0));
    await ask.click();
    await page.keyboard.type(text, { delay: 30 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const lags2 = await page.evaluate(() => window.__lag.splice(0));
    typing.ask.push({ worst: Math.max(0, ...lags2), p95: lags2.length ? pct(lags2, 0.95) : 0 });
    await ctx.close();
  }
  out.typing = { search: { extraMsMedian: median(typing.search.map((x) => x.extraMs)), worstKeyMs: median(typing.search.map((x) => x.worst)), p95KeyMs: median(typing.search.map((x) => x.p95)) }, ask: { worstKeyMs: median(typing.ask.map((x) => x.worst)), p95KeyMs: median(typing.ask.map((x) => x.p95)) } };

  fs.mkdirSync('e2e/.results', { recursive: true });
  fs.writeFileSync(`e2e/.results/perf-${LABEL}.json`, JSON.stringify(out, null, 2));
  console.log('\nPERF ' + LABEL + '\n' + JSON.stringify(out, null, 2));
  // Coarse limits, far from today's numbers and far below the numbers before the speed work (first card 13,000 ms, 296 kB, search keystroke 552 ms):
  // they only catch a return to the old behaviour, not small changes (which vary from computer to computer).
  expect(out.firstVisit.firstCardMs).toBeLessThan(7000);
  expect(out.firstVisit.jsGzipKB).toBeLessThan(170);
  expect(out.typing.search.p95KeyMs).toBeLessThan(400);
  expect(out.typing.ask.p95KeyMs).toBeLessThan(200);
});
