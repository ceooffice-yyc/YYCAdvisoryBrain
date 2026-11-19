import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanChatBody, handleGroq, ALLOWED_MODEL } from '../server/groqHandler.js';
import { cleanDocHtml } from '../server/sanitize.js';
import { hit, clientIp, _test as limits } from '../server/rateLimit.js';
import { securityHeaders, contentSecurityPolicy } from '../server/securityHeaders.js';
import { handleDb, guestAllowed } from '../server/db.js';
import { authenticate, _test as authTest } from '../server/auth.js';
import { spawnSync } from 'node:child_process';

// Requirement ids (docs/REQUIREMENTS.md) are in the test names. No network: refusals happen before any outside call, and the AI call is replaced.
const T = 1_700_000_000_000;
const DB = { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y' };
const confirmed = (id, email, meta = {}) => ({ id, email, app_metadata: meta, email_confirmed_at: '2026-01-01T00:00:00Z' });
const good = (over = {}) => ({ model: ALLOWED_MODEL, max_tokens: 1500, temperature: 0.1, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], ...over });
const as = (user) => async () => (user ? { ok: true, user } : { ok: false, status: 401, error: 'Sign in required' });
const forward = async (body) => ({ status: 200, text: JSON.stringify({ sent: body }), retryAfter: null });

test('SEC-02 the AI proxy only passes the app\'s own kind of request', () => {
  assert.equal(cleanChatBody(good()).ok, true);
  assert.equal(cleanChatBody(good({ model: 'some/other-model' })).ok, false, 'another model');
  assert.equal(cleanChatBody(good({ max_tokens: 50_000 })).ok, false, 'a huge answer');
  assert.equal(cleanChatBody(good({ max_tokens: 0 })).ok, false);
  assert.equal(cleanChatBody(good({ messages: [] })).ok, false);
  assert.equal(cleanChatBody(good({ messages: Array(5).fill({ role: 'user', content: 'x' }) })).ok, false, 'too many messages');
  assert.equal(cleanChatBody(good({ messages: [{ role: 'assistant', content: 'x' }] })).ok, false, 'a role the app never sends');
  assert.equal(cleanChatBody(good({ messages: [{ role: 'user', content: 'x'.repeat(60_001) }] })).ok, false, 'too large');
  assert.equal(cleanChatBody(good({ messages: [{ role: 'user', content: { type: 'image_url' } }] })).ok, false, 'content that is not text');
  assert.equal(cleanChatBody(null).ok, false);
  const out = cleanChatBody(good({ stream: true, tools: [{ type: 'function' }], n: 9, user: 'x', reasoning_effort: 'low', temperature: 7 })).body;
  assert.deepEqual(Object.keys(out).sort(), ['max_tokens', 'messages', 'model', 'reasoning_effort', 'response_format', 'temperature'], 'unknown options are dropped');
  assert.equal(out.temperature, 1, 'temperature is kept in range');
});

test('SEC-02 the AI proxy is for admins only, and refuses to run with no sign-in on a hosted site', async () => {
  limits.reset();
  const post = (auth, env = DB, body = good()) => handleGroq({ method: 'POST', body, headers: {} }, { env, keys: ['k'], authenticate: as(auth), forward, now: () => T });
  assert.equal((await post(null)).status, 401, 'nobody signed in');
  assert.equal((await post({ id: 'v', email: 'v@x.com', isAdmin: false })).status, 403, 'a viewer');
  const ok = await post({ id: 'a', email: 'a@x.com', isAdmin: true });
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.text).sent.model, ALLOWED_MODEL);
  assert.equal((await post({ id: 'a', email: 'a@x.com', isAdmin: true }, DB, good({ model: 'x' }))).status, 400);
  assert.equal((await post(null, { VERCEL: '1' })).status, 503, 'hosted, no sign-in configured: closed');
  assert.equal((await post(null, { NODE_ENV: 'production' })).status, 503);
  assert.equal((await post(null, {})).status, 200, 'your own PC with no sign-in: as before');
  assert.equal((await handleGroq({ method: 'DELETE', headers: {} }, { env: DB, keys: ['k'] })).status, 405);
});

