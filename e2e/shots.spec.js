// Screenshots of every main screen, for looking at the design by eye (docs/VERIFICATION.md). Not a pass/fail test of behaviour.
// Run with:  npx playwright test e2e/shots.spec.js   (set SHOT_DIR to keep a "before" and an "after" set apart)
import { test } from '@playwright/test';
import { seed, unlockAdmin, showSignIn } from './helpers.js';

const DIR = `e2e/.results/${process.env.SHOT_DIR || 'shots'}`;
const VIEWS = [{ w: 375, h: 720 }, { w: 1440, h: 900 }];
const SCHEMES = (process.env.SHOT_SCHEMES || 'light,dark').split(',');

for (const scheme of SCHEMES) for (const v of VIEWS) {
  const tag = `${scheme}-${v.w}`;
  test(`shots ${tag}`, async ({ browser }) => {
    test.setTimeout(300_000); // a long walk through every screen: slow computers need time
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: v.w, height: v.h } });
    const page = await ctx.newPage();
    const snap = (name) => page.screenshot({ path: `${DIR}/${name}-${tag}.png`, fullPage: false });
    const nav = async (label) => { await page.locator('.yyc-nav-item:visible, .yyc-botnav-item:visible').filter({ hasText: label }).first().click(); await page.waitForTimeout(250); };

    await seed(page);
    await page.goto('/');
    await page.getByText('Acme Bakery').first().waitFor();
    await snap('01-knowledge-base');
    await page.getByText('Acme Bakery').first().click();
    await page.locator('.yyc-modal').waitFor();
    await snap('02-document');
    await page.keyboard.press('Escape');
    await nav('Lever Explorer');
    await snap('03-lever-explorer');
    await nav('Ask the Brain');
    await snap('04-ask');
    await nav('Knowledge Base');
    await unlockAdmin(page);
    await snap('05-knowledge-base-admin');
    await page.getByRole('button', { name: 'Add material' }).first().click();
    await snap('06-add-material');
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await nav('Gap Log');
    await snap('07-gap-log');
    await ctx.close();

    const ctx2 = await browser.newContext({ colorScheme: scheme, viewport: { width: v.w, height: v.h } });
    const p2 = await ctx2.newPage();
    await seed(p2, { empty: true });
    await p2.goto('/');
    await p2.getByRole('button', { name: 'Unlock admin' }).first().waitFor();
    await p2.screenshot({ path: `${DIR}/08-empty-library-${tag}.png` });
    await ctx2.close();

    const ctx3 = await browser.newContext({ colorScheme: scheme, viewport: { width: v.w, height: v.h } });
    const p3 = await ctx3.newPage();
    await showSignIn(p3);
    await p3.goto('/');
    await p3.getByRole('button', { name: 'Sign in' }).waitFor();
    await p3.screenshot({ path: `${DIR}/09-sign-in-${tag}.png` });
    await p3.getByRole('button', { name: 'Request access' }).click();
    await p3.screenshot({ path: `${DIR}/10-request-access-${tag}.png` });
    await ctx3.close();
  });
}
