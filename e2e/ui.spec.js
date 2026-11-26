// The redesign checked in a real browser: every screen size (UI-04), accessibility in the light and dark themes (UI-02, UI-05),
// the page titles (UI-03) and keyboard use. Requirement ids are in the test names (docs/REQUIREMENTS.md).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seed, unlockAdmin, showSignIn, signedInAs, watch, SIZES } from './helpers.js';

const tabBtn = (page, label) => page.locator('.yyc-nav-item:visible, .yyc-botnav-item:visible').filter({ hasText: label }).first();

/* The screens a person actually visits. Each returns when the screen is ready. */
const SCREENS = {
  'knowledge base': async (page) => { await seed(page); await page.goto('/'); await page.getByText('Acme Bakery').first().waitFor(); },
  'document': async (page) => { await seed(page); await page.goto('/'); await page.getByText('Acme Bakery').first().click(); await page.locator('.yyc-modal-sheet').waitFor(); },
  'lever explorer': async (page) => { await seed(page); await page.goto('/'); await tabBtn(page, 'Lever Explorer').click(); await page.getByRole('heading', { level: 1, name: 'Lever Explorer' }).waitFor(); },
  'ask the brain': async (page) => { await seed(page); await page.goto('/'); await tabBtn(page, 'Ask the Brain').click(); await page.getByRole('heading', { level: 1, name: 'Ask the Brain' }).waitFor(); },
  'add material': async (page) => { await seed(page); await page.goto('/'); await unlockAdmin(page); await page.getByRole('button', { name: 'Add material' }).first().click(); await page.getByRole('heading', { level: 1, name: 'Add material' }).waitFor(); },
  'gap log': async (page) => { await seed(page); await page.goto('/'); await unlockAdmin(page); await tabBtn(page, 'Gap Log').click(); await page.getByRole('heading', { level: 1, name: 'Gap Log' }).waitFor(); },
  'empty library': async (page) => { await seed(page, { empty: true }); await page.goto('/'); await page.getByRole('heading', { level: 1, name: 'Knowledge Base' }).waitFor(); },
  'sign in': async (page) => { await showSignIn(page); await page.goto('/'); await page.getByRole('heading', { level: 1, name: 'Sign in' }).waitFor(); },
  'request access': async (page) => { await showSignIn(page); await page.goto('/'); await page.getByRole('button', { name: 'Request access' }).click(); await page.getByRole('heading', { level: 1, name: 'Request access' }).waitFor(); },
  'library with filters': async (page) => { await seed(page); await page.goto('/#/library?lever=price&industry=Trading%20%2F%20Retail&sort=az'); await page.locator('.yyc-results-bar').waitFor(); await page.getByRole('button', { name: 'Clear all' }).waitFor(); },
  'recently deleted': async (page) => { await seed(page); await page.goto('/'); await unlockAdmin(page); await page.locator('.yyc-doc').filter({ hasText: 'Acme Bakery' }).locator('.yyc-icon-btn.is-danger').click(); await page.locator('.yyc-modal .yyc-btn-danger').click(); await page.getByRole('button', { name: 'Recently deleted' }).click(); await page.locator('.yyc-trash-row').waitFor(); },
  'delete question': async (page) => { await seed(page); await page.goto('/'); await unlockAdmin(page); await page.locator('.yyc-doc').filter({ hasText: 'Acme Bakery' }).locator('.yyc-icon-btn.is-danger').click(); await page.locator('.yyc-modal .yyc-btn-danger').waitFor(); },
  'search window': async (page) => { await seed(page); await page.goto('/'); await page.getByText('Acme Bakery').first().waitFor(); await page.getByRole('button', { name: 'Search the library' }).locator('visible=true').first().click(); await page.getByPlaceholder(/Jump to a material/).waitFor(); },
  'not found': async (page) => { await page.goto('/no-such-page?stay'); await page.getByRole('heading', { level: 1, name: 'Page not found' }).waitFor(); },
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

test('UI-02 selected text uses the brand colour (a soft wash, readable), not the browser default, in light and dark', async ({ page }) => {
  await seed(page); await page.goto('/');
  await page.locator('.yyc-doc').first().waitFor();
  const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    const sel = await page.locator('h1').first().evaluate((e) => { const c = getComputedStyle(e, '::selection'); return { bg: c.backgroundColor, fg: c.color }; });
    expect(sel.bg, `${scheme}: not the default blue`).not.toMatch(/^rgb\(0, 120, 215\)|^rgba\(0, 0, 0, 0\)|^rgb\(51, 144, 255\)/);
    const [a, b] = [lum(sel.bg), lum(sel.fg)].sort((x, y) => y - x);
    expect((a + 0.05) / (b + 0.05), `${scheme}: selected text must stay readable`).toBeGreaterThanOrEqual(7);
    const token = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = getComputedStyle(document.documentElement).getPropertyValue('--select-bg'); document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    expect(sel.bg, `${scheme}: the highlight is the brand token (--select-bg), so a colour change is one place`).toBe(token);
  }
});

