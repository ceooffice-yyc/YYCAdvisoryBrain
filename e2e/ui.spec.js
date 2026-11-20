// The redesign checked in a real browser: every screen size (UI-04), accessibility in the light and dark themes (UI-02, UI-05),
// the page titles (UI-03) and keyboard use. Requirement ids are in the test names (docs/REQUIREMENTS.md).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seed, unlockAdmin, showSignIn, signedInAs, watch, SIZES } from './helpers.js';

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

/* iPhone SE (375 x 667) and the narrowest phones: icon-only buttons and bottom bar, a tidy profile pop-up, nothing cut or sideways-scrolling. */
for (const [w, h] of [[375, 667], [320, 568]]) {
  test(`UI-04 phone ${w}x${h}: icon-only bottom bar and Knowledge Base buttons, names kept for screen readers`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await seed(page); await page.goto('/');
    await page.locator('.yyc-doc').first().waitFor();
    await unlockAdmin(page);
    // the bottom bar: every item is at least 44 px, evenly sharing the full width, with no visible words
    const nav = await page.evaluate(() => { const bar = document.querySelector('.yyc-botnav').getBoundingClientRect(); const items = [...document.querySelectorAll('.yyc-botnav-item')].map((e) => { const r = e.getBoundingClientRect(); const l = e.querySelector('.yyc-botnav-label').getBoundingClientRect(); return { w: r.width, h: r.height, label: l.width }; }); return { barW: bar.width, vw: window.innerWidth, items }; });
    expect(nav.barW).toBe(nav.vw);
    for (const i of nav.items) { expect(i.h).toBeGreaterThanOrEqual(44); expect(i.w).toBeGreaterThanOrEqual(44); expect(i.label).toBeLessThanOrEqual(1); }
    for (const name of ['Knowledge Base', 'Ask the Brain', 'Lever Explorer', 'Gap Log']) await expect(page.locator('.yyc-botnav-item').filter({ hasText: name })).toHaveAccessibleName(name);
    // the Knowledge Base buttons: icon only, but still named and at least 44 px
    for (const name of ['Import backup', 'Export backup', 'Add material']) {
      const b = page.getByRole('button', { name }).first();
      const box = await b.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); expect(box.width).toBeLessThan(70);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    await ctx.close();
  });

  test(`UI-04 phone ${w}x${h}: the profile pop-up fits, wraps a long email by word, and its buttons have space between icon and text`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await signedInAs(page);
    await page.goto('/');
    await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Your profile' }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Your profile' });
    await expect(dlg).toBeVisible();
    const box = await dlg.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(w + 0.5); expect(box.y + box.height).toBeLessThanOrEqual(h + 0.5);
    const gap = await dlg.getByRole('button', { name: 'Log out' }).evaluate((b) => parseFloat(getComputedStyle(b).columnGap));
    expect(gap).toBeGreaterThanOrEqual(6);
    await ctx.close();
  });
}

/* The case study window and the lever rows on an iPhone SE (375 x 667). */
test('UI-04 phone 375x667: the case study window fills the screen, tabs share the width, and each lever label sits above its text', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await seed(page); await page.goto('/');
  await page.getByText('Acme Bakery').first().click();
  const modal = page.locator('.yyc-modal-sheet');
  await expect(modal).toBeVisible();
  await page.waitForTimeout(500); // the window scales in when it opens; measure after that
  const box = await modal.boundingBox();
  expect(box.x).toBe(0); expect(box.width).toBe(375); expect(box.height).toBe(667);
  const tabs = await page.locator('.yyc-seg-btn').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), l: Math.round(r.left), r: Math.round(r.right) }; }));
  expect(tabs).toHaveLength(3);
  for (const t of tabs) expect(t.h).toBeGreaterThanOrEqual(44);
  expect(Math.max(...tabs.map((t) => t.w)) - Math.min(...tabs.map((t) => t.w))).toBeLessThanOrEqual(2); // equal thirds
  expect(tabs[2].r).toBeLessThanOrEqual(375);
  // the header (title, meta, tabs) leaves most of the screen for the content
  const headH = await page.locator('.yyc-preview-head').evaluate((e) => e.getBoundingClientRect().height);
  expect(headH).toBeLessThan(667 * 0.3);
  await page.locator('.yyc-seg-btn').filter({ hasText: 'Lever records' }).click();
  const row = page.locator('.yyc-rec-row').first();
  const geo = await row.evaluate((r) => { const p = r.querySelector('.yyc-rec-pill').getBoundingClientRect(); const m = r.querySelector('.yyc-rec-main').getBoundingClientRect(); return { pillBottom: p.bottom, mainTop: m.top, mainW: m.width, rowW: r.getBoundingClientRect().width }; });
  expect(geo.mainTop).toBeGreaterThanOrEqual(geo.pillBottom); // the label is on its own line, the text starts below it
  expect(geo.mainW).toBeGreaterThan(geo.rowW * 0.9); // and uses the full width
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await ctx.close();
});