test('SEC-02 how many AI keys exist is told to admins only', async () => {
  const get = (auth, env = DB) => handleGroq({ method: 'GET', headers: {} }, { env, keys: ['a', 'b', 'c'], authenticate: as(auth), now: () => T });
  assert.equal((await get(null)).body.keys, 1);
  assert.equal((await get({ id: 'v', isAdmin: false })).body.keys, 1);
  assert.equal((await get({ id: 'a', isAdmin: true })).body.keys, 3);
  assert.equal((await get(null, { VERCEL: '1' })).body.keys, 1);
});

test('SEC-05 the AI proxy limits each admin per minute', async () => {
  limits.reset();
  const env = { ...DB, GROQ_RATE_PER_MIN: '3' };
  const post = (id) => handleGroq({ method: 'POST', body: good(), headers: {} }, { env, keys: ['k'], authenticate: as({ id, isAdmin: true }), forward, now: () => T });
  for (let i = 0; i < 3; i++) assert.equal((await post('a1')).status, 200);
  const blocked = await post('a1');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['Retry-After']) >= 1);
  assert.equal((await post('a2')).status, 200, 'another admin is not affected');
});

test('SEC-03 document HTML: scripts, handlers, frames and unsafe links are removed; normal content stays', () => {
  const dirty = '<h1 onclick="steal()">Title</h1><script>alert(1)</script><p style="position:fixed">Text <b>bold</b></p>'
    + '<a href="javascript:alert(1)">bad</a><a href="https://example.com/x">good</a>'
    + '<img src="data:image/png;base64,AAAA" alt="ok"><img src="https://evil.example/track.png"><img src="data:image/svg+xml;base64,AAAA"><img src="x" onerror="alert(1)">'
    + '<iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name="p"></form><object data="x"></object>'
    + '<table><tr><td colspan="2">cell</td></tr></table><svg onload="alert(1)"></svg><style>body{display:none}</style>';
  const out = cleanDocHtml(dirty);
  for (const bad of ['<script', 'onclick', 'onerror', 'onload', 'javascript:', '<iframe', '<form', '<input', '<object', '<svg', '<style', 'style=', 'evil.example', 'svg+xml']) assert.ok(!out.includes(bad), `still contains ${bad}`);
  for (const ok of ['<h1>Title</h1>', '<b>bold</b>', 'href="https://example.com/x"', 'rel="noopener noreferrer nofollow"', 'data:image/png;base64,AAAA', '<td colspan="2">cell</td>']) assert.ok(out.includes(ok), `lost ${ok}`);
  assert.equal(cleanDocHtml(null), '');
  assert.equal(cleanDocHtml(undefined), '');
});

test('SEC-04 every response carries the security headers', () => {
  const h = securityHeaders({ SUPABASE_URL: 'https://abc.supabase.co' });
  const csp = h['Content-Security-Policy'];
  assert.match(csp, /script-src 'self'(;|$)/, 'scripts only from this site: no inline script, no eval');
  assert.ok(!/script-src[^;]*unsafe/.test(csp));
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src 'self' https:\/\/abc\.supabase\.co/);
  assert.match(contentSecurityPolicy({ SUPABASE_URL: 'javascript:alert(1)' }), /connect-src 'self' https:\/\/\*\.supabase\.co/, 'a bad setting cannot widen the rule');
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.equal(h['Referrer-Policy'], 'no-referrer');
  assert.ok(h['Permissions-Policy'].includes('camera=()'));
});

test('SEC-05 the rate limiter: a window per name and key, with the time to wait', () => {
  limits.reset();
  assert.equal(hit('x', 'k', 2, 60_000, 1000), 0);
  assert.equal(hit('x', 'k', 2, 60_000, 2000), 0);
  assert.equal(hit('x', 'k', 2, 60_000, 3000), 58, 'blocked until the first hit is a minute old');
  assert.equal(hit('x', 'other', 2, 60_000, 3000), 0, 'another key');
  assert.equal(hit('y', 'k', 2, 60_000, 3000), 0, 'another name');
  assert.equal(hit('x', 'k', 2, 60_000, 61_001), 0, 'allowed again later');
  assert.equal(clientIp({ 'X-Forwarded-For': '203.0.113.9, 10.0.0.1' }), '203.0.113.9');
  assert.equal(clientIp({}), 'unknown');
});