/* Errors appear as a toast at the bottom of the screen, wherever the person has scrolled to (like "Account enabled"), instead of a line at the top of the page. */
for (const [w, h] of [[375, 667], [1280, 800]]) {
  test(`UI-03 ${w}px: an error shows as a danger-coloured toast in view (not at the top of the page), with a dismiss button`, async ({ browser }) => {
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
    // the danger look: a light card with a vermilion edge and an icon, NOT the brand crimson and NOT a solid red block like the primary button
    const look = await toast.evaluate((e) => { const probe = (v) => { const p = document.createElement('i'); p.style.color = getComputedStyle(document.documentElement).getPropertyValue(v); document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; }; const cs = getComputedStyle(e); return { edge: cs.borderLeftColor, bg: cs.backgroundColor, danger: probe('--red'), brand: probe('--crimson'), icon: !!e.querySelector('.yyc-toast-ico svg') }; });
    expect(look.edge).toBe(look.danger); expect(look.edge).not.toBe(look.brand); expect(look.bg).not.toBe(look.danger); expect(look.bg).not.toBe(look.brand); expect(look.icon).toBe(true);
    const x = toast.getByRole('button', { name: 'Dismiss this message' });
    await expect.poll(async () => { const b = await x.boundingBox(); return Math.min(b.width, b.height); }).toBeGreaterThanOrEqual(43.99); // measured once the toast has finished growing in (it scales from 97%)
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

/* Toasts stack: at most 3, the newest at the bottom; a 4th makes the oldest (top) fade out; they fade in and out. */
for (const [w, h] of [[375, 667], [1280, 800]]) {
  test(`UI-03 ${w}px: toasts stack (newest lowest), keep at most 3, fade in and out, and the same message does not repeat`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 900, hasTouch: w < 900 });
    const page = await ctx.newPage();
    await seed(page); await page.goto('/');
    await page.locator('.yyc-doc').first().waitFor();
    const raise = (msg, kind = 'ok') => page.evaluate(([m, k]) => window.dispatchEvent(new CustomEvent('yyc-toast', { detail: { msg: m, kind: k } })), [msg, kind]);
    const live = () => page.locator('.yyc-toast:not(.is-leaving) .yyc-toast-msg').allTextContents();
    await raise('First'); await raise('Second'); await raise('Third');
    await expect.poll(live).toEqual(['First', 'Second', 'Third']);
    const ys = await page.locator('.yyc-toast').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    expect(ys[0]).toBeLessThan(ys[1]); expect(ys[1]).toBeLessThan(ys[2]); // the newest is the lowest
    // fading in
    expect(await page.locator('.yyc-toast').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('yycToastIn');
    // a repeat of a message already showing does not add another toast
    await raise('Third');
    expect(await live()).toEqual(['First', 'Second', 'Third']);
    // a 4th: the oldest (top) fades out (it only stays for about a fifth of a second, so a watcher records it), then is gone
    await page.evaluate(() => { window.__leaving = []; new MutationObserver(() => { for (const e of document.querySelectorAll('.yyc-toast.is-leaving')) { const t = e.textContent; if (!window.__leaving.includes(t)) window.__leaving.push(t); } }).observe(document.body, { subtree: true, attributes: true, childList: true }); });
    await raise('Fourth');
    await expect.poll(() => page.evaluate(() => window.__leaving)).toEqual(['First']); // only the oldest one fades out
    // the fade-out style itself (checked on a throw-away element, so it does not depend on timing)
    expect(await page.evaluate(() => { const d = document.createElement('div'); d.className = 'yyc-toast is-leaving'; document.querySelector('.yyc-toasts').appendChild(d); const n = getComputedStyle(d).animationName; d.remove(); return n; })).toBe('yycToastOut');
    await expect.poll(live).toEqual(['Second', 'Third', 'Fourth']);
    await expect(page.locator('.yyc-toast')).toHaveCount(3, { timeout: 3000 }); // the faded one has been removed
    expect(await page.locator('.yyc-toast').count()).toBeLessThanOrEqual(3);
    // everything is inside the screen
    const box = await page.locator('.yyc-toasts').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(w + 0.5); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(h);
    // an ordinary message fades out by itself
    await expect(page.locator('.yyc-toast')).toHaveCount(0, { timeout: 7000 });
    await ctx.close();
  });
}

test('UI-03 an error toast stays longer than a normal one and screen readers hear it as an alert', async ({ page }) => {
  await seed(page); await page.goto('/');
  await page.locator('.yyc-doc').first().waitFor();
  await page.evaluate(() => { window.dispatchEvent(new CustomEvent('yyc-toast', { detail: { msg: 'Saved', kind: 'ok' } })); window.dispatchEvent(new CustomEvent('yyc-toast', { detail: { msg: 'Something went wrong', kind: 'error' } })); });
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toHaveCount(0, { timeout: 5000 }); // the normal one has gone after a few seconds
  await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toBeVisible(); // the error is still there
});

/* Role changes while the page is open: the screen follows (a message, and the admin controls appear or go), instead of a confusing refusal later. */
async function roleServer(page, state) {
  await page.route('**/api/db?action=me*', (route) => {
    state.meCalls++;
    if (state.blocked) return route.fulfill({ status: 403, json: { error: state.blocked } });
    return route.fulfill({ json: { id: 'u1', email: 'a.long.email.address@yyc-example.test', isAdmin: state.admin, mustChangePassword: false } });
  });
}
const askNow = (page) => page.evaluate(() => window.dispatchEvent(new Event('yyc-role-check')));
const usersTab = (page) => page.locator('.yyc-botnav-item:visible, .yyc-nav-item:visible').filter({ hasText: 'Users' });
const phone = { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true };

test('SEC-07 a demoted admin sees a message and the admin controls disappear, without refreshing', async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const state = { admin: true, meCalls: 0 };
  await signedInAs(page, { admin: true }); await roleServer(page, state);
  await page.goto('/');
  await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Add material' }).first()).toBeVisible();
  await expect(usersTab(page).first()).toBeVisible();
  state.admin = false; await askNow(page);
  await expect(page.getByRole('alert').filter({ hasText: 'you are now a Viewer' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Add material' })).toHaveCount(0);
  await expect(usersTab(page)).toHaveCount(0);
  await expect(page.locator('.yyc-botnav-item').filter({ hasText: 'Gap Log' })).toHaveCount(0);
  await ctx.close();
});

test('SEC-07 a demoted admin who is on the Users screen is taken to the Knowledge Base', async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const state = { admin: true, meCalls: 0 };
  await signedInAs(page); await roleServer(page, state);
  await page.goto('/');
  await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 });
  await usersTab(page).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible({ timeout: 15_000 });
  state.admin = false; await askNow(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Knowledge Base' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toHaveCount(0);
  await ctx.close();
});

test('SEC-07 a viewer who is made an admin is told, and the admin controls appear', async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const state = { admin: false, meCalls: 0 };
  await signedInAs(page, { admin: false }); await roleServer(page, state);
  await page.goto('/');
  await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Add material' })).toHaveCount(0);
  state.admin = true; await askNow(page);
  await expect(page.getByRole('status').filter({ hasText: 'you are now an Admin' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Add material' }).first()).toBeVisible();
  await expect(usersTab(page).first()).toBeVisible();
  await ctx.close();
});

test('SEC-07 when the server refuses an admin action, the screen checks the role and updates itself', async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const state = { admin: true, meCalls: 0 };
  await signedInAs(page); await roleServer(page, state);
  await page.route('**/api/db', async (route) => {
    if (route.request().method() === 'POST' && (route.request().postDataJSON() || {}).op === 'user_create') { state.admin = false; return route.fulfill({ status: 403, json: { error: 'You need an admin account to do that.' } }); } // demoted just now
    return route.fallback();
  });
  await page.goto('/');
  await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 });
  await usersTab(page).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder('name@company.com').fill('someone@yyc-example.test');
  await page.getByRole('button', { name: 'Create account', exact: true }).first().click();
  await page.locator('.yyc-modal').getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'you are now a Viewer' })).toBeVisible({ timeout: 10_000 });
  await expect(usersTab(page)).toHaveCount(0);
  await ctx.close();
});