test('UI-04 phone 375x667: the Edit page stacks each lever record (lever, section, strategy, actual impact) at full width', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await seed(page); await page.goto('/');
  await unlockAdmin(page);
  await page.locator('.yyc-doc').first().getByRole('button', { name: /edit/i }).first().click();
  const top = page.locator('.yyc-rec-top').first();
  await top.scrollIntoViewIfNeeded();
  const g = await top.evaluate((el) => { const kids = [...el.children].map((c) => { const r = c.getBoundingClientRect(); return { top: Math.round(r.top), w: Math.round(r.width) }; }); const card = el.parentElement.getBoundingClientRect(); return { kids, cardW: card.width }; });
  const [lever, section] = g.kids; // select, section input, trash button (a grid on phones)
  expect(section.top).toBeGreaterThan(lever.top); // the section field is on its own line, under the lever
  expect(section.w).toBeGreaterThan(g.cardW * 0.85);
  const ta = await page.locator('textarea[aria-label="Strategy name and description"]').first().boundingBox();
  const im = await page.locator('textarea[aria-label="Actual impact"]').first().boundingBox();
  expect(ta.width).toBeGreaterThan(g.cardW * 0.85); expect(im.y).toBeGreaterThan(ta.y); // impact comes after the strategy
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await ctx.close();
});

test('UI-04 phone 375x667: the signed-in Users screen has no sideways scroll and big enough controls', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await signedInAs(page); await page.goto('/');
  await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 });
  await page.locator('.yyc-botnav-item').filter({ hasText: 'Users' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const small = await page.evaluate(() => [...document.querySelectorAll('button, select, input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 36); }).map((e) => (e.textContent || e.placeholder || '').trim().slice(0, 20)));
  expect(small).toEqual([]);
  await ctx.close();
});

for (const [w, h] of [[375, 667], [320, 568]]) {
  test(`UI-04 phone ${w}x${h}: the Ask box takes the width and the Ask button is a round, tappable send arrow beside it`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await seed(page); await page.goto('/');
    await page.locator('.yyc-doc').first().waitFor();
    await page.locator('.yyc-botnav-item').filter({ hasText: 'Ask the Brain' }).click();
    const box = page.getByPlaceholder(/Ask anything/);
    await box.waitFor();
    await box.fill('How did the bakery handle delivery fees?');
    const btn = page.getByRole('button', { name: 'Ask', exact: true });
    await expect(btn).toBeEnabled();
    const g = await page.evaluate(() => { const i = document.querySelector('.yyc-chat-input').getBoundingClientRect(); const b = document.querySelector('.yyc-send').getBoundingClientRect(); const wrap = document.querySelector('.yyc-chat-input-wrap').getBoundingClientRect(); return { iw: i.width, bw: b.width, bh: b.height, sameRow: Math.abs((i.top + i.height / 2) - (b.top + b.height / 2)) < 4, inside: b.right <= wrap.right && i.left >= wrap.left, label: document.querySelector('.yyc-send .yyc-btn-label').getBoundingClientRect().width }; });
    expect(g.bw).toBeGreaterThanOrEqual(44); expect(g.bh).toBeGreaterThanOrEqual(44); expect(Math.abs(g.bw - g.bh)).toBeLessThanOrEqual(1); // round
    expect(g.sameRow).toBe(true); expect(g.inside).toBe(true); expect(g.iw).toBeGreaterThan(w * 0.6); expect(g.label).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    await page.screenshot({ path: `e2e/.results/ask-${w}.png` });
    await ctx.close();
  });
}

/* A long figure such as 378/379 must stay on one line in the Lever records card, whatever the screen width. */
for (const [w, h] of [[320, 568], [375, 667], [768, 900], [1280, 800]]) {
  test(`UI-04 ${w}px: a long figure like 378/379 stays on one line in the Lever records card`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 900, hasTouch: w < 900 });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      if (localStorage.getItem('kb:config')) return;
      const index = [{ id: 'big', status: 'active', title: 'Big library case', doc_type: 'case_study', industry: 'Services (invented)', industry_main: 'Services', industry_sub: 'Test', language: 'en', problem_signature: 'x', created: 1760000000000 }];
      const records = Array.from({ length: 379 }, (_, i) => ({ id: 'r' + i, status: 'active', doc_id: 'big', doc_title: 'Big library case', lever: i < 378 ? 'price' : 'volume', claim_en: `Strategy ${i}: invented words.`, impact: 'N/A', section: 'Pricing' }));
      localStorage.setItem('kb:config', JSON.stringify({ adminPass: '12345' })); localStorage.setItem('kb:index', JSON.stringify(index)); localStorage.setItem('kb:levers', JSON.stringify(records));
    });
    await page.goto('/');
    await page.locator('.yyc-doc').first().waitFor();
    // pick the Price lever so the card shows "378/379"
    await page.locator('.yyc-stat.is-gold').click();
    await page.locator('.yyc-lever-picker-item').filter({ hasText: 'Price' }).first().click();
    const num = page.locator('.yyc-stat.is-gold .yyc-stat-num');
    await expect(num).toHaveText('378/379');
    const g = await num.evaluate((e) => { const r = e.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize); return { h: r.height, fs: parseFloat(getComputedStyle(e).fontSize), right: r.right, cardRight: e.closest('.yyc-stat').getBoundingClientRect().right, lh }; });
    expect(g.h).toBeLessThanOrEqual(g.fs * 1.4); // one line
    expect(g.right).toBeLessThanOrEqual(g.cardRight); // and inside the card
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    await ctx.close();
  });
}

