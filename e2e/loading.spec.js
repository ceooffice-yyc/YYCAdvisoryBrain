// Loading behaviour (PERF-01, PERF-04, PERF-05): placeholders while something downloads, a way to try again when a download fails,
// and the size budget. Requirement ids are in the test names (docs/REQUIREMENTS.md).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { seed, watch } from './helpers.js';

const slow = (ms) => async (route) => { await new Promise((r) => setTimeout(r, ms)); await route.continue(); };

test('PERF-05 a loading placeholder is shown while the Knowledge Base downloads, and it is accessible', async ({ page }) => {
  const problems = watch(page);
  await seed(page);
  await page.route('**/assets/KnowledgePanel-*.js', slow(1800));
  await page.goto('/');
  const placeholder = page.getByRole('status', { name: /Loading the Knowledge Base|Loading YYC Advisory Brain/ });
  await expect(placeholder.first()).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes[0].target.join(' ')}`)).toEqual([]);
  await expect(page.locator('.yyc-doc').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.yyc-skel')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('PERF-05 opening a document shows a placeholder, then the text', async ({ page }) => {
  await seed(page);
  await page.route('**/assets/PreviewModal-*.js', slow(1500));
  await page.goto('/');
  await page.getByText('Acme Bakery').first().click();
  await expect(page.getByRole('status', { name: 'Opening the document' })).toBeVisible();
  await expect(page.locator('.yyc-modal')).toContainText('Acme Bakery', { timeout: 15_000 });
  await expect(page.locator('.yyc-docview')).toContainText('Invented text for tests', { timeout: 15_000 });
});

test('PERF-01 a screen that fails to download shows a message and can be tried again', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page.getByText('Acme Bakery').first().waitFor();
  await page.route('**/assets/ChatPanel-*.js', (route) => route.abort('failed'));
  await page.locator('.yyc-nav-item:visible, .yyc-botnav-item:visible').filter({ hasText: 'Ask the Brain' }).first().click();
  const alert = page.getByRole('alert').filter({ hasText: 'This part could not be loaded' });
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.unroute('**/assets/ChatPanel-*.js'); // the connection is back
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ask the Brain' })).toBeVisible({ timeout: 15_000 });
  await expect(alert).toHaveCount(0);
});

test('PERF-01 the first page does not download the Word reader, the HTML cleaner or the extraction code', async ({ page }) => {
  const loaded = [];
  page.on('response', (r) => { const u = r.url(); if (/\/assets\/.*\.js/.test(u)) loaded.push(u.split('/').pop()); });
  await seed(page);
  await page.goto('/');
  await page.getByText('Acme Bakery').first().waitFor();
  await page.waitForTimeout(2500); // time for any idle downloads
  for (const heavy of [/^lib-/, /^purify/, /^extract-/, /^dist-/, /^ChatPanel-/, /^ExplorerPanel-/, /^UsersPanel-/, /^GapPanel-/]) {
    expect(loaded.filter((f) => heavy.test(f)), `${heavy} should wait until it is needed`).toEqual([]);
  }
  expect(loaded.some((f) => /^KnowledgePanel-/.test(f))).toBe(true);
});

test('PERF-04 the size budget holds', () => {
  const out = execFileSync(process.execPath, ['scripts/check-budget.mjs'], { encoding: 'utf8' });
  expect(out).toContain('FIRST LOAD TOTAL');
  expect(out).toContain('All sizes are within budget.');
});

test('PERF-01 the very first screen is styled even if the stylesheet and the script have not arrived', async ({ page }) => {
  await page.route('**/assets/**', (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const boot = page.locator('.boot');
  await expect(boot).toBeVisible();
  expect(await boot.evaluate((el) => getComputedStyle(el).display)).toBe('grid'); // raw, unstyled HTML would be "block"
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
});

test('PERF-05 each screen shows a placeholder shaped like itself', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page.getByText('Acme Bakery').first().waitFor();
  await page.route('**/assets/ChatPanel-*.js', slow(1500));
  await page.route('**/assets/ExplorerPanel-*.js', slow(1500));
  const go = (name) => page.locator('.yyc-nav-item:visible, .yyc-botnav-item:visible').filter({ hasText: name }).first().click();
  await go('Ask the Brain');
  const chat = page.getByRole('status', { name: 'Loading' }).first();
  await expect(chat).toBeVisible();
  const chatCards = await page.locator('.yyc-skel').count();
  expect(await chat.locator('.yyc-section-head').count()).toBe(0); // the chat placeholder has no list-style heading
  await expect(page.getByRole('heading', { level: 1, name: 'Ask the Brain' })).toBeVisible({ timeout: 15_000 });
  await go('Lever Explorer');
  await expect(page.getByRole('status', { name: 'Loading' }).first()).toBeVisible();
  expect(await page.getByRole('status', { name: 'Loading' }).first().locator('.yyc-doc').count()).toBe(0); // not the Knowledge Base card grid
  expect(chatCards).toBeGreaterThan(0);
});