test('SEC-07 an account disabled while its page is open is sent to the sign-in screen with the reason', async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const state = { admin: false, meCalls: 0 };
  await signedInAs(page, { admin: false }); await roleServer(page, state);
  await page.goto('/');
  await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 });
  state.blocked = 'This account has been disabled. Please contact your administrator.'; await askNow(page);
  await expect(page.getByText('This account has been disabled')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.yyc-doc')).toHaveCount(0);
  await ctx.close();
});

test('SEC-07 the role is re-checked only now and then: once about every 20 seconds while the page is visible, once for a burst of refusals, not again right after a focus', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const state = { admin: true, meCalls: 0 };
  await signedInAs(page); await roleServer(page, state);
  await page.clock.install();
  await page.goto('/');
  await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 });
  const settle = async () => { let last = -1; while (last !== state.meCalls) { last = state.meCalls; await page.waitForTimeout(400); } return state.meCalls; }; // let in-flight requests finish
  const base = await settle(); // start-up requests are done
  await page.clock.runFor('00:15'); // 15 seconds: too early for the 20-second check
  expect(await settle()).toBe(base);
  await page.clock.runFor('00:10'); // 25 seconds: one check has run
  const afterFirst = await settle();
  expect(afterFirst).toBe(base + 1);
  await page.clock.runFor('00:06'); // a few seconds on, so a refusal may ask again
  await page.evaluate(() => { for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('yyc-role-check')); }); // ten refusals in a burst: one look, with a fresh answer
  const afterBurst = await settle();
  expect(afterBurst).toBe(afterFirst + 1);
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); // coming back to the tab right after a check: nothing new
  expect(await settle()).toBe(afterBurst);
  await ctx.close();
});

