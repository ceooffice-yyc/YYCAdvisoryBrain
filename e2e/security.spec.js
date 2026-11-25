// Phase 1 (security) checked in a real browser. Requirement ids are in the test names (docs/REQUIREMENTS.md).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/* A small Word file made on the spot (invented text), so no company document lives in the repo. */
async function makeDocx(paragraphs) {
  const JSZip = require('jszip');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

/* Everything the browser complains about while a test runs: script errors, console errors and anything the security policy blocked. */
function watch(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  return problems;
}

test('SEC-04 every page and API answer carries the security headers', async ({ request }) => {
  for (const path of ['/', '/api/db?action=status', '/no-such-page']) {
    const res = await request.get(path);
    const h = res.headers();
    expect(h['content-security-policy'], path).toContain("script-src 'self'");
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'");
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['x-frame-options'], path).toBe('DENY');
    expect(h['referrer-policy'], path).toBe('no-referrer');
    expect(h['x-powered-by'], path).toBeUndefined();
  }
});

test('ERR-01 an unknown address is a real 404 with the not-found page; an unknown API address is a JSON 404', async ({ request, page }) => {
  const res = await request.get('/this/page/does-not-exist');
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain('Page not found');
  const api = await request.get('/api/nothing-here');
  expect(api.status()).toBe(404);
  expect(await api.json()).toEqual({ error: 'Not found' });
  const problems = watch(page);
  const nav = await page.goto('/some/old/link?stay'); // ?stay: no automatic redirect while the test looks at the page
  expect(nav.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to YYC Advisory Brain' })).toHaveAttribute('href', '/');
  expect(problems.filter((p) => !/404/.test(p))).toEqual([]);
});

test('SEC-02 the AI proxy refuses anything that is not the app\'s own kind of request', async ({ request }) => {
  const bad = [
    { model: 'some/other-model', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] },
    { model: 'openai/gpt-oss-120b', max_tokens: 999999, messages: [{ role: 'user', content: 'hi' }] },
    { model: 'openai/gpt-oss-120b', max_tokens: 100, messages: [{ role: 'assistant', content: 'hi' }] },
    { model: 'openai/gpt-oss-120b', max_tokens: 100, messages: 'hi' },
  ];
  for (const data of bad) expect((await request.post('/api/groq/chat', { data })).status()).toBe(400);
  const notJson = await request.post('/api/groq/chat', { headers: { 'content-type': 'application/json' }, data: '{not json' });
  expect(notJson.status()).toBe(400);
  expect(await notJson.json()).toEqual({ error: 'Bad request' });
});

test('SEC-04 the app starts and works under the security policy (nothing blocked, no errors)', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Unlock admin' }).first()).toBeVisible();
  await expect(page.getByText('Knowledge Base').first()).toBeVisible();
  expect(problems).toEqual([]);
});

test('SEC-04 a Word file can still be read in the browser under the security policy', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Unlock admin' }).first().click();
  await page.locator('input[type="password"]').fill('12345');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByRole('button', { name: 'Add material' }).first().click();
  const docx = await makeDocx(['Acme Bakery case study', 'Pricing', 'Charge for delivery: The bakery added a small delivery fee and kept its prices unchanged.']);
  await page.locator('input[type="file"]').setInputFiles({ name: 'Acme Bakery.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx });
  await expect(page.locator('textarea').first()).toHaveValue(/Charge for delivery: The bakery added a small delivery fee/);
  expect(problems).toEqual([]);
});

test('SEC-03 a stored document with hostile HTML cannot run script or load anything from another site', async ({ page }) => {
  const problems = watch(page);
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const html = '<h1>Hostile Doc</h1><p id="keep">Normal paragraph.</p>'
    + '<img src="x" onerror="window.__xss = 1">'
    + '<img src="https://evil.example/track.png">'
    + '<script>window.__xss = 2</script>'
    + '<a id="js" href="javascript:window.__xss=3">click me</a>'
    + '<iframe src="https://evil.example/frame"></iframe>'
    + '<svg onload="window.__xss = 4"></svg>'
    + '<p style="position:fixed;inset:0;background:red">overlay</p>';
  await page.addInitScript((h) => {
    if (localStorage.getItem('kb:index')) return;
    const doc = { id: 'd-hostile', status: 'active', title: 'Hostile Doc', doc_type: 'case_study', industry: 'Test', industry_main: 'General', industry_sub: 'Test', language: 'en', problem_signature: 'x', created: 1, sections: [{ heading: 'A', summary_en: 'B' }], full_text: 'Normal paragraph.', html: h };
    localStorage.setItem('kb:config', JSON.stringify({ adminPass: '12345' }));
    localStorage.setItem('kb:index', JSON.stringify([{ id: doc.id, status: 'active', title: doc.title, doc_type: doc.doc_type, industry: doc.industry, industry_main: 'General', industry_sub: 'Test', language: 'en', problem_signature: 'x', created: 1 }]));
    localStorage.setItem('kb:levers', JSON.stringify([]));
    localStorage.setItem('kb:doc:d-hostile', JSON.stringify(doc));
  }, html);
  await page.goto('/');
  await page.getByText('Hostile Doc').first().click();
  const view = page.locator('.yyc-docview');
  await expect(view.locator('#keep, p').first()).toContainText('Normal paragraph.');
  await page.waitForTimeout(300); // time for an onerror handler to fire, if one had survived
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await view.locator('script, iframe, svg, [onerror], [onload], [style]').count()).toBe(0);
  expect(await view.locator('img').count()).toBe(0);
  const link = view.locator('a', { hasText: 'click me' });
  expect(await link.getAttribute('href')).toBeNull();
  expect(requests.filter((u) => u.includes('evil.example'))).toEqual([]);
  // Chrome reports a blocked inline handler as soon as hostile HTML is PARSED, even inside the cleaner's inert copy that never reaches the page.
  // Those reports are the policy doing its job; anything else is a real problem.
  expect(problems.filter((p) => !/Executing inline event handler violates/.test(p))).toEqual([]);
});
