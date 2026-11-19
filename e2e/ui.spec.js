// The redesign checked in a real browser: every screen size (UI-04), accessibility in the light and dark themes (UI-02, UI-05),
// the page titles (UI-03) and keyboard use. Requirement ids are in the test names (docs/REQUIREMENTS.md).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seed, unlockAdmin, showSignIn, watch, SIZES } from './helpers.js';

const tabBtn = (page, label) => page.locator('.yyc-nav-item:visible, .yyc-botnav-item:visible').filter({ hasText: label }).first();

/* The screens a person actually visits. Each returns when the screen is ready. */
const SCREENS = {
  'knowledge base': async (page) => { await seed(page); await page.goto('/'); await page.getByText('Acme Bakery').first().waitFor(); },
  'document': async (page) => { await seed(page); await page.goto('/'); await page.getByText('Acme Bakery').first().click(); await page.locator('.yyc-modal').waitFor(); },
  'lever explorer': async (page) => { await seed(page); await page.goto('/'); await tabBtn(page, 'Lever Explorer').click(); await page.getByRole('heading', { level: 1, name: 'Lever Explorer' }).waitFor(); },
  'ask the brain': async (page) => { await seed(page); await page.goto('/'); await tabBtn(page, 'Ask the Brain').click(); await page.getByRole('heading', { level: 1, name: 'Ask the Brain' }).waitFor(); },
  'add material': async (page) => { await seed(page); await page.goto('/'); await unlockAdmin(page); await page.getByRole('button', { name: 'Add material' }).first().click(); await page.getByRole('heading', { level: 1, name: 'Add material' }).waitFor(); },
  'gap log': async (page) => { await seed(page); await page.goto('/'); await unlockAdmin(page); await tabBtn(page, 'Gap Log').click(); await page.getByRole('heading', { level: 1, name: 'Gap Log' }).waitFor(); },
  'empty library': async (page) => { await seed(page, { empty: true }); await page.goto('/'); await page.getByRole('heading', { level: 1, name: 'Knowledge Base' }).waitFor(); },
  'sign in': async (page) => { await showSignIn(page); await page.goto('/'); await page.getByRole('heading', { level: 1, name: 'Sign in' }).waitFor(); },
  'request access': async (page) => { await showSignIn(page); await page.goto('/'); await page.getByRole('button', { name: 'Request access' }).click(); await page.getByRole('heading', { level: 1, name: 'Request access' }).waitFor(); },
  'not found': async (page) => { await page.goto('/no-such-page'); await page.getByRole('heading', { level: 1, name: 'Page not found' }).waitFor(); },
};

/* Nothing may stick out sideways: not the page, and no visible element past the right edge of the window. */
async function sidewaysProblems(page) {
  return page.evaluate(() => {
    const out = [];
    const w = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > w + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${w})`);
    const scrollsInside = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll' || o === 'hidden') && p.scrollWidth >= p.clientWidth) return true; } return false; };
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right > w + 1 && !scrollsInside(el)) { out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} reaches ${Math.round(r.right)}px`); if (out.length > 4) break; }
    }
    return out;
  });
}

for (const size of SIZES) {
  test(`UI-04 nothing is cut off or scrolls sideways at ${size.name}`, async ({ browser }) => {
    test.setTimeout(120_000);
    for (const [name, open] of Object.entries(SCREENS)) {
      const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
      const page = await ctx.newPage();
      await open(page);
      expect(await sidewaysProblems(page), `${name} at ${size.name}`).toEqual([]);
      // the page title is on screen and not clipped by its box
      const h1 = page.getByRole('heading', { level: 1 }).first();
      if (await h1.count()) {
        const clipped = await h1.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        expect(clipped, `${name} at ${size.name}: the page title is clipped`).toBe(false);
      }
      await ctx.close();
    }
  });
}

for (const scheme of ['light', 'dark']) {
  test(`UI-02 UI-05 automated accessibility scan, ${scheme} theme`, async ({ browser }) => {
    test.setTimeout(180_000);
    const found = [];
    for (const [name, open] of Object.entries(SCREENS)) {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await open(page);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      for (const v of result.violations) found.push(`${name}: ${v.id} (${v.impact}) x${v.nodes.length} e.g. ${v.nodes[0].target.join(' ')} :: ${(v.nodes[0].failureSummary || '').split('\n').slice(1, 2).join('').trim().slice(0, 150)}`);
      await ctx.close();
    }
    expect(found).toEqual([]);
  });
}

test('UI-03 every screen has one clear page title', async ({ browser }) => {
  test.setTimeout(120_000);
  for (const [name, open] of Object.entries(SCREENS)) {
    if (name === 'document') continue; // a pop-up over the knowledge base: its title is the document's name
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await open(page);
    const titles = page.getByRole('heading', { level: 1 }).filter({ visible: true });
    expect(await titles.count(), `${name}: exactly one page title`).toBe(1);
    const size = await titles.first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size, `${name}: the title is clearly the biggest text`).toBeGreaterThanOrEqual(22);
    await ctx.close();
  }
});

test('UI-04 on a phone the main controls are big enough to tap', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 720 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await seed(page);
  await page.goto('/');
  await page.getByText('Acme Bakery').first().waitFor();
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.yyc-botnav-item, .yyc-lever-chip, .yyc-btn-primary, .yyc-btn-secondary, .yyc-admin-btn, .yyc-input, .yyc-filter-select, .yyc-icon-btn')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.className.split(' ')[0]} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}" is ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  expect(small).toEqual([]);
  await ctx.close();
});

test('UI-05 the keyboard reaches the content: skip link first, then visible focus', async ({ page }) => {
  const problems = watch(page);
  await seed(page);
  await page.goto('/');
  await page.getByText('Acme Bakery').first().waitFor();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to the content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; });
  expect(ring.style).not.toBe('none');
  expect(ring.width).toBeGreaterThanOrEqual(2);
  expect(problems).toEqual([]);
});

test('UI-04 a newly opened tab starts at its top', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 600 } });
  const page = await ctx.newPage();
  await seed(page);
  await page.goto('/');
  await page.getByText('Acme Bakery').first().waitFor();
  await page.evaluate(() => window.scrollTo(0, 900));
  await tabBtn(page, 'Lever Explorer').click();
  await page.getByRole('heading', { level: 1, name: 'Lever Explorer' }).waitFor();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(5);
  await ctx.close();
});