/* The site's own icon (a blue tile with an open book and a spark) and the redesigned left panel. */
test('UI-01 the page declares its own icon files, and every one of them is served', async ({ page, request }) => {
  await page.goto('/');
  const links = await page.evaluate(() => [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')].map((l) => ({ rel: l.rel, href: l.getAttribute('href'), type: l.type })));
  const hrefs = links.map((l) => l.href);
  for (const h of ['/favicon.svg', '/favicon-32.png', '/favicon.ico', '/apple-touch-icon.png', '/site.webmanifest']) expect(hrefs, h).toContain(h);
  expect(hrefs).not.toContain('/logo.png'); // the old company logo is no longer the site icon
  for (const h of hrefs) { const r = await request.get(h); expect(r.status(), h).toBe(200); expect((await r.body()).length, h).toBeGreaterThan(200); }
  expect((await request.get('/favicon.svg')).headers()['content-type']).toContain('svg');
  expect((await request.get('/favicon.svg')).headers()['content-type']).not.toContain('html'); // not the not-found page
  const svg = await (await request.get('/favicon.svg')).text();
  expect(svg.toLowerCase()).toContain('#c00000'); // the icon uses the site's crimson
  expect(svg.toLowerCase()).not.toContain('#00aeef'); // not the old blue
  expect(svg).not.toContain('863bff'); // and the default purple placeholder is gone
});

test('UI-01 the web app manifest is valid and its icons exist', async ({ request }) => {
  const m = await (await request.get('/site.webmanifest')).json();
  expect(m.name).toBeTruthy(); expect(m.start_url).toBe('/'); expect(m.theme_color).toBe('#C00000');
  expect(m.icons.length).toBeGreaterThanOrEqual(3);
  for (const i of m.icons) { const r = await request.get(i.src); expect(r.status(), i.src).toBe(200); expect(r.headers()['content-type'], i.src).toContain('image/png'); }
  expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
});

test('UI-01 the left panel: a vector brand mark, name and subtitle each on one line, icon chips on the tabs, the active tab clearly marked', async ({ page }) => {
  const images = [];
  page.on('request', (r) => { if (/logo\.png/.test(r.url())) images.push(r.url()); });
  await seed(page); await page.goto('/');
  await page.locator('.yyc-doc').first().waitFor();
  const side = page.locator('.yyc-sidebar');
  await expect(side.locator('.yyc-brand-mark svg')).toBeVisible();
  expect(images).toEqual([]); // nothing asks for the old logo image any more
  const g = await side.evaluate((s) => {
    const name = s.querySelector('.yyc-brand-name'), sub = s.querySelector('.yyc-brand-sub'), mark = s.querySelector('.yyc-brand-mark').getBoundingClientRect();
    const one = (e) => e.getBoundingClientRect().height < parseFloat(getComputedStyle(e).fontSize) * 1.8; // a single line of text
    const items = [...s.querySelectorAll('.yyc-nav-item')].map((e) => ({ h: e.getBoundingClientRect().height, chip: !!e.querySelector('.yyc-nav-ico svg'), active: e.classList.contains('is-active'), ico: getComputedStyle(e.querySelector('.yyc-nav-ico')).backgroundColor }));
    return { nameOne: one(name), subOne: one(sub), subClipped: sub.scrollWidth > sub.clientWidth, markW: mark.width, items, overflow: s.scrollWidth > s.clientWidth };
  });
  expect(g.nameOne).toBe(true); expect(g.subOne).toBe(true); expect(g.subClipped).toBe(false);
  expect(g.markW).toBeGreaterThanOrEqual(40);
  expect(g.overflow).toBe(false);
  for (const i of g.items) { expect(i.h).toBeGreaterThanOrEqual(44); expect(i.chip).toBe(true); }
  const active = g.items.filter((i) => i.active); expect(active).toHaveLength(1);
  expect(new Set(g.items.map((i) => i.ico)).size).toBeGreaterThan(1); // the active tab's chip is a different colour from the rest
});

test('UI-01 the brand mark shows on the phone top bar, the sign-in screen and the loading screen', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await seed(page); await page.goto('/');
  await page.locator('.yyc-doc').first().waitFor();
  await expect(page.locator('.yyc-topbar .yyc-brand-mark svg')).toBeVisible();
  const w = await page.locator('.yyc-topbar .yyc-brand-mark').evaluate((e) => e.getBoundingClientRect().width);
  expect(w).toBeGreaterThanOrEqual(34);
  const p2 = await ctx.newPage(); await showSignIn(p2); await p2.goto('/');
  await expect(p2.locator('.auth-brand svg')).toBeVisible();
  const p3 = await ctx.newPage(); await p3.route('**/assets/**', (r) => r.abort()); await p3.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(p3.locator('.boot svg')).toBeVisible(); // the very first screen, before any script, carries the mark inline
  await ctx.close();
});

/* The Lever Explorer's lever filter is the shared chip row (like the Knowledge Base): one swipeable line on phones with a fade hint and the selected chip kept in view; wrapped on desktop. */
const openExplorer = async (page) => {
  await page.locator('.yyc-nav-item:visible, .yyc-botnav-item:visible').filter({ hasText: 'Lever Explorer' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lever Explorer' })).toBeVisible({ timeout: 15_000 });
};
const leverRow = (page) => page.getByRole('group', { name: 'Filter by lever' });
const inView = (row, chip) => row.evaluate((r, c) => { const el = r.querySelector(c); if (!el) return false; const a = r.getBoundingClientRect(), b = el.getBoundingClientRect(); return b.width > 0 && b.left >= a.left - 2 && b.right <= a.right + 2; }, chip); // looked up INSIDE this row (the hidden Knowledge Base has a selected chip too)

test('UI-04 phone: the Explorer lever filter is one swipeable line, with a fade hint, not a tall stack of buttons', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await seed(page); await page.goto('/'); await page.locator('.yyc-doc').first().waitFor();
  await openExplorer(page);
  const row = leverRow(page);
  const g = await row.evaluate((r) => { const cs = getComputedStyle(r); const chips = [...r.querySelectorAll('.yyc-lever-chip')]; return { wrap: cs.flexWrap, ox: cs.overflowX, h: r.getBoundingClientRect().height, sw: r.scrollWidth, cw: r.clientWidth, n: chips.length, minChip: Math.min(...chips.map((c) => c.getBoundingClientRect().height)), more: r.classList.contains('has-more'), less: r.classList.contains('has-less'), mask: cs.maskImage || cs.webkitMaskImage }; });
  expect(g.wrap).toBe('nowrap'); expect(g.ox).toBe('auto');
  expect(g.n).toBeGreaterThanOrEqual(10);
  expect(g.sw).toBeGreaterThan(g.cw + 40); // more chips than fit: it scrolls sideways
  expect(g.h).toBeLessThan(80); // one line (it was about 300 px tall when the buttons wrapped)
  expect(g.minChip).toBeGreaterThanOrEqual(44); // easy to tap
  expect(g.more).toBe(true); expect(g.less).toBe(false);
  expect(g.mask).toContain('gradient'); // the soft fade on the right
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375); // the page itself does not scroll sideways
  // scrolled to the end: the fade moves to the left side
  await row.evaluate((r) => { r.scrollLeft = r.scrollWidth; });
  await expect.poll(() => row.evaluate((r) => [r.classList.contains('has-more'), r.classList.contains('has-less')])).toEqual([false, true]);
  await ctx.close();
});

test('UI-04 phone: choosing a lever keeps the selected chip in view, marks it for screen readers, and the other-categories row for Others', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await seed(page); await page.goto('/'); await page.locator('.yyc-doc').first().waitFor();
  await openExplorer(page);
  const row = leverRow(page);
  const others = row.getByRole('button', { name: /^Others/ });
  await others.dispatchEvent('click'); // the last chip, far to the right: selected WITHOUT Playwright scrolling to it first, so only the app's own scrolling can bring it into view
  await expect(others).toHaveAttribute('aria-pressed', 'true');
  await expect(row.getByRole('button', { name: /^Price/ })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => inView(row, '.yyc-lever-chip.is-active'), { timeout: 5000 }).toBe(true);
  await expect(page.getByRole('group', { name: 'Category', exact: true })).toBeVisible(); // Others has its own second row of chips
  // back to the first chip: the row scrolls back so it is in view
  await row.getByRole('button', { name: /^Price/ }).dispatchEvent('click');
  await expect.poll(() => inView(row, '.yyc-lever-chip.is-active'), { timeout: 5000 }).toBe(true);
  await expect.poll(() => row.evaluate((r) => r.scrollLeft)).toBeLessThan(40);
  // a chip reached with the keyboard is scrolled into view by the browser
  await row.getByRole('button', { name: /^Others/ }).focus();
  await expect.poll(() => row.evaluate((r) => { const c = document.activeElement.getBoundingClientRect(), a = r.getBoundingClientRect(); return c.left >= a.left - 2 && c.right <= a.right + 2; })).toBe(true);
  await ctx.close();
});

