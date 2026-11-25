// DRAFT-01: unsaved Review and Bulk work is kept in the browser and offered back after a refresh. No AI is needed: a draft is planted exactly as the app writes it
// (with the app's own saveDraft), the page is opened, and everything after that is the real screen. All text here is invented.
import { test, expect } from '@playwright/test';
import { saveDraft, draftKey } from '../src/lib/drafts.js';
import { seed, unlockAdmin, watch } from './helpers.js';

const extraction = (title, claim) => ({
  title, doc_type: 'case_study', industry: 'Food & Beverage (retail)', industry_main: 'Trading / Retail', industry_sub: 'Bakery', problem_signature: 'Thin margins', language: 'en',
  sections: [{ heading: 'Pricing', summary_en: 'How the business changed what it charges.' }],
  levers: [{ lever: 'price', claim_en: claim, impact: 'Delivery orders stayed level.', section: 'Pricing' }],
});
const SINGLE = { kind: 'single', title: 'Draft Bakery', text: 'Pricing\n\nSmart fees: A small fee filters tiny orders.', html: '<p>Pricing</p>', extraction: extraction('Draft Bakery', 'Smart fees: A small fee filters tiny orders.'), mnaChoice: null };
const item = (id, status, extra = {}) => ({ id, name: id + '.docx', title: 'Case ' + id, text: 'Text of ' + id, html: '<p>' + id + '</p>', status, include: true, mna: false, detectedMna: false, storyCount: 0, extraction: status === 'done' ? extraction('Case ' + id, 'Strategy ' + id + ': words about ' + id + '.') : null, ...extra });
const BULK = { kind: 'bulk', items: [item('a', 'done'), item('b', 'error', { error: 'The AI was busy' }), item('c', 'extracting')], ticks: {}, reviewId: null, reviewExtraction: null };

/* Plant a draft in the browser's storage once (not again after a reload), written by the app's own code. */
async function plant(page, draft, ageMs = 5 * 60_000) {
  page.on('dialog', (d) => d.accept()); // refreshing with unsaved work shows the browser's "Leave site?" question: the tests answer Leave, like a person pressing refresh
  const bag = new Map();
  saveDraft('local', draft, { store: { setItem: (k, v) => bag.set(k, v), removeItem: () => {}, getItem: () => null }, now: Date.now() - ageMs });
  await page.addInitScript(({ key, json }) => { if (localStorage.getItem('__planted')) return; localStorage.setItem('__planted', '1'); localStorage.setItem(key, json); }, { key: draftKey('local'), json: bag.get(draftKey('local')) });
}
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), draftKey('local'));
const claimBox = async (page) => { // the Description box of the first lever record (a strategy is a title box plus a description box)
  const i = await page.locator('textarea').evaluateAll((els) => els.findIndex((e) => /A small fee|words about a/.test(e.value)));
  expect(i, 'the description text box').toBeGreaterThanOrEqual(0);
  return page.locator('textarea').nth(i);
};