test('SEC-01 guests: off unless ALLOW_GUEST is exactly "true"; when on they can only read, and are limited per address', async () => {
  for (const v of [undefined, '', 'false', 'yes', '1', 'TRUE ']) assert.equal(guestAllowed({ ALLOW_GUEST: v }), v === 'TRUE ', `ALLOW_GUEST=${v}`);
  limits.reset();
  const call = (env, op, ip = '198.51.100.1') => handleDb({ method: 'POST', headers: {}, ip, body: { op } }, { env, now: () => T });
  assert.equal((await call(DB, 'library')).status, 401, 'setting missing: closed');
  assert.equal((await call({ ...DB, ALLOW_GUEST: 'false' }, 'library')).status, 401);
  const open = { ...DB, ALLOW_GUEST: 'true', GUEST_RATE_PER_MIN: '4' };
  for (const op of ['doc_save', 'doc_delete', 'record_save', 'config_save', 'import_docs', 'users_list', 'user_create', 'chat_get', 'chat_save', 'gap_add', 'suggestions_get', 'suggestions_set', 'ask_log_list', 'set_password'])
    assert.equal((await call(open, op, `198.51.100.${op.length}`)).status, 401, `a guest cannot ${op}`);
  limits.reset();
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await call(open, 'library', '203.0.113.50')).status);
  assert.deepEqual(statuses.slice(4), [429, 429], 'the fifth and sixth read in a minute are refused');
  assert.ok(statuses.slice(0, 4).every((s) => s !== 429 && s !== 401), 'the first four are let through to the database');
  assert.notEqual((await call(open, 'library', '203.0.113.51')).status, 429, 'another address is not affected');
});

test('SEC-06 an unconfirmed email address is refused; a confirmed one is accepted', async () => {
  authTest.cache.clear();
  authTest.cache.set('unconfirmed', { at: T, user: { id: 'u', email: 'u@yycadvisors.com', app_metadata: {} } });
  authTest.cache.set('ok', { at: T, user: confirmed('o', 'o@yycadvisors.com') });
  const bad = await authenticate({ authorization: 'Bearer unconfirmed' }, DB, T);
  assert.deepEqual([bad.ok, bad.status], [false, 403]);
  assert.equal((await authenticate({ authorization: 'Bearer ok' }, DB, T)).ok, true);
});

test('SEC-06 the shared example questions can only be changed by an admin', async () => {
  limits.reset();
  authTest.cache.clear();
  authTest.cache.set('viewer', { at: T, user: confirmed('v', 'v@yycadvisors.com') });
  const out = await handleDb({ method: 'POST', headers: { authorization: 'Bearer viewer' }, body: { op: 'suggestions_set', value: { en: ['x'] } } }, { env: DB, now: () => T });
  assert.equal(out.status, 403);
});

test('SEC-05 repeated wrong tokens from one address are slowed down', async () => {
  limits.reset();
  authTest.cache.clear();
  const statuses = [];
  for (let i = 0; i < 32; i++) statuses.push((await handleGroq({ method: 'POST', body: good(), headers: { authorization: 'Bearer nope' }, ip: '192.0.2.7' }, { env: DB, keys: ['k'], authenticate: as(null), now: () => T })).status);
  assert.equal(statuses[0], 401);
  assert.equal(statuses[31], 429);
});

// The live site went down once because a library needed a newer Node than the host ran: every API function failed to start.
test('OPS-01 every API entry point still starts on a Node that cannot load the HTML cleaner (it degrades, it does not crash)', () => {
  const flag = '--no-experimental-require-module'; // makes this Node behave like one before 22.12
  if (!process.allowedNodeEnvironmentFlags.has(flag)) return; // this Node cannot simulate it
  for (const entry of ['api/db.js', 'api/ask.js', 'api/groq/chat.js', 'api/notfound.js']) {
    const run = spawnSync(process.execPath, [flag, '-e', `import('./${entry}').then(() => console.log('STARTED')).catch((e) => { console.log('CRASH ' + e.code); process.exit(1); })`], { encoding: 'utf8' });
    assert.ok(run.stdout.includes('STARTED'), `${entry} did not start: ${run.stdout} ${run.stderr.slice(0, 200)}`);
  }
  const clean = spawnSync(process.execPath, [flag, '-e', "import('./server/sanitize.js').then((m) => console.log(JSON.stringify([m.cleanerReady(), m.cleanDocHtml('<p>x</p><script>1</script>')])))"], { encoding: 'utf8' });
  assert.equal(clean.stdout.trim(), '[false,""]', 'with no cleaner nothing unchecked comes out');
});