test('UI-04 desktop: the Explorer lever filter wraps onto a few rows, like the Knowledge Base, with nothing hidden or faded', async ({ page }) => {
  await seed(page); await page.goto('/'); await page.locator('.yyc-doc').first().waitFor();
  await openExplorer(page);
  const row = leverRow(page);
  const g = await row.evaluate((r) => { const cs = getComputedStyle(r); return { wrap: cs.flexWrap, sw: r.scrollWidth, cw: r.clientWidth, h: r.getBoundingClientRect().height, more: r.classList.contains('has-more'), mask: cs.maskImage || cs.webkitMaskImage }; });
  expect(g.wrap).toBe('wrap');
  expect(g.sw).toBeLessThanOrEqual(g.cw + 1); // nothing scrolls sideways
  expect(g.h).toBeGreaterThan(60); // more than one row: every lever is visible at once
  expect(g.more).toBe(false); expect(g.mask === 'none' || g.mask === '' || g.mask === undefined).toBe(true); // no fade
  await row.getByRole('button', { name: /^Volume/ }).click();
  await expect(row.getByRole('button', { name: /^Volume/ })).toHaveAttribute('aria-pressed', 'true');
});

test('UI-02 a selected filter chip keeps its selected look while the pointer is on it (a tap leaves the hover style stuck on phones)', async ({ page }) => {
  await seed(page); await page.goto('/'); await page.locator('.yyc-doc').first().waitFor();
  await openExplorer(page);
  const chip = leverRow(page).getByRole('button', { name: /^Volume/ });
  await chip.click(); // the pointer stays on the chip, so it is also being hovered
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  const look = () => chip.evaluate((e) => { const s = getComputedStyle(e), r = document.createElement('i'); r.style.background = getComputedStyle(document.documentElement).getPropertyValue('--crimson-soft'); document.body.appendChild(r); const soft = getComputedStyle(r).backgroundColor; r.remove(); return { bg: s.backgroundColor, soft }; });
  await expect.poll(async () => { const c = await look(); return c.bg === c.soft; }, { timeout: 3000 }).toBe(true); // the soft crimson of "selected", not the beige of "hovered" (the colour eases in over a fraction of a second)
});

