// UX-04: "Recently deleted": delete something, find it again, bring it back. All text here is invented.
import { test, expect } from '@playwright/test';
import { seed, unlockAdmin, signedInAs, watch } from './helpers.js';

const start = async (page) => { await seed(page); await page.goto('/'); await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 }); await unlockAdmin(page); };
const trashBtn = (page) => page.getByRole('button', { name: 'Recently deleted' });
const confirmDelete = async (page) => { const d = page.locator('.yyc-modal .yyc-btn-danger'); await expect(d).toBeVisible(); await d.click(); };
const docCard = (page, text) => page.locator('.yyc-doc').filter({ hasText: text });

test('UX-04 a deleted material appears in Recently deleted, and Restore brings it back with its strategies', async ({ page }) => {
  const problems = watch(page);
  await start(page);
  await docCard(page, 'Acme Bakery').locator('.yyc-icon-btn.is-danger').click();
  await expect(page.locator('.yyc-modal')).toContainText('You can bring it back from Recently deleted.');
  await confirmDelete(page);
  await expect(page.getByRole('status').filter({ hasText: 'Deleted. You can restore it from Recently deleted.' })).toBeVisible();
  await expect(docCard(page, 'Acme Bakery')).toHaveCount(0);
  await expect(page.locator('.yyc-results-count')).toHaveText('2 materials');
  await trashBtn(page).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Recently deleted' })).toBeVisible();
  const row = page.locator('.yyc-trash-row').filter({ hasText: 'Acme Bakery' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Deleted just now');
  await expect(page.getByRole('heading', { level: 2, name: /^Strategies/ })).toHaveCount(0); // its strategies come back with it: they are not listed separately
  await row.getByRole('button', { name: /^Restore the material/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Material restored' })).toBeVisible();
  await expect(page.getByText('Nothing has been deleted.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await expect(docCard(page, 'Acme Bakery')).toBeVisible();
  await expect(page.locator('.yyc-results-count')).toHaveText('3 materials');
  await expect(docCard(page, 'Acme Bakery')).toContainText('3 lever records'); // its strategies are back too
  expect(problems).toEqual([]);
});

test('UX-04 a single deleted strategy is listed under Strategies and can be restored on its own', async ({ page }) => {
  await start(page);
  await page.locator('.yyc-chip-row').filter({ hasText: 'Filter by lever' }).getByRole('button', { name: /^Price/ }).click();
  const rec = page.locator('.yyc-lever-record').first();
  await expect(rec).toContainText('Charge for delivery');
  await rec.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.yyc-modal')).toContainText('Delete this strategy?');
  await confirmDelete(page);
  await expect(page.locator('.yyc-lever-record')).toHaveCount(0);
  await trashBtn(page).click();
  const row = page.locator('.yyc-trash-row').filter({ hasText: 'Charge for delivery' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Price · from Acme Bakery');
  await expect(page.getByRole('heading', { level: 2, name: /^Materials/ })).toHaveCount(0);
  await row.getByRole('button', { name: /^Restore the strategy/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Strategy restored' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await expect(page.locator('.yyc-lever-record').first()).toContainText('Charge for delivery');
});

test('UX-04 a strategy whose material is also deleted must wait for the material', async ({ page }) => {
  await start(page);
  // delete one strategy on its own, then its whole material
  await page.locator('.yyc-chip-row').filter({ hasText: 'Filter by lever' }).getByRole('button', { name: /^Price/ }).click();
  await page.locator('.yyc-lever-record').first().getByRole('button', { name: 'Delete' }).click();
  await confirmDelete(page);
  await page.locator('.yyc-chip-row').filter({ hasText: 'Filter by lever' }).getByRole('button', { name: /^All levers/ }).click();
  await docCard(page, 'Acme Bakery').locator('.yyc-icon-btn.is-danger').click();
  await confirmDelete(page);
  await trashBtn(page).click();
  const rec = page.locator('.yyc-trash-row').filter({ hasText: 'Charge for delivery' });
  await expect(rec).toContainText('Its material is deleted too. Restore the material first.');
  await expect(rec.getByRole('button', { name: /^Restore the strategy/ })).toBeDisabled();
  await page.locator('.yyc-trash-row').filter({ hasText: 'Acme Bakery' }).first().getByRole('button', { name: /^Restore the material/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Material restored' })).toBeVisible();
  // the material is back; the strategy deleted earlier on its own is still listed, and now it can be restored
  const again = page.locator('.yyc-trash-row').filter({ hasText: 'Charge for delivery' });
  await expect(again.getByRole('button', { name: /^Restore the strategy/ })).toBeEnabled();
  await expect(again).not.toContainText('Restore the material first');
});

test('UX-04 viewers never see Recently deleted', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signedInAs(page, { admin: false });
  await page.goto('/'); await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Recently deleted' })).toHaveCount(0);
  await ctx.close();
});

test('UX-04 if the list cannot be loaded, it says so and Try again works', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signedInAs(page);
  let failures = 1;
  await page.route('**/api/db', async (route) => {
    const op = route.request().method() === 'POST' ? (route.request().postDataJSON() || {}).op : '';
    if (op !== 'trash_list') return route.fallback();
    if (failures-- > 0) return route.fulfill({ status: 502, json: { error: 'The shared database request failed' } });
    return route.fulfill({ json: { docs: [{ id: 'dx', title: 'Old Case', doc_type: 'case_study', industry: 'Retail', deleted_at: new Date(Date.now() - 3 * 3600_000).toISOString(), deleted_by: 'boss@yycadvisors.com' }], records: [] } });
  });
  await page.goto('/'); await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Recently deleted' }).click();
  const err = page.getByRole('alert').filter({ hasText: 'The list could not be loaded' });
  await expect(err).toBeVisible();
  await expect(err).toContainText('The shared database request failed');
  await err.getByRole('button', { name: 'Try again' }).click();
  const row = page.locator('.yyc-trash-row').filter({ hasText: 'Old Case' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Deleted 3 hours ago by boss@yycadvisors.com');
  await ctx.close();
});

test('UX-04 if a restore is refused, the reason is shown and the list stays', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signedInAs(page);
  await page.route('**/api/db', async (route) => {
    const op = route.request().method() === 'POST' ? (route.request().postDataJSON() || {}).op : '';
    if (op === 'trash_list') return route.fulfill({ json: { docs: [], records: [{ id: 'rx', doc_id: 'd1', doc_title: 'Acme Bakery', lever: 'price', claim: 'Smart fees: A.', deleted_at: new Date().toISOString(), deleted_by: 'a@b.test', docDeleted: false }] } });
    if (op === 'record_restore') return route.fulfill({ status: 409, json: { error: 'Restore its material first, then this strategy.' } });
    return route.fallback();
  });
  await page.goto('/'); await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Recently deleted' }).click();
  await page.getByRole('button', { name: /^Restore the strategy/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Restore its material first' })).toBeVisible();
  await expect(page.locator('.yyc-trash-row').filter({ hasText: 'Smart fees' })).toBeVisible(); // still listed
  await ctx.close();
});

test('UX-04 on a phone the list fits, the Restore buttons are easy to tap, and the header button is just an icon', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await start(page);
  const head = await trashBtn(page).boundingBox();
  expect(head.width).toBeLessThan(70); expect(head.height).toBeGreaterThanOrEqual(44); // icon only, like Import / Export
  await docCard(page, 'Acme Bakery').locator('.yyc-icon-btn.is-danger').click();
  await confirmDelete(page);
  await trashBtn(page).click();
  await expect(page.locator('.yyc-trash-row')).toBeVisible();
  const b = await page.getByRole('button', { name: /^Restore the material/ }).boundingBox();
  expect(b.height).toBeGreaterThanOrEqual(44); expect(b.x + b.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await ctx.close();
});
