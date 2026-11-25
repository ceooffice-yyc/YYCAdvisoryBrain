// UX-02 Search button, UX-03 links and the Back button, UX-05 filters. All text here is invented.
import { test, expect } from '@playwright/test';
import { seed, watch } from './helpers.js';

const kbHeading = (page) => page.getByRole('heading', { level: 1, name: 'Knowledge Base' });
const tabBtn = (page, label) => page.locator('.yyc-nav-item:visible, .yyc-botnav-item:visible').filter({ hasText: label }).first();
const hash = (page) => page.evaluate(() => location.hash);
const titles = (page) => page.locator('.yyc-doc .yyc-doc-title').allTextContents();
// open the app (at a given address) and wait until it has drawn something: the library cards, or the heading of the screen the address points to
const start = async (page, url = '/', heading = null) => { await seed(page); await page.goto(url); if (heading) await page.getByRole('heading', { level: 1, name: heading }).waitFor({ timeout: 15_000 }); else await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 }); };

test('UX-03 each tab has its own address, and Back and Forward move between them', async ({ page }) => {
  const problems = watch(page);
  await start(page);
  expect(await hash(page)).toBe('');
  await tabBtn(page, 'Lever Explorer').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lever Explorer' })).toBeVisible({ timeout: 15_000 });
  expect(await hash(page)).toBe('#/explorer');
  await tabBtn(page, 'Ask the Brain').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ask the Brain' })).toBeVisible({ timeout: 15_000 });
  expect(await hash(page)).toBe('#/ask');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Lever Explorer' })).toBeVisible();
  await page.goBack();
  await expect(kbHeading(page)).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1, name: 'Lever Explorer' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('UX-03 a link opens the same screen with the same filter, and a refresh keeps the place', async ({ page }) => {
  await start(page, '/#/explorer?lever=volume', 'Lever Explorer');
  const volume = page.getByRole('group', { name: 'Filter by lever' }).getByRole('button', { name: /^Volume/ });
  await expect(volume).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Lever Explorer' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('group', { name: 'Filter by lever' }).getByRole('button', { name: /^Volume/ })).toHaveAttribute('aria-pressed', 'true');
  // choosing another lever changes the address (and the refresh keeps that one)
  await page.getByRole('group', { name: 'Filter by lever' }).getByRole('button', { name: /^COGS/ }).click();
  await expect.poll(() => hash(page)).toBe('#/explorer?lever=cogs');
});

test('UX-03 typing in the search box updates the address without adding a Back step per letter', async ({ page }) => {
  await start(page);
  const before = await page.evaluate(() => history.length);
  await page.getByPlaceholder('Search materials…').fill('Bakery');
  await expect.poll(() => hash(page), { timeout: 5000 }).toContain('q=Bakery');
  expect(await page.evaluate(() => history.length)).toBe(before); // replaced, not stacked
  await page.reload();
  await page.locator('.yyc-doc').first().waitFor();
  await expect(page.getByPlaceholder('Search materials…')).toHaveValue('Bakery');
  await expect(page.locator('.yyc-results-count')).toHaveText('Showing 1 of 3 materials');
});

test('UX-03 opening a document adds a Back step; Back closes it, Forward reopens it, and the close button never traps Back', async ({ page }) => {
  await start(page);
  await page.getByText('Acme Bakery').first().click();
  await expect(page.locator('.yyc-modal-sheet, .yyc-modal').filter({ hasText: 'Acme Bakery' }).first()).toBeVisible();
  await expect.poll(() => hash(page)).toBe('#/library?doc=d1');
  await page.goBack();
  await expect(page.locator('.yyc-modal-sheet')).toHaveCount(0);
  expect(await hash(page)).toBe('');
  await page.goForward();
  await expect(page.locator('.yyc-modal-sheet')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).first().click(); // closing with the X goes Back one step, so Back does not reopen it
  await expect(page.locator('.yyc-modal-sheet')).toHaveCount(0);
  expect(await hash(page)).toBe('');
  await expect(page.locator('.yyc-modal-sheet')).toHaveCount(0);
  // Close went back one step, so there is no dead duplicate step left behind: one more Back leaves the app (a leftover step would just show the same screen again)
  await page.goBack();
  expect(page.url()).toBe('about:blank');
});

test('UX-03 a shared document link opens that document (and section), and closing it leaves the app in place', async ({ page }) => {
  await start(page, '/#/library?doc=d1&section=Pricing');
  const dlg = page.locator('.yyc-modal-sheet');
  await expect(dlg).toBeVisible({ timeout: 15_000 });
  await expect(dlg).toContainText('Acme Bakery');
  await page.keyboard.press('Escape'); // the keyboard closes it too
  await expect(dlg).toHaveCount(0);
  await expect.poll(() => hash(page)).toBe(''); // the document is gone from the address (a moment later: the address is rewritten after a short pause)
  await expect(kbHeading(page)).toBeVisible();
});

test('UX-03 bad or unknown addresses fall back safely: a missing document says so, nonsense opens the library, a tab you may not use opens the library', async ({ page }) => {
  const problems = watch(page);
  await start(page, '/#/library?doc=does-not-exist');
  await expect(page.getByRole('alert').filter({ hasText: 'could not be found' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.yyc-modal-sheet')).toHaveCount(0);
  await expect.poll(() => hash(page)).not.toContain('doc=');
  for (const bad of ['/#/nonsense', '/#/library?doc=../../etc/passwd&sort=bogus&lever=%00', '/#/users', '/#/gaps']) {
    await page.goto('/'); await page.goto(bad); await page.reload();
    await expect(kbHeading(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.yyc-modal-sheet')).toHaveCount(0);
  }
  expect(problems.filter((p) => !/404|could not|not be found/i.test(p))).toEqual([]);
});

test('UX-05 sorting changes the order of the cards, is kept in the address, and the default is the order the library always had', async ({ page }) => {
  await start(page);
  const original = await titles(page);
  expect(original[0]).toContain('Acme Bakery'); // oldest first = as added
  const sort = page.getByRole('combobox', { name: 'Sort by' });
  await sort.selectOption('az');
  const az = await titles(page);
  expect(az).toEqual([...az].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })));
  await expect.poll(() => hash(page)).toContain('sort=az');
  await sort.selectOption('newest');
  expect(await titles(page)).toEqual([...original].reverse());
  await expect.poll(() => hash(page)).toContain('sort=newest'); // the address follows a moment later when changes come in quick succession: wait for it before refreshing
  await page.reload(); await page.locator('.yyc-doc').first().waitFor();
  await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveValue('newest');
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('levers');
  const byLevers = await titles(page);
  expect(byLevers[0]).toContain('Acme Bakery'); // 3 strategies, ties by title (Northwind also has 3)
});

test('UX-05 the result count, the removable filter tags and "Clear all" agree with each other', async ({ page }) => {
  await start(page);
  const count = page.locator('.yyc-results-count');
  await expect(count).toHaveText('3 materials');
  await expect(page.locator('.yyc-filter-tag')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Industry', exact: true }).selectOption({ label: 'Services' });
  await expect(count).toHaveText('Showing 1 of 3 materials');
  await expect(page.getByRole('button', { name: 'Remove filter: Industry: Services' })).toBeVisible();
  await page.getByPlaceholder('Search materials…').fill('zzzz-nothing');
  await expect(count).toHaveText('Showing 0 of 3 materials');
  await expect(page.getByText('No matching materials.')).toBeVisible();
  await page.getByRole('button', { name: /Remove filter: Search/ }).click();
  await expect(count).toHaveText('Showing 1 of 3 materials');
  // a lever filter counts strategies in materials
  await page.getByRole('combobox', { name: 'Industry', exact: true }).selectOption('all');
  await page.locator('.yyc-chip-row').filter({ hasText: 'Filter by lever' }).getByRole('button', { name: /^Price/ }).click();
  await expect(count).toHaveText('1 strategy in 1 material');
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('az');
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(count).toHaveText('3 materials');
  await expect(page.locator('.yyc-filter-tag')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveValue('az'); // clearing filters keeps the sort
});

test('UX-02 the Search button is always visible (desktop: in the left panel with its shortcut) and opens the jump-anywhere search', async ({ page }) => {
  await start(page);
  const btn = page.getByRole('button', { name: 'Search the library' }).locator('visible=true').first();
  await expect(btn).toBeVisible();
  await expect(btn).toContainText(/Ctrl K|⌘K/);
  await btn.click();
  const box = page.getByPlaceholder(/Jump to a material/);
  await expect(box).toBeVisible();
  await box.fill('Acme');
  await page.keyboard.press('Enter');
  await expect(page.locator('.yyc-modal-sheet')).toBeVisible({ timeout: 15_000 }); // chose the material: its window opened
  await expect.poll(() => hash(page)).toContain('doc=d1');
});

test('UX-02 on a phone the Search button is in the top bar, easy to tap, and the search fits the screen', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await start(page);
  const btn = page.getByRole('button', { name: 'Search the library' }).locator('visible=true').first();
  const b = await btn.boundingBox();
  expect(b.width).toBeGreaterThanOrEqual(44); expect(b.height).toBeGreaterThanOrEqual(44); expect(b.x + b.width).toBeLessThanOrEqual(375);
  await btn.click();
  const box = page.getByPlaceholder(/Jump to a material/);
  await expect(box).toBeVisible();
  const r = await box.boundingBox();
  expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);
  await ctx.close();
});

test('UX-03 pressing Escape on a document and clicking a tab in the same instant lands on that tab (going back and the click cannot cross)', async ({ page }) => {
  await start(page);
  await page.getByText('Acme Bakery').first().click();
  await expect(page.locator('.yyc-modal-sheet')).toBeVisible();
  await page.evaluate(() => { // both in the same moment, before the browser has finished going back
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    [...document.querySelectorAll('.yyc-nav-item')].find((b) => /Lever Explorer/.test(b.textContent)).click();
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Lever Explorer' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.yyc-modal-sheet')).toHaveCount(0);
  await expect.poll(() => hash(page)).toBe('#/explorer');
  await page.goBack(); // Back from the Explorer returns to the library, not to the document
  await expect(kbHeading(page)).toBeVisible();
  await expect(page.locator('.yyc-modal-sheet')).toHaveCount(0);
});

/* The "Opening the document" window must never trap the person, even if the code of the document window never arrives (a stalled connection). */
const stallWindowCode = (page) => page.route('**/assets/PreviewModal-*.js', () => { /* never answered: the request just hangs */ });

test('UX-03 if the document window never finishes loading, Escape closes the loading window and the app stays usable', async ({ page }) => {
  await stallWindowCode(page);
  await start(page);
  await page.getByText('Acme Bakery').first().click();
  const loading = page.getByRole('status', { name: 'Opening the document' });
  await expect(loading).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(loading).toHaveCount(0);
  await expect.poll(() => hash(page)).toBe('');
  await tabBtn(page, 'Lever Explorer').click(); // nothing is covering the page
  await expect(page.getByRole('heading', { level: 1, name: 'Lever Explorer' })).toBeVisible({ timeout: 10_000 });
});

test('UX-03 the loading window can also be closed with its Close button or by clicking outside it', async ({ page }) => {
  await stallWindowCode(page);
  await start(page);
  await page.getByText('Acme Bakery').first().click();
  await page.getByRole('button', { name: 'Cancel opening the document' }).click();
  await expect(page.getByRole('status', { name: 'Opening the document' })).toHaveCount(0);
  await page.getByText('Acme Bakery').first().click();
  await expect(page.getByRole('status', { name: 'Opening the document' })).toBeVisible();
  await page.mouse.click(5, 5); // outside the window (on the dimmed page)
  await expect(page.getByRole('status', { name: 'Opening the document' })).toHaveCount(0);
});

test('UX-03 after 8 seconds the loading window says it is slow and offers Reload and Close', async ({ page }) => {
  test.setTimeout(60_000);
  await stallWindowCode(page);
  await start(page);
  await page.getByText('Acme Bakery').first().click();
  await expect(page.getByRole('status', { name: 'Opening the document' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'This is taking longer than usual.' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Reload the page' })).toBeVisible();
  await page.getByRole('alert').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('status', { name: 'Opening the document' })).toHaveCount(0);
});