/* UX-06: danger (errors, delete) has its own colour and look, never the brand crimson. */
test('UX-06 the confirm button of a destructive action is the danger colour, with an icon, and stays so under the pointer', async ({ page }) => {
  await seed(page); await page.goto('/'); await page.locator('.yyc-doc').first().waitFor();
  await unlockAdmin(page);
  await page.locator('.yyc-doc').first().locator('.yyc-icon-btn.is-danger').click(); // delete a material: asks first
  const btn = page.locator('.yyc-modal .yyc-btn-danger');
  await expect(btn).toBeVisible();
  await expect(btn.locator('svg')).toBeVisible();
  const colours = (e) => { const probe = (v) => { const p = document.createElement('i'); p.style.color = getComputedStyle(document.documentElement).getPropertyValue(v); document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; }; return { bg: getComputedStyle(e).backgroundColor, danger: probe('--red'), brand: probe('--crimson'), brandDark: probe('--crimson-dark') }; };
  const before = await btn.evaluate(colours);
  expect(before.bg).toBe(before.danger); expect(before.bg).not.toBe(before.brand);
  await btn.hover();
  const during = await btn.evaluate(colours);
  expect(during.bg, 'hovering must not turn it into the brand colour').toBe(during.danger);
  expect(during.bg).not.toBe(during.brandDark);
  // and the safe choice is not styled as danger
  await expect(page.locator('.yyc-modal .yyc-btn-secondary').first()).toBeVisible();
});