test('DRAFT-01 a review draft is offered after a refresh, restored with its text, and every later edit is kept', async ({ page }) => {
  const problems = watch(page);
  await seed(page); await plant(page, SINGLE);
  await page.goto('/');
  await page.locator('.yyc-doc').first().waitFor();
  await unlockAdmin(page);
  const banner = page.getByRole('region', { name: 'Unsaved draft' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Unsaved review: "Draft Bakery"');
  await expect(banner).toContainText('Saved in this browser 5 minutes ago');
  await banner.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft restored' })).toBeVisible();
  await expect(banner).toHaveCount(0);
  const box = await claimBox(page);
  await expect(box).toHaveValue(/A small fee filters tiny orders/);
  await box.fill('A small fee filters tiny orders. EDITED AFTER RESTORE');
  await expect.poll(() => stored(page), { timeout: 5000 }).toContain('EDITED AFTER RESTORE'); // saved a moment after the last keystroke
  // refresh again: the newest version comes back
  await page.reload();
  await page.locator('.yyc-doc').first().waitFor();
  await unlockAdmin(page);
  await expect(page.getByRole('region', { name: 'Unsaved draft' })).toContainText('Draft Bakery');
  await page.getByRole('region', { name: 'Unsaved draft' }).getByRole('button', { name: 'Restore' }).click();
  await expect(await claimBox(page)).toHaveValue(/EDITED AFTER RESTORE/);
  expect(problems).toEqual([]);
});

test('DRAFT-01 leaving the review on purpose removes the draft, so it is not offered again', async ({ page }) => {
  await seed(page); await plant(page, SINGLE);
  await page.goto('/'); await page.locator('.yyc-doc').first().waitFor(); await unlockAdmin(page);
  await page.getByRole('region', { name: 'Unsaved draft' }).getByRole('button', { name: 'Restore' }).click();
  await expect.poll(() => stored(page)).not.toBeNull();
  await page.getByRole('button', { name: /Discard|Cancel/ }).first().click(); // back from the review
  await page.getByRole('dialog').getByRole('button', { name: /Discard|Back|Clear/ }).first().click();
  await expect.poll(() => stored(page), { timeout: 5000 }).toBeNull();
  await page.reload(); await page.locator('.yyc-doc').first().waitFor(); await unlockAdmin(page);
  await expect(page.getByRole('region', { name: 'Unsaved draft' })).toHaveCount(0);
});

test('DRAFT-01 a saved draft nobody has decided about is left alone: opening the library twice does not erase it', async ({ page }) => {
  await seed(page); await plant(page, SINGLE);
  await page.goto('/'); await page.locator('.yyc-doc').first().waitFor(); await unlockAdmin(page);
  await expect(page.getByRole('region', { name: 'Unsaved draft' })).toBeVisible();
  await page.waitForTimeout(1500); // longer than the moment the app waits before it writes a draft
  expect(await stored(page), 'still saved').not.toBeNull();
  await page.reload(); await page.locator('.yyc-doc').first().waitFor(); await unlockAdmin(page); // a second visit, still undecided
  await page.waitForTimeout(1500);
  await expect(page.getByRole('region', { name: 'Unsaved draft' })).toBeVisible();
  expect(await stored(page), 'still saved after the second visit').not.toBeNull();
});

test('DRAFT-01 "Discard" on the banner asks first, then deletes the draft for good', async ({ page }) => {
  await seed(page); await plant(page, SINGLE);
  await page.goto('/'); await page.locator('.yyc-doc').first().waitFor(); await unlockAdmin(page);
  const banner = page.getByRole('region', { name: 'Unsaved draft' });
  await banner.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText('Discard the saved draft?')).toBeVisible();
  expect(await stored(page)).not.toBeNull(); // nothing is deleted until the question is answered
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await expect(banner).toHaveCount(0);
  expect(await stored(page)).toBeNull();
  await page.reload(); await page.locator('.yyc-doc').first().waitFor(); await unlockAdmin(page);
  await expect(banner).toHaveCount(0);
});

test('DRAFT-01 a bulk list comes back with every file, its result, and a file that was mid-extraction ready to run again', async ({ page }) => {
  await seed(page); await plant(page, BULK);
  await page.goto('/'); await page.locator('.yyc-doc').first().waitFor(); await unlockAdmin(page);
  const banner = page.getByRole('region', { name: 'Unsaved draft' });
  await expect(banner).toContainText('Unsaved bulk list: 3 files, 1 extracted, 1 with errors');
  await banner.getByRole('button', { name: 'Restore' }).click();
  for (const t of ['Case a', 'Case b', 'Case c']) await expect(page.getByText(t).first()).toBeVisible();
  await expect(page.getByText('The AI was busy').first()).toBeVisible(); // the failed file keeps its reason
  // removing a file changes the draft; after a refresh the list is one shorter
  await page.getByRole('button', { name: /Discard.*Case b/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect.poll(() => stored(page), { timeout: 5000 }).not.toContain('Case b');
  await page.reload(); await page.locator('.yyc-doc').first().waitFor(); await unlockAdmin(page);
  await expect(page.getByRole('region', { name: 'Unsaved draft' })).toContainText('Unsaved bulk list: 2 files, 1 extracted');
});

test('DRAFT-01 a draft that is not from this account, is too old, or is damaged is never offered', async ({ page }) => {
  await seed(page);
  const old = new Map();
  saveDraft('local', SINGLE, { store: { setItem: (k, v) => old.set(k, v), removeItem: () => {}, getItem: () => null }, now: Date.now() - 9 * 86_400_000 }); // 9 days old
  await page.addInitScript(({ key, json }) => { if (localStorage.getItem('__planted')) return; localStorage.setItem('__planted', '1'); localStorage.setItem(key, json); localStorage.setItem('yyc:draft:v1:someone-else', '{"v":1}'); }, { key: draftKey('local'), json: old.get(draftKey('local')) });
  await page.goto('/'); await page.locator('.yyc-doc').first().waitFor(); await unlockAdmin(page);
  await expect(page.getByRole('region', { name: 'Unsaved draft' })).toHaveCount(0);
  expect(await stored(page)).toBeNull(); // the old one was removed
  expect(await page.evaluate(() => localStorage.getItem('yyc:draft:v1:someone-else'))).not.toBeNull(); // another account's draft is left alone
});

test('DRAFT-01 the banner works on a phone: readable, buttons easy to tap, no sideways scroll', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await seed(page); await plant(page, BULK);
  await page.goto('/'); await page.locator('.yyc-doc').first().waitFor(); await unlockAdmin(page);
  const banner = page.getByRole('region', { name: 'Unsaved draft' });
  await expect(banner).toBeVisible();
  for (const name of ['Restore', 'Discard']) { const b = await banner.getByRole('button', { name }).boundingBox(); expect(b.height).toBeGreaterThanOrEqual(44); expect(b.x + b.width).toBeLessThanOrEqual(375); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await ctx.close();
});
