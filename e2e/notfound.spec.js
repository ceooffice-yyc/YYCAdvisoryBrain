// ERR-02: the "Page not found" page goes back to the first page after 3 seconds, can be stopped, works without JavaScript, and never traps the Back button.
import { test, expect } from '@playwright/test';
import { watch } from './helpers.js';

test('ERR-02 an unknown address shows the countdown, then lands on the first page after about 3 seconds', async ({ page }) => {
  const problems = watch(page);
  const res = await page.goto('/old/link/that/is/gone');
  expect(res.status()).toBe(404); // still a real 404 for browsers and search engines
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page.locator('#num')).toContainText('Taking you back to the first page');
  await expect(page.getByRole('button', { name: 'Stay on this page' })).toBeVisible();
  const t0 = Date.now();
  await page.waitForURL((u) => u.pathname === '/', { timeout: 8000 });
  const took = Date.now() - t0;
  expect(took).toBeGreaterThan(1500); // not at once: the person gets to read it
  expect(took).toBeLessThan(6000);
  await expect(page.getByRole('heading', { level: 1, name: 'Knowledge Base' })).toBeVisible({ timeout: 15_000 }); // the app itself opened
  expect(problems.filter((p) => !/404/.test(p))).toEqual([]);
});

test('ERR-02 "Stay on this page" stops the redirect, and says so', async ({ page }) => {
  await page.goto('/old/link/that/is/gone');
  await page.getByRole('button', { name: 'Stay on this page' }).click();
  await expect(page.locator('#num')).toContainText('Automatic redirect cancelled');
  await expect(page.getByRole('button', { name: 'Stay on this page' })).toBeHidden();
  await page.waitForTimeout(3600); // longer than the countdown
  expect(new URL(page.url()).pathname).toBe('/old/link/that/is/gone');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to YYC Advisory Brain' })).toBeFocused(); // focus moves to the way out
});

test('ERR-02 the Escape key also stops the redirect', async ({ page }) => {
  await page.goto('/old/link/that/is/gone');
  await page.keyboard.press('Escape');
  await expect(page.locator('#num')).toContainText('Automatic redirect cancelled');
  await page.waitForTimeout(3600);
  expect(new URL(page.url()).pathname).toBe('/old/link/that/is/gone');
});

test('ERR-02 with ?stay in the address nothing redirects (used by tests, or to read the page in peace)', async ({ page }) => {
  await page.goto('/old/link/that/is/gone?stay');
  await expect(page.locator('#num')).toContainText('Automatic redirect is off');
  await page.waitForTimeout(3600);
  expect(new URL(page.url()).pathname).toBe('/old/link/that/is/gone');
  await expect(page.locator('#bar')).toBeHidden();
});

test('ERR-02 without JavaScript the browser still goes back to the first page after 3 seconds', async ({ browser, request }) => {
  // the page carries the instruction itself (checked in the source, so this does not depend on how fast the computer is)...
  const html = await (await request.get('/old/link/that/is/gone')).text();
  expect(html).toContain('<noscript><meta http-equiv="refresh" content="3;url=/" /></noscript>');
  // ...and a browser with JavaScript switched off follows it
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  const res = await page.goto('/old/link/that/is/gone');
  expect(res.status()).toBe(404);
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15_000 });
  await ctx.close();
});

test('ERR-02 the Back button is not trapped: after the redirect, Back does not return to the not-found page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('heading', { level: 1, name: 'Knowledge Base' }).waitFor({ timeout: 15_000 });
  await page.goto('/old/link/that/is/gone');
  await page.waitForURL((u) => u.pathname === '/', { timeout: 8000 });
  await page.goBack();
  expect(new URL(page.url()).pathname).not.toBe('/old/link/that/is/gone'); // it was replaced, not stacked
});

test('ERR-02 on a phone the page fits, the buttons are easy to tap, and nothing scrolls sideways', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/old/link/that/is/gone?stay');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  const link = await page.getByRole('link', { name: 'Go to YYC Advisory Brain' }).boundingBox();
  expect(link.height).toBeGreaterThanOrEqual(44); expect(link.x).toBeGreaterThanOrEqual(0); expect(link.x + link.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await ctx.close();
});