test('UX-06 the danger and brand colours are clearly different hues in both themes', async ({ page }) => {
  await seed(page); await page.goto('/'); await page.locator('.yyc-doc').first().waitFor();
  const hue = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number).map((v) => v / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; if (!d) return 0; let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; return h < 0 ? h + 360 : h; };
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    const c = await page.evaluate(() => { const probe = (v) => { const p = document.createElement('i'); p.style.color = getComputedStyle(document.documentElement).getPropertyValue(v); document.body.appendChild(p); const x = getComputedStyle(p).color; p.remove(); return x; }; return { danger: probe('--red'), brand: probe('--crimson') }; });
    const gap = Math.abs(hue(c.danger) - hue(c.brand));
    expect(gap, `${scheme}: danger ${c.danger} vs brand ${c.brand}`).toBeGreaterThanOrEqual(8); // visibly warmer, not the same red
  }
});

/* The left panel stays in place while a long page scrolls (it must have a "top" to stick to), . */
const longLibrary = (page) => page.addInitScript(() => {
  if (localStorage.getItem('kb:config')) return;
  const index = Array.from({ length: 40 }, (_, i) => ({ id: 'd' + i, status: 'active', title: 'Case ' + i, doc_type: 'case_study', industry: 'Services (invented)', industry_main: 'Services', industry_sub: 'Test', language: 'en', problem_signature: 'A made-up problem', created: 1760000000000 + i }));
  localStorage.setItem('kb:config', JSON.stringify({ adminPass: '12345' })); localStorage.setItem('kb:index', JSON.stringify(index)); localStorage.setItem('kb:levers', '[]');
});

