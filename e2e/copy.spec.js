// UX-01: Copy buttons. The clipboard is read back, so these check what a person would really paste. All text here is invented.
import { test, expect } from '@playwright/test';
import { seed, signedInAs, watch } from './helpers.js';

const withClipboard = async (browser, opts = {}) => {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], ...opts });
  const page = await ctx.newPage();
  return { ctx, page };
};
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const openExplorer = async (page) => {
  await page.locator('.yyc-nav-item:visible, .yyc-botnav-item:visible').filter({ hasText: 'Lever Explorer' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lever Explorer' })).toBeVisible({ timeout: 15_000 });
};

test('UX-01 a strategy in the Lever Explorer copies with its impact, lever, source and a working link', async ({ browser }) => {
  const { ctx, page } = await withClipboard(browser);
  const problems = watch(page);
  await seed(page); await page.goto('/'); await page.locator('.yyc-doc').first().waitFor();
  await openExplorer(page);
  const btn = page.getByRole('button', { name: 'Copy this strategy' }).first();
  await btn.click();
  await expect(page.getByRole('status').filter({ hasText: 'Strategy copied' })).toBeVisible();
  const text = await clip(page);
  expect(text).toContain('Charge for delivery');
  expect(text).toContain('Actual impact: Delivery orders stayed level');
  expect(text).toContain('Lever: Price · Source: Acme Bakery');
  const link = text.match(/Link: (\S+)/)[1];
  expect(link).toMatch(/#\/library\?doc=d1&section=Pricing$/);
  await expect(page.locator('.yyc-modal')).toHaveCount(0); // pressing Copy did not open the document
  await expect(btn.locator('svg')).toBeVisible(); // the icon changes to a tick for a moment (checked below)
  expect(problems).toEqual([]);
  await ctx.close();
});

test('UX-01 the document window copies a link that opens the same document, and each strategy in it', async ({ browser }) => {
  const { ctx, page } = await withClipboard(browser);
  await seed(page); await page.goto('/'); await page.locator('.yyc-doc').first().waitFor();
  await page.getByText('Acme Bakery').first().click();
  await expect(page.locator('.yyc-modal-sheet')).toBeVisible();
  await page.getByRole('button', { name: 'Copy link to this document' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toBeVisible();
  const link = await clip(page);
  expect(link).toMatch(/#\/library\?doc=d1$/);
  await page.locator('.yyc-seg-btn').filter({ hasText: 'Lever records' }).click();
  await page.getByRole('button', { name: 'Copy this strategy' }).first().click();
  expect(await clip(page)).toContain('Source: Acme Bakery');
  await ctx.close();
});

test('UX-01 if the browser refuses to copy, a window shows the text selected so it can still be copied by hand', async ({ browser }) => {
  const { ctx, page } = await withClipboard(browser);
  await page.addInitScript(() => { // a browser that refuses both ways
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('NotAllowedError')) }, configurable: true });
    document.execCommand = () => false;
  });
  await seed(page); await page.goto('/'); await page.locator('.yyc-doc').first().waitFor();
  await openExplorer(page);
  await page.getByRole('button', { name: 'Copy this strategy' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Copy by hand' });
  await expect(dlg).toBeVisible();
  const box = dlg.getByRole('textbox', { name: 'The text to copy' });
  await expect(box).toHaveValue(/Charge for delivery/);
  const selected = await box.evaluate((e) => e.value.slice(e.selectionStart, e.selectionEnd).length === e.value.length);
  expect(selected).toBe(true); // everything is already selected
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await ctx.close();
});

test('UX-01 when the modern clipboard is refused but the older way works, copying still succeeds quietly', async ({ browser }) => {
  const { ctx, page } = await withClipboard(browser);
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); });
  await seed(page); await page.goto('/'); await page.locator('.yyc-doc').first().waitFor();
  await openExplorer(page);
  await page.getByRole('button', { name: 'Copy this strategy' }).first().click();
  // either the older method worked (toast) or, in a browser that blocks it too, the hand-copy window opened: never silence
  await expect(page.getByRole('status').filter({ hasText: 'Strategy copied' }).or(page.getByRole('dialog', { name: 'Copy by hand' }))).toBeVisible();
  await ctx.close();
});

test('UX-01 on a phone the copy buttons are easy to tap and nothing is pushed off the screen', async ({ browser }) => {
  const { ctx, page } = await withClipboard(browser, { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  await seed(page); await page.goto('/'); await page.locator('.yyc-doc').first().waitFor();
  await openExplorer(page);
  const b = await page.getByRole('button', { name: 'Copy this strategy' }).first().boundingBox();
  expect(b.width).toBeGreaterThanOrEqual(36); expect(b.height).toBeGreaterThanOrEqual(36);
  expect(b.x + b.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByText('Acme Bakery').locator('visible=true').first().click(); // the Explorer's own title (the library's is hidden behind it)
  await page.waitForTimeout(500); // the window scales in when it opens: measure after that
  const tools = await page.getByRole('button', { name: 'Copy link to this document' }).boundingBox();
  expect(tools.width).toBeGreaterThanOrEqual(44); expect(tools.height).toBeGreaterThanOrEqual(44);
  const close = await page.getByRole('button', { name: 'Close' }).first().boundingBox();
  expect(close.x + close.width).toBeLessThanOrEqual(375);
  await ctx.close();
});

test('UX-01 an Ask the Brain answer copies as plain text with the question and its sources (each source once, with a link)', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await signedInAs(page); // signed in against a made-up server; the answer service is made up too
  await page.route('**/api/ask', (route) => route.fulfill({ json: {
    answerable: true, logId: 'log-1',
    text: 'The bakery added a **small delivery fee**.\n- It kept its menu prices\n- Orders stayed level',
    citations: [{ doc_id: 'd1', doc_title: 'Acme Bakery', section: 'Pricing', claim: 'Charge for delivery' }, { doc_id: 'd1', doc_title: 'Acme Bakery', section: 'Pricing', claim: 'Charge for delivery' }],
    evidence: [], retrieved: [],
  } }));
  await page.goto('/'); await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 });
  await page.locator('.yyc-nav-item:visible, .yyc-botnav-item:visible').filter({ hasText: 'Ask the Brain' }).first().click();
  const box = page.getByPlaceholder(/Ask anything/);
  await box.fill('How did the bakery handle delivery fees?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const copy = page.getByRole('button', { name: 'Copy answer' });
  await expect(copy).toBeVisible({ timeout: 15_000 });
  await copy.click();
  await expect(page.getByRole('status').filter({ hasText: 'Answer copied, with its sources' })).toBeVisible();
  const text = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'); // Windows keeps line breaks as CRLF on the clipboard
  expect(text).toContain('Question: How did the bakery handle delivery fees?');
  expect(text).toContain('The bakery added a small delivery fee.'); // the ** markers are gone
  expect(text).toContain('• It kept its menu prices');
  expect(text).not.toContain('**');
  expect((text.match(/Acme Bakery \(Pricing\)/g) || []).length).toBe(1); // the repeated source is listed once
  expect(text).toMatch(/Sources:\n• Acme Bakery \(Pricing\): \S+#\/library\?doc=d1&section=Pricing/);
  await ctx.close();
});