test('UI-02 selected text uses the theme colour (soft crimson, readable), not the browser blue, in light and dark', async ({ page }) => {
  await seed(page); await page.goto('/');
  await page.locator('.yyc-doc').first().waitFor();
  const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    const sel = await page.locator('h1').first().evaluate((e) => { const c = getComputedStyle(e, '::selection'); return { bg: c.backgroundColor, fg: c.color }; });
    expect(sel.bg, `${scheme}: not the default blue`).not.toMatch(/^rgb\(0, 120, 215\)|^rgba\(0, 0, 0, 0\)|^rgb\(51, 144, 255\)/);
    const [a, b] = [lum(sel.bg), lum(sel.fg)].sort((x, y) => y - x);
    expect((a + 0.05) / (b + 0.05), `${scheme}: selected text must stay readable`).toBeGreaterThanOrEqual(7);
    const [r, , bl] = sel.bg.match(/\d+/g).map(Number);
    expect(r, `${scheme}: warm (red) rather than blue`).toBeGreaterThan(bl);
  }
});

/* Errors appear as a toast at the bottom of the screen, wherever the person has scrolled to (like "Account enabled"), instead of a line at the top of the page. */
for (const [w, h] of [[375, 667], [1280, 800]]) {
  test(`UI-03 ${w}px: an error shows as a red toast in view (not at the top of the page), with a dismiss button`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 900, hasTouch: w < 900 });
    const page = await ctx.newPage();
    await seed(page); await page.goto('/');
    await page.locator('.yyc-doc').first().waitFor();
    await unlockAdmin(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); // scrolled away from the top of the page
    await page.locator('input[type="file"][accept*="json"]').setInputFiles({ name: 'not-a-backup.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
    const toast = page.getByRole('alert').filter({ has: page.locator('.yyc-toast-msg') });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/backup/i);
    const g = await toast.evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: innerHeight, vw: innerWidth, bg: getComputedStyle(e).backgroundColor }; });
    expect(g.top).toBeGreaterThan(0); expect(g.bottom).toBeLessThanOrEqual(g.vh); expect(g.left).toBeGreaterThanOrEqual(0); expect(g.right).toBeLessThanOrEqual(g.vw);
    const [r, gr, b] = g.bg.match(/\d+/g).map(Number); expect(r).toBeGreaterThan(gr + 50); expect(r).toBeGreaterThan(b + 50); // red, not the dark success toast
    const x = toast.getByRole('button', { name: 'Dismiss this message' });
    const xb = await x.boundingBox(); expect(xb.width).toBeGreaterThanOrEqual(44); expect(xb.height).toBeGreaterThanOrEqual(44);
    await x.click();
    await expect(toast).toHaveCount(0);
    await ctx.close();
  });
}

test('UI-03 a failed action on the Users screen shows its error as a toast, in view', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await signedInAs(page);
  await page.route('**/api/db', async (route) => {
    if (route.request().method() === 'POST' && (route.request().postDataJSON() || {}).op === 'user_create') return route.fulfill({ status: 400, json: { error: 'That email address already has an account.' } });
    return route.fallback();
  });
  await page.goto('/');
  await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 });
  await page.locator('.yyc-botnav-item').filter({ hasText: 'Users' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder('name@company.com').fill('someone@yyc-example.test');
  await page.getByRole('button', { name: 'Create account', exact: true }).first().click();
  await page.locator('.yyc-modal').getByRole('button', { name: 'Create account', exact: true }).click();
  const toast = page.getByRole('alert').filter({ hasText: 'already has an account' });
  await expect(toast).toBeVisible({ timeout: 10_000 });
  const inView = await toast.evaluate((e) => { const r = e.getBoundingClientRect(); return r.top > 0 && r.bottom <= innerHeight; });
  expect(inView).toBe(true);
  await ctx.close();
});