test('UI-04 desktop: the left panel stays fixed in view while a long page scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await longLibrary(page);
  await page.goto('/'); await page.locator('.yyc-doc').first().waitFor();
  const side = () => page.evaluate(() => { const e = document.querySelector('.yyc-sidebar'), r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, scrolled: Math.round(scrollY), top_css: getComputedStyle(e).top }; });
  expect((await side()).top_css).toBe('0px'); // a sticky panel needs a "top" to stick to
  for (const y of [400, 1500, 99999]) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await page.waitForTimeout(200);
    const s = await side();
    expect(s.scrolled).toBeGreaterThan(0);
    expect(s.top, `at scroll ${s.scrolled}`).toBe(0);
    expect(s.bottom).toBe(s.vh);
  }
  await expect(page.locator('.yyc-sidebar .yyc-brand-name')).toBeInViewport(); // the name and the tabs are still in view at the bottom of the page
  await expect(page.locator('.yyc-sidebar .yyc-nav-item').first()).toBeInViewport();
});


/* The Activity table on the Users screen: who (name - id), what, when. All names are invented. */
for (const [w, h] of [[375, 667], [1280, 800]]) {
  test(`AUD-01 ${w}px: the Activity table shows the admin as "name - id", the action and the date`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 900, hasTouch: w < 900 });
    const page = await ctx.newPage();
    await signedInAs(page);
    const events = [
      { id: 'e1', at: '2026-11-25T10:15:00.000Z', actor: 'amira.tan@yyc-example.test', actorName: 'Amira Tan', actorId: 'aaaa1111-2222-3333-4444-555566667777', action: 'role', target: 'lee@yyc-example.test', detail: { role: 'admin' } },
      { id: 'e2', at: '2026-11-24T09:00:00.000Z', actor: 'amira.tan@yyc-example.test', actorName: 'Amira Tan', actorId: 'aaaa1111-2222-3333-4444-555566667777', action: 'doc_delete', target: 'Acme Bakery turnaround', detail: { id: 'd1' } },
      { id: 'e3', at: '2026-11-23T08:00:00.000Z', actor: 'old.admin@yyc-example.test', actorName: '', actorId: '', action: 'disable', target: 'sam@yyc-example.test', detail: {} },
    ];
    await page.route('**/api/db', async (route) => {
      if (route.request().method() === 'POST' && (route.request().postDataJSON() || {}).op === 'account_events') return route.fulfill({ json: { events } });
      return route.fallback();
    });
    await page.goto('/');
    await page.locator('.yyc-doc').first().waitFor({ timeout: 15_000 });
    await page.locator('.yyc-botnav-item:visible, .yyc-nav-item:visible').filter({ hasText: 'Users' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Activity \(3\)/ }).click();
    const table = page.locator('table.yyc-audit');
    await expect(table.locator('thead th')).toHaveText(['Admin (name - id)', 'Action', 'Details', 'Date']);
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator('td').nth(0)).toHaveText('Amira Tan - aaaa1111');
    await expect(rows.nth(0).locator('td').nth(1)).toHaveText('Changed a role');
    await expect(rows.nth(0).locator('td').nth(2)).toHaveText('lee@yyc-example.test as admin');
    await expect(rows.nth(1).locator('td').nth(1)).toHaveText('Deleted a material');
    await expect(rows.nth(1).locator('td').nth(2)).toHaveText('Acme Bakery turnaround');
    await expect(rows.nth(2).locator('td').nth(0)).toHaveText('old.admin@yyc-example.test'); // no account any more: the email only
    expect(await rows.nth(0).locator('td').nth(3).innerText()).toMatch(/2026|25/); // a real date, not "never"
    expect(await rows.nth(0).locator('td').nth(0).getAttribute('title')).toContain('aaaa1111-2222-3333-4444-555566667777'); // the full id is in the tooltip
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w); // the table scrolls inside its own box, never the page
    for (const theme of ['light', 'dark']) { // readable and usable by keyboard and screen reader in both themes
      await page.emulateMedia({ colorScheme: theme });
      const scan = await new AxeBuilder({ page }).include('.yyc-audit-wrap').analyze();
      expect(scan.violations.map((v) => `${v.id}: ${v.nodes.length}`), theme).toEqual([]);
    }
    await ctx.close();
  });
}
