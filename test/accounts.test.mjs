import test from 'node:test';
import assert from 'node:assert/strict';
import * as acct from '../server/accounts.js';
import { handleDb } from '../server/db.js';
import { authenticate, _test as authTest } from '../server/auth.js';
import { _test as rateLimits } from '../server/rateLimit.js';

// A small in-memory stand-in for the Supabase client: just enough of the table queries and the auth admin calls the account code uses.
function fakeSb({ users = [], requests = [], noHashColumn = false, insertError = null } = {}) {
  const tables = { access_requests: requests, account_events: [] };
  const sent = { invites: [], resets: [] };
  let seq = 1;
  const table = (name) => {
    const filters = []; let lim = Infinity; let mode = 'select'; let patch; let selected = '';
    const api = {
      select(cols) { selected = String(cols || ''); return api; }, order() { return api; },
      eq(k, v) { filters.push((r) => r[k] === v); return api; },
      lt(k, v) { filters.push((r) => r[k] < v); return api; },
      in(k, vals) { filters.push((r) => vals.includes(r[k])); return api; },
      not(k, op, v) { filters.push((r) => (op === 'is' && v === null ? r[k] !== null && r[k] !== undefined : true)); return api; },
      limit(n) { lim = n; return api; },
      insert(row) { mode = 'insert'; patch = row; return api; },
      update(p) { mode = 'update'; patch = p; return api; },
      then(resolve) {
        const rows = tables[name] || (tables[name] = []);
        if (noHashColumn && name === 'access_requests' && (selected.includes('password_hash') || (patch && 'password_hash' in patch))) return resolve({ data: null, error: { message: 'column access_requests.password_hash does not exist' } });
        if (mode === 'insert' && insertError && name === 'access_requests') return resolve({ data: null, error: insertError });
        if (mode === 'insert') { rows.push({ id: `r${seq++}`, status: 'pending', requested_at: new Date().toISOString(), ...patch }); return resolve({ data: null, error: null }); }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (mode === 'update') { hit.forEach((r) => Object.assign(r, patch)); return resolve({ data: hit.map((r) => ({ id: r.id })), error: null }); }
        return resolve({ data: hit.slice(0, lim), error: null });
      },
    };
    return api;
  };
  return {
    tables, sent, users,
    from: table,
    auth: {
      resetPasswordForEmail: async (email) => { sent.resets.push(email); return { error: null }; },
      admin: {
        listUsers: async ({ page }) => ({ data: { users: page === 1 ? users : [] }, error: null }),
        getUserById: async (id) => { const u = users.find((x) => x.id === id); return u ? { data: { user: u }, error: null } : { data: null, error: { message: 'not found' } }; },
        inviteUserByEmail: async (email) => { const u = { id: `u${seq++}`, email, app_metadata: {}, email_confirmed_at: null }; users.push(u); sent.invites.push(email); return { data: { user: u }, error: null }; },
        createUser: async ({ email, password, password_hash, email_confirm, app_metadata, ban_duration }) => { if (users.some((x) => x.email === email)) return { data: null, error: { message: 'A user with this email address has already been registered' } }; const u = { id: `u${seq++}`, email, _hash: password_hash, app_metadata: { ...app_metadata }, email_confirmed_at: email_confirm ? new Date().toISOString() : null, banned_until: ban_duration && ban_duration !== 'none' ? new Date(Date.now() + 1e12).toISOString() : null, _pw: password }; users.push(u); return { data: { user: u }, error: null }; },
        deleteUser: async (id) => { const i = users.findIndex((x) => x.id === id); if (i >= 0) users.splice(i, 1); return { data: {}, error: null }; },
        updateUserById: async (id, attrs) => {
          const u = users.find((x) => x.id === id);
          if (attrs.password) u._pw = attrs.password;
          if (attrs.app_metadata) u.app_metadata = { ...u.app_metadata, ...attrs.app_metadata };
          if ('ban_duration' in attrs) u.banned_until = attrs.ban_duration === 'none' ? null : new Date(Date.now() + 1e9).toISOString();
          return { data: { user: u }, error: null };
        },
      },
    },
  };
}
const person = (id, email, extra = {}) => ({ id, email, app_metadata: {}, email_confirmed_at: '2026-01-01T00:00:00Z', ...extra });
const ENV = { ALLOWED_EMAIL_DOMAINS: 'yycadvisors.com', ADMIN_EMAILS: 'boss@yycadvisors.com', EMAIL_INVITES: 'on' };
const ENV_OFF = { ALLOWED_EMAIL_DOMAINS: 'yycadvisors.com', ADMIN_EMAILS: 'boss@yycadvisors.com' }; // the default: no email, temporary passwords
const boss = person('u-boss', 'boss@yycadvisors.com');
const second = person('u-two', 'two@yycadvisors.com', { app_metadata: { role: 'admin' } });
const actor = { id: 'u-two', email: 'two@yycadvisors.com', isAdmin: true };
const code = async (p) => { try { await p; return 200; } catch (e) { return e.status; } };

test('request access: stored once, answers the same for every address, and never reveals who has an account', async () => {
  acct._test.resetLimits();
  const sb = fakeSb();
  const a = await acct.createRequest(sb, ENV, { name: ' Mei  Ling ', email: 'Mei@YYCAdvisors.com', note: 'Finance team' }, '1.1.1.1');
  const again = await acct.createRequest(sb, ENV, { name: 'Mei Ling', email: 'mei@yycadvisors.com' }, '1.1.1.2');
  assert.deepEqual([a, again], [{ ok: true }, { ok: true }]);
  const outsider = await acct.createRequest(sb, ENV, { name: 'Spam', email: 'x@example.org' }, '1.1.1.3').catch((e) => e);
  assert.deepEqual([outsider.status, outsider.message], [400, 'Please use your work email address (yycadvisors.com).'], 'an address outside the allowed domains is told so, not silently dropped');
  assert.equal(sb.tables.access_requests.length, 1, 'one pending request, and none for the outside domain');
  assert.deepEqual([sb.tables.access_requests[0].email, sb.tables.access_requests[0].name], ['mei@yycadvisors.com', 'Mei Ling']);
  assert.equal(sb.tables.account_events[0].action, 'request');
  assert.equal(await code(acct.createRequest(sb, ENV, { name: '', email: 'a@yycadvisors.com' })), 400);
  assert.equal(await code(acct.createRequest(sb, ENV, { name: 'A', email: 'not-an-email' })), 400);
});

test('request access: limited per address per hour, and in total', async () => {
  acct._test.resetLimits();
  const sb = fakeSb();
  for (let i = 0; i < 5; i++) await acct.createRequest(sb, ENV, { name: 'P', email: `p${i}@yycadvisors.com` }, '9.9.9.9', 1000 + i);
  assert.equal(await code(acct.createRequest(sb, ENV, { name: 'P', email: 'p9@yycadvisors.com' }, '9.9.9.9', 2000)), 429);
  assert.equal(await code(acct.createRequest(sb, ENV, { name: 'P', email: 'p9@yycadvisors.com' }, '8.8.8.8', 2000)), 200, 'another address is not affected');
  assert.equal(await code(acct.createRequest(sb, ENV, { name: 'P', email: 'p9@yycadvisors.com' }, '9.9.9.9', 1000 + 3_700_000)), 200, 'an hour later it is allowed again');
});

test('invite: checks the address, domain and role, refuses people who already have an account, and sets the role', async () => {
  const sb = fakeSb({ users: [boss, second] });
  assert.equal(await code(acct.inviteUser(sb, ENV, actor, { email: 'nope' })), 400);
  assert.equal(await code(acct.inviteUser(sb, ENV, actor, { email: 'a@example.org' })), 400);
  assert.equal(await code(acct.inviteUser(sb, ENV, actor, { email: 'a@yycadvisors.com', role: 'owner' })), 400);
  assert.equal(await code(acct.inviteUser(sb, ENV, actor, { email: 'BOSS@yycadvisors.com' })), 409);
  const out = await acct.inviteUser(sb, ENV, actor, { email: 'New@YYCAdvisors.com', role: 'admin' });
  assert.deepEqual(out, { email: 'new@yycadvisors.com', role: 'admin' });
  assert.deepEqual(sb.sent.invites, ['new@yycadvisors.com']);
  const list = await acct.listUsers(sb, ENV);
  const added = list.find((u) => u.email === 'new@yycadvisors.com');
  assert.deepEqual([added.role, added.accepted, added.disabled], ['admin', false, false]);
  assert.equal(sb.tables.account_events.at(-1).action, 'invite');
});

test('roles: not your own, not a server-settings admin, never the last admin', async () => {
  const sb = fakeSb({ users: [boss, second, person('u-v', 'v@yycadvisors.com')] });
  assert.equal(await code(acct.setRole(sb, ENV, actor, { id: 'u-two', role: 'viewer' })), 400, 'own role');
  assert.equal(await code(acct.setRole(sb, ENV, actor, { id: 'u-boss', role: 'viewer' })), 400, 'set in ADMIN_EMAILS');
  assert.equal(await code(acct.setRole(sb, ENV, actor, { id: 'u-v', role: 'owner' })), 400);
  assert.equal(await code(acct.setRole(sb, ENV, actor, { id: 'nobody', role: 'admin' })), 404);
  await acct.setRole(sb, ENV, actor, { id: 'u-v', role: 'admin' });
  assert.equal((await acct.listUsers(sb, ENV)).find((u) => u.id === 'u-v').role, 'admin');
  const onlyOne = fakeSb({ users: [person('u-a', 'a@yycadvisors.com', { app_metadata: { role: 'admin' } }), person('u-b', 'b@yycadvisors.com', { app_metadata: { role: 'admin' } })] });
  await acct.setRole(onlyOne, {}, { id: 'u-b', email: 'b@yycadvisors.com' }, { id: 'u-a', role: 'viewer' }); // one admin is left (the actor)
  assert.equal(await code(acct.setRole(onlyOne, {}, { id: 'u-x', email: 'x@y.com' }, { id: 'u-b', role: 'viewer' })), 400, 'the last admin stays');
});

test('disable / enable: not yourself, not the last admin, and the trail records it', async () => {
  const sb = fakeSb({ users: [boss, second, person('u-v', 'v@yycadvisors.com')] });
  assert.equal(await code(acct.setDisabled(sb, ENV, actor, { id: 'u-two', disabled: true })), 400);
  await acct.setDisabled(sb, ENV, actor, { id: 'u-v', disabled: true });
  assert.equal((await acct.listUsers(sb, ENV)).find((u) => u.id === 'u-v').disabled, true);
  await acct.setDisabled(sb, ENV, actor, { id: 'u-v', disabled: false });
  assert.equal((await acct.listUsers(sb, ENV)).find((u) => u.id === 'u-v').disabled, false);
  assert.deepEqual(sb.tables.account_events.map((e) => e.action), ['disable', 'enable']);
  const solo = fakeSb({ users: [boss, person('u-v', 'v@yycadvisors.com')] });
  assert.equal(await code(acct.setDisabled(solo, ENV, { id: 'u-v', email: 'v@yycadvisors.com' }, { id: 'u-boss', disabled: true })), 403, 'a server-settings admin cannot be disabled by someone else');
});

test('requests: approve sends the invite and closes it, reject does not email, and a request is decided once', async () => {
  acct._test.resetLimits();
  const sb = fakeSb({ users: [boss, second, person('u-has', 'has@yycadvisors.com')] });
  await acct.createRequest(sb, ENV, { name: 'Ann', email: 'ann@yycadvisors.com' }, '2.2.2.2');
  await acct.createRequest(sb, ENV, { name: 'Bob', email: 'bob@yycadvisors.com' }, '2.2.2.3');
  await acct.createRequest(sb, ENV, { name: 'Has', email: 'has@yycadvisors.com' }, '2.2.2.4');
  const [ann, bob, has] = sb.tables.access_requests;
  await acct.decideRequest(sb, ENV, actor, { id: ann.id, decision: 'approve', role: 'viewer' });
  assert.deepEqual([ann.status, ann.decided_by, sb.sent.invites], ['approved', 'two@yycadvisors.com', ['ann@yycadvisors.com']]);
  await acct.decideRequest(sb, ENV, actor, { id: bob.id, decision: 'reject' });
  assert.deepEqual([bob.status, sb.sent.invites.length], ['rejected', 1], 'rejecting sends nothing');
  await acct.decideRequest(sb, ENV, actor, { id: has.id, decision: 'approve' });
  assert.equal(has.status, 'approved', 'someone who already has an account is simply closed');
  assert.equal(await code(acct.decideRequest(sb, ENV, actor, { id: ann.id, decision: 'reject' })), 409);
  assert.equal(await code(acct.decideRequest(sb, ENV, actor, { id: 'zzz', decision: 'approve' })), 404);
  assert.equal(await code(acct.decideRequest(sb, ENV, actor, { id: ann.id, decision: 'maybe' })), 400);
});

test('password reset goes to the account holder and is recorded', async () => {
  const sb = fakeSb({ users: [boss, second] });
  await acct.sendReset(sb, ENV, actor, { id: 'u-boss' });
  assert.deepEqual([sb.sent.resets, sb.tables.account_events.at(-1).action], [['boss@yycadvisors.com'], 'reset']);
  assert.equal(await code(acct.sendReset(sb, ENV, actor, { id: 'nobody' })), 404);
});

test('a disabled account is refused at the door, even with a valid session', async () => {
  const T = 1_700_000_000_000;
  const env = { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y', ALLOWED_EMAIL_DOMAINS: 'yycadvisors.com' };
  authTest.cache.clear();
  authTest.cache.set('tok-ok', { at: T, user: { id: 'u1', email: 'ok@yycadvisors.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {} } });
  authTest.cache.set('tok-banned', { at: T, user: { id: 'u2', email: 'gone@yycadvisors.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {}, banned_until: new Date(T + 1e6).toISOString() } });
  authTest.cache.set('tok-past', { at: T, user: { id: 'u3', email: 'back@yycadvisors.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {}, banned_until: new Date(T - 1e6).toISOString() } });
  assert.equal((await authenticate({ authorization: 'Bearer tok-ok' }, env, T)).ok, true);
  const banned = await authenticate({ authorization: 'Bearer tok-banned' }, env, T);
  assert.deepEqual([banned.ok, banned.status], [false, 403]);
  assert.equal((await authenticate({ authorization: 'Bearer tok-past' }, env, T)).ok, true, 'an expired ban no longer blocks');
});

// The authorisation matrix for the database API: who may call which operation (no network needed: refusals happen before any database call).
test('database API: admin-only operations refuse no sign-in (401) and viewers (403)', async () => {
  const T = 1_700_000_000_000;
  const env = { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y', ALLOWED_EMAIL_DOMAINS: 'yycadvisors.com', ALLOW_GUEST: 'false' };
  authTest.cache.clear();
  const viewerUser = { id: 'v', email: 'viewer@yycadvisors.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {} };
  authTest.cache.set('viewer', { at: T, user: viewerUser });
  authTest.setClient({ auth: { getUser: async (tok) => (tok === 'viewer' ? { data: { user: viewerUser } } : { data: { user: null }, error: { message: 'bad token' } }) } }); // stands in for Supabase
  const adminOps = ['doc_save', 'doc_update', 'doc_delete', 'record_save', 'record_delete', 'config_save', 'import_docs', 'ask_log_list', 'gap_list', 'gap_clear',
    'trash_list', 'doc_restore', 'record_restore', 'users_list', 'user_invite', 'user_create', 'user_temp_password', 'user_set_role', 'user_set_disabled', 'user_send_reset', 'requests_list', 'request_decide', 'account_events'];
  for (const op of adminOps) {
    const none = await handleDb({ method: 'POST', headers: {}, body: { op } }, { env, now: () => T });
    assert.equal(none.status, 401, `${op} with no sign-in`);
    const viewer = await handleDb({ method: 'POST', headers: { authorization: 'Bearer viewer' }, body: { op } }, { env, now: () => T });
    assert.equal(viewer.status, 403, `${op} as a viewer`);
  }
  const guestRead = await handleDb({ method: 'POST', headers: {}, body: { op: 'library' } }, { env, now: () => T });
  assert.equal(guestRead.status, 401, 'with ALLOW_GUEST=false even the guest reads need a sign-in');
  authTest.setClient(null);
});

test('database API: "request access" needs no sign-in, but its failures never show internals', async () => {
  acct._test.resetLimits();
  const T = 1_700_000_000_000;
  const env = { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y', ALLOWED_EMAIL_DOMAINS: 'yycadvisors.com' };
  const bad = await handleDb({ method: 'POST', headers: { 'x-forwarded-for': '3.3.3.3' }, body: { op: 'access_request', name: '', email: 'q' } }, { env, now: () => T });
  assert.equal(bad.status, 400);
  const down = await handleDb({ method: 'POST', headers: { 'x-forwarded-for': '3.3.3.4' }, body: { op: 'access_request', name: 'Q', email: 'q@yycadvisors.com', password: 'a long enough passphrase' } }, { env, now: () => T });
  assert.equal(down.status, 502);
  const weak = await handleDb({ method: 'POST', headers: { 'x-forwarded-for': '3.3.3.5' }, body: { op: 'access_request', name: 'Q', email: 'q@yycadvisors.com', password: 'short' } }, { env, now: () => T });
  assert.equal(weak.status, 400, 'with emails off a password is required');
  assert.equal(down.body.error, 'The request could not be saved. Please try again later.');
});

test('no email (the default): accounts are created with a one-time temporary password the person must replace', async () => {
  const sb = fakeSb({ users: [boss, second] });
  assert.equal(await code(acct.inviteUser(sb, ENV_OFF, actor, { email: 'a@yycadvisors.com' })), 400, 'email invites are off');
  assert.equal(await code(acct.sendReset(sb, ENV_OFF, actor, { id: 'u-boss' })), 400, 'reset emails are off');
  assert.equal(await code(acct.createUser(sb, ENV_OFF, actor, { email: 'a@example.org' })), 400);
  assert.equal(await code(acct.createUser(sb, ENV_OFF, actor, { email: 'two@yycadvisors.com' })), 409);
  assert.equal(await code(acct.createUser(sb, ENV_OFF, actor, { email: 'boss@yycadvisors.com' })), 403, 'an owner address is never handed to an ordinary admin');
  const out = await acct.createUser(sb, ENV_OFF, actor, { email: 'New@YYCAdvisors.com', role: 'admin' });
  assert.match(out.password, /^[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}$/);
  const made = (await acct.listUsers(sb, ENV_OFF)).find((u) => u.email === 'new@yycadvisors.com');
  assert.deepEqual([made.role, made.mustChange, made.accepted], ['admin', true, true]);
  assert.equal(sb.tables.account_events.at(-1).action, 'create');
  assert.ok(!JSON.stringify(sb.tables.account_events).includes(out.password), 'the password is never written to the trail');
  assert.notEqual(out.password, (await acct.createUser(sb, ENV_OFF, actor, { email: 'other@yycadvisors.com' })).password, 'every password is different');
});

test('temporary password for an existing person: not your own, and not a server-settings admin unless you are one', async () => {
  const sb = fakeSb({ users: [boss, second, person('u-v', 'v@yycadvisors.com')] });
  assert.equal(await code(acct.tempPassword(sb, ENV_OFF, actor, { id: 'u-two' })), 400, 'own account');
  assert.equal(await code(acct.tempPassword(sb, ENV_OFF, actor, { id: 'u-boss' })), 403, 'another admin cannot take over the owner account');
  const out = await acct.tempPassword(sb, ENV_OFF, actor, { id: 'u-v' });
  const v = (await acct.listUsers(sb, ENV_OFF)).find((u) => u.id === 'u-v');
  assert.deepEqual([out.email, v.mustChange], ['v@yycadvisors.com', true]);
  const ownerActor = { id: 'u-boss', email: 'boss@yycadvisors.com' };
  assert.equal(await code(acct.tempPassword(sb, ENV_OFF, ownerActor, { id: 'u-two' })), 200, 'a server-settings admin can');
  assert.equal(sb.tables.account_events.at(-1).action, 'temp_password');
});

test('choosing your own password: length rules, applied by the server, lifts the temporary-password restriction', async () => {
  const u = person('u-t', 't@yycadvisors.com', { app_metadata: { must_change_password: true } });
  const sb = fakeSb({ users: [u] });
  const me = { id: 'u-t', email: 't@yycadvisors.com', mustChangePassword: true }; // signed in with the temporary password, so no "current password" is asked
  assert.equal(await code(acct.setOwnPassword(sb, me, { password: 'short' }, {}, { checkPassword: async () => false })), 400);
  assert.equal(await code(acct.setOwnPassword(sb, me, { password: 'x'.repeat(73) }, {}, { checkPassword: async () => false })), 400);
  assert.equal(await code(acct.setOwnPassword(sb, me, { password: 't@yycadvisors.com' }, {}, { checkPassword: async () => false })), 400);
  assert.equal(await code(acct.setOwnPassword(sb, me, { password: 12345678901 }, {}, { checkPassword: async () => false })), 400);
  const checkPassword = async (env, email, pw) => pw === u._pw;
  u._pw = 'the temporary one';
  assert.equal(await code(acct.setOwnPassword(sb, me, { password: 'the temporary one' }, {}, { checkPassword })), 400, 'the temporary password cannot be chosen again');
  await acct.setOwnPassword(sb, me, { password: 'a long enough passphrase' }, {}, { checkPassword });
  assert.deepEqual([u._pw, u.app_metadata.must_change_password], ['a long enough passphrase', false]);
  assert.equal(sb.tables.account_events.at(-1).action, 'password_changed');
});

test('approving a request without email creates the account and hands the temporary password to the admin', async () => {
  acct._test.resetLimits();
  const sb = fakeSb({ users: [boss, second] });
  sb.tables.access_requests.push({ id: 'old-1', email: 'ann@yycadvisors.com', name: 'Ann', status: 'pending', requested_at: new Date().toISOString() }); // a request with no password behind it
  const out = await acct.decideRequest(sb, ENV_OFF, actor, { id: sb.tables.access_requests[0].id, decision: 'approve', role: 'viewer' });
  assert.deepEqual([out.status, sb.sent.invites.length, typeof out.password], ['approved', 0, 'string']);
  assert.ok((await acct.listUsers(sb, ENV_OFF)).some((u) => u.email === 'ann@yycadvisors.com' && u.mustChange));
});

test('a temporary password only opens the "choose a new password" door', async () => {
  const T = 1_700_000_000_000;
  const env = { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y', ALLOWED_EMAIL_DOMAINS: 'yycadvisors.com' };
  authTest.cache.clear();
  authTest.cache.set('temp', { at: T, user: { id: 't', email: 't@yycadvisors.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { must_change_password: true } } });
  const strict = await authenticate({ authorization: 'Bearer temp' }, env, T);
  assert.deepEqual([strict.ok, strict.status, strict.code], [false, 403, 'must_change_password'], 'the AI proxy and Ask refuse it');
  const lenient = await authenticate({ authorization: 'Bearer temp' }, env, T, { allowMustChange: true });
  assert.deepEqual([lenient.ok, lenient.user.mustChangePassword], [true, true]);
  const read = await handleDb({ method: 'POST', headers: { authorization: 'Bearer temp' }, body: { op: 'library' } }, { env, now: () => T });
  assert.deepEqual([read.status, read.body.code], [403, 'must_change_password'], 'no library access yet');
  const chat = await handleDb({ method: 'POST', headers: { authorization: 'Bearer temp' }, body: { op: 'chat_get' } }, { env, now: () => T });
  assert.equal(chat.status, 403);
  authTest.setClient({ auth: { getUser: async () => ({ data: { user: { id: 't', email: 't@yycadvisors.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { must_change_password: true } } } }) } }); // "who am I" asks Supabase every time
  const who = await handleDb({ method: 'GET', headers: { authorization: 'Bearer temp' }, query: { action: 'me' } }, { env, now: () => T });
  authTest.setClient(null);
  assert.deepEqual([who.status, who.body.mustChangePassword], [200, true], '"who am I" works so the app knows to ask');
  const change = await handleDb({ method: 'POST', headers: { authorization: 'Bearer temp' }, body: { op: 'set_password', password: 'short' } }, { env, now: () => T });
  assert.equal(change.status, 400, 'set_password is let through and checked (a too-short password is refused)');
});

test('the public status tells the sign-in screen whether emails are used', async () => {
  const base = { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y' };
  assert.equal((await handleDb({ method: 'GET', query: { action: 'status' }, headers: {} }, { env: base })).body.emailInvites, false);
  assert.equal((await handleDb({ method: 'GET', query: { action: 'status' }, headers: {} }, { env: { ...base, EMAIL_INVITES: 'on' } })).body.emailInvites, true);
});

test('no email: the person chooses their own password when asking; NO account exists until an admin approves', async () => {
  acct._test.resetLimits();
  const sb = fakeSb({ users: [boss, second] });
  assert.equal(await code(acct.createRequest(sb, ENV_OFF, { name: 'Ann', email: 'ann@yycadvisors.com' }, '5.5.5.1')), 400, 'no password');
  assert.equal(await code(acct.createRequest(sb, ENV_OFF, { name: 'Ann', email: 'ann@yycadvisors.com', password: 'short' }, '5.5.5.2')), 400);
  assert.equal(await code(acct.createRequest(sb, ENV_OFF, { name: 'Ann', email: 'ann@yycadvisors.com', password: 'ann@yycadvisors.com' }, '5.5.5.3')), 400, 'the email as the password');
  await acct.createRequest(sb, ENV_OFF, { name: 'Ann', email: 'Ann@YYCAdvisors.com', password: 'my own long password' }, '5.5.5.4');
  assert.equal((await acct.listUsers(sb, ENV_OFF)).some((u) => u.email === 'ann@yycadvisors.com'), false, 'asking creates no account, so there is nothing to probe or squat');
  const row = sb.tables.access_requests[0];
  assert.match(row.password_hash, /^\$2[aby]\$10\$/, 'only a bcrypt hash is kept');
  assert.ok(!JSON.stringify([sb.tables.access_requests, sb.tables.account_events]).includes('my own long password'), 'the password itself is in neither the request nor the trail');
  const listed = (await acct.listRequests(sb, ENV_OFF)).requests[0];
  assert.deepEqual([listed.hasPassword, 'password_hash' in listed], [true, false], 'the admin screen is told a password exists, never the hash');

  const storedHash = row.password_hash;
  const out = await acct.decideRequest(sb, ENV_OFF, actor, { id: row.id, decision: 'approve', role: 'viewer' });
  assert.deepEqual([out.status, out.activated, out.password], ['approved', true, undefined], 'no temporary password is involved');
  const after = (await acct.listUsers(sb, ENV_OFF)).find((u) => u.email === 'ann@yycadvisors.com');
  assert.deepEqual([after.disabled, after.role, after.accepted, after.mustChange], [false, 'viewer', true, false]);
  assert.equal(sb.users.find((u) => u.email === 'ann@yycadvisors.com')._hash, storedHash, 'the account was created from the stored hash');
  assert.equal(row.password_hash, null, 'the hash is erased once it has been used');
});

test('no email: a request can never touch an existing account or replace an earlier request', async () => {
  acct._test.resetLimits();
  const victim = person('u-vic', 'victim@yycadvisors.com', { _pw: 'the real password' });
  const sb = fakeSb({ users: [boss, second, victim] });
  assert.deepEqual(await acct.createRequest(sb, ENV_OFF, { name: 'Not Them', email: 'victim@yycadvisors.com', password: 'attacker password 1' }, '6.6.6.1'), { ok: true }, 'the same answer as for anyone');
  assert.equal(victim._pw, 'the real password');
  // if an admin approved it by mistake, the existing account is still untouched and the request is simply closed
  const out = await acct.decideRequest(sb, ENV_OFF, actor, { id: sb.tables.access_requests[0].id, decision: 'approve' });
  assert.deepEqual([out.status, out.activated, victim._pw, sb.users.filter((u) => u.email === 'victim@yycadvisors.com').length], ['approved', undefined, 'the real password', 1]);
  // a second request for an address already waiting does not replace the first password
  await acct.createRequest(sb, ENV_OFF, { name: 'Ann', email: 'ann@yycadvisors.com', password: 'first long password' }, '6.6.6.2');
  const first = sb.tables.access_requests.find((r) => r.email === 'ann@yycadvisors.com').password_hash;
  await acct.createRequest(sb, ENV_OFF, { name: 'Ann', email: 'ann@yycadvisors.com', password: 'second long password' }, '6.6.6.3');
  const rows = sb.tables.access_requests.filter((r) => r.email === 'ann@yycadvisors.com');
  assert.deepEqual([rows.length, rows[0].password_hash], [1, first]);
});

test('no email: rejecting erases the stored hash, and the address can ask again', async () => {
  acct._test.resetLimits();
  const sb = fakeSb({ users: [boss, second] });
  await acct.createRequest(sb, ENV_OFF, { name: 'Bob', email: 'bob@yycadvisors.com', password: 'bob long password' }, '7.7.7.1');
  const row = sb.tables.access_requests[0];
  await acct.decideRequest(sb, ENV_OFF, actor, { id: row.id, decision: 'reject' });
  assert.deepEqual([row.status, row.password_hash], ['rejected', null]);
  assert.equal(sb.users.some((u) => u.email === 'bob@yycadvisors.com'), false);
  await acct.createRequest(sb, ENV_OFF, { name: 'Bob', email: 'bob@yycadvisors.com', password: 'bob second password' }, '7.7.7.2');
  assert.equal(sb.tables.access_requests.filter((r) => r.status === 'pending').length, 1, 'they can ask again');
});

test('with emails on, a request needs no password and stores none', async () => {
  acct._test.resetLimits();
  const sb = fakeSb({ users: [boss, second] });
  await acct.createRequest(sb, ENV, { name: 'Eve', email: 'eve@yycadvisors.com' }, '8.8.8.1');
  assert.equal(sb.tables.access_requests[0].password_hash, null);
  assert.equal(sb.users.some((u) => u.email === 'eve@yycadvisors.com'), false);
});

test('review H1 / M1: an address that is an owner in the server settings cannot be obtained through a request or by another admin', async () => {
  acct._test.resetLimits();
  const env = { ...ENV_OFF, ADMIN_EMAILS: 'boss@yycadvisors.com, second.owner@yycadvisors.com' };
  const sb = fakeSb({ users: [boss, second] });
  // an owner address reaches the admins like any request, but the password typed on the public form is NOT kept
  assert.deepEqual(await acct.createRequest(sb, env, { name: 'Second Owner', email: 'second.owner@yycadvisors.com', password: 'stranger password 1' }, '9.1.1.1'), { ok: true });
  assert.equal(sb.tables.access_requests.length, 1, 'the admins see it');
  assert.equal(sb.tables.access_requests[0].password_hash, null, 'a stranger cannot choose an owner\'s password');
  sb.tables.access_requests[0].id = 'own-1';
  assert.equal(await code(acct.decideRequest(sb, env, actor, { id: 'own-1', decision: 'approve' })), 403, 'an ordinary admin cannot');
  assert.equal(sb.tables.access_requests[0].status, 'pending', 'and the request is left as it was');
  const listed = (await acct.listRequests(sb, env)).requests[0];
  assert.deepEqual([listed.isOwner, listed.hasPassword], [true, false], 'the admin screen is told it is an owner address with no password behind it');
  // an owner approves it: the account is created with a temporary password they hand to the real person, never from the stranger's password
  const ownerActor = { id: 'u-boss', email: 'boss@yycadvisors.com' };
  const approved = await acct.decideRequest(sb, env, ownerActor, { id: 'own-1', decision: 'approve' });
  assert.deepEqual([approved.status, typeof approved.password, approved.activated], ['approved', 'string', undefined]);
  assert.equal(sb.users.find((u) => u.email === 'second.owner@yycadvisors.com')._pw, approved.password);
  sb.users.splice(sb.users.findIndex((u) => u.email === 'second.owner@yycadvisors.com'), 1);
  // an ordinary admin cannot create the owner's account and so receive its temporary password
  assert.equal(await code(acct.createUser(sb, env, actor, { email: 'second.owner@yycadvisors.com' })), 403);
  assert.equal(sb.users.some((u) => u.email === 'second.owner@yycadvisors.com'), false);
  // an owner can
  assert.equal(await code(acct.createUser(sb, env, ownerActor, { email: 'second.owner@yycadvisors.com' })), 200);
});

test('review M3: outsiders cannot use up the shared hourly budget, and stale requests are closed', async () => {
  acct._test.resetLimits();
  const sb = fakeSb({ users: [boss, second] });
  const T0 = 1_800_000_000_000;
  for (let i = 0; i < 70; i++) assert.equal(await code(acct.createRequest(sb, ENV_OFF, { name: 'Spam', email: `s${i}@example.org`, password: 'a long enough passphrase' }, `10.0.${i}.1`, T0 + i)), 400, 'wrong domain: refused before it counts');
  assert.equal(await code(acct.createRequest(sb, ENV_OFF, { name: 'Real', email: 'real@yycadvisors.com', password: 'a long enough passphrase' }, '10.9.9.9', T0 + 100)), 200, 'a real person still gets through');
  // an old undecided request is closed the next time somebody asks
  sb.tables.access_requests.push({ id: 'old', email: 'old@yycadvisors.com', name: 'Old', status: 'pending', requested_at: new Date(T0 - 40 * 86_400_000).toISOString(), password_hash: 'h' });
  await acct.createRequest(sb, ENV_OFF, { name: 'Next', email: 'next@yycadvisors.com', password: 'a long enough passphrase' }, '10.9.9.8', T0 + 200);
  const old = sb.tables.access_requests.find((r) => r.id === 'old');
  assert.deepEqual([old.status, old.decided_by, old.password_hash], ['rejected', 'expired', null]);
});

test('review L9: a request is decided once, even if two admins press at the same moment', async () => {
  acct._test.resetLimits();
  const sb = fakeSb({ users: [boss, second] });
  await acct.createRequest(sb, ENV_OFF, { name: 'Cat', email: 'cat@yycadvisors.com', password: 'cat long password' }, '11.1.1.1');
  const id = sb.tables.access_requests[0].id;
  const results = await Promise.all([
    code(acct.decideRequest(sb, ENV_OFF, actor, { id, decision: 'approve' })),
    code(acct.decideRequest(sb, ENV_OFF, { id: 'u-boss', email: 'boss@yycadvisors.com' }, { id, decision: 'reject' })),
  ]);
  assert.deepEqual([...results].sort(), [200, 409], 'one wins, the other is told it was already decided');
  const exists = sb.users.some((u) => u.email === 'cat@yycadvisors.com');
  assert.equal(exists, sb.tables.access_requests[0].status === 'approved', 'the account exists exactly when the request ended approved');
  // two approvals at once: one does the work, the other is told it was already decided
  await acct.createRequest(sb, ENV_OFF, { name: 'Dan', email: 'dan@yycadvisors.com', password: 'dan long password' }, '11.1.1.2');
  const danId = sb.tables.access_requests.find((r) => r.email === 'dan@yycadvisors.com').id;
  const both = await Promise.all([
    code(acct.decideRequest(sb, ENV_OFF, actor, { id: danId, decision: 'approve' })),
    code(acct.decideRequest(sb, ENV_OFF, { id: 'u-boss', email: 'boss@yycadvisors.com' }, { id: danId, decision: 'approve' })),
  ]);
  assert.deepEqual([...both].sort(), [200, 409]);
  assert.equal(sb.users.filter((u) => u.email === 'dan@yycadvisors.com').length, 1);
});

test('review M6: changing a password needs the current one, checked by the server', async () => {
  rateLimits.reset();
  const u = person('u-p', 'p@yycadvisors.com', { _pw: 'old password here' });
  const sb = fakeSb({ users: [u] });
  const me = { id: 'u-p', email: 'p@yycadvisors.com', mustChangePassword: false };
  const checkPassword = async (env, email, current) => current === u._pw;
  assert.equal(await code(acct.setOwnPassword(sb, me, { password: 'a brand new password' }, {}, { checkPassword })), 400, 'no current password: refused (a stolen session is not enough)');
  assert.equal(await code(acct.setOwnPassword(sb, me, { password: 'a brand new password', current: 'wrong guess' }, {}, { checkPassword })), 400);
  assert.equal(u._pw, 'old password here');
  assert.equal(await code(acct.setOwnPassword(sb, me, { password: 'old password here', current: 'old password here' }, {}, { checkPassword })), 400, 'the new one must differ');
  assert.equal(await code(acct.setOwnPassword(sb, me, { password: 'a brand new password', current: 'old password here' }, {}, { checkPassword })), 200);
  assert.equal(u._pw, 'a brand new password');
  // guessing the current password is limited
  rateLimits.reset();
  const tries = [];
  for (let i = 0; i < 10; i++) tries.push(await code(acct.setOwnPassword(sb, me, { password: 'another new password', current: `guess ${i}` }, {}, { checkPassword })));
  assert.deepEqual([tries[0], tries[9]], [400, 429]);
});

test('review L5 / L3: made-up operation names are refused cleanly, and malformed sections are dropped', async () => {
  rateLimits.reset();
  const T = 1_700_000_000_000;
  const env = { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y' };
  authTest.cache.clear();
  authTest.cache.set('adm', { at: T, user: { id: 'a', email: 'a@yycadvisors.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { role: 'admin' } } });
  for (const op of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const out = await handleDb({ method: 'POST', headers: { authorization: 'Bearer adm' }, body: { op } }, { env, now: () => T });
    assert.deepEqual([out.status, out.body.error], [400, 'Unknown operation'], op);
  }
});

test('a request always reaches the admin list, and the admin is told when the database is missing the latest schema', async () => {
  acct._test.resetLimits();
  // 1. normal project: ask, then the admin sees it
  const ok = fakeSb({ users: [boss, second] });
  await acct.createRequest(ok, ENV_OFF, { name: 'Zed', email: 'zed@yycadvisors.com', password: 'zed long password' }, '12.1.1.1');
  const seen = await acct.listRequests(ok, ENV_OFF);
  assert.deepEqual([seen.requests.length, seen.requests[0].email, seen.requests[0].status, seen.schemaMissing], [1, 'zed@yycadvisors.com', 'pending', false]);

  // 2. a project that has not run the latest schema.sql: the person is NOT told "sent", and the admin screen explains what to do
  const old = fakeSb({ users: [boss, second], noHashColumn: true });
  const err = await acct.createRequest(old, ENV_OFF, { name: 'Yan', email: 'yan@yycadvisors.com', password: 'yan long password' }, '12.1.1.2').catch((e) => e);
  assert.equal(err.status, 502, 'the form reports a failure instead of claiming success');
  old.tables.access_requests.push({ id: 'x1', email: 'older@yycadvisors.com', name: 'Older', status: 'pending', requested_at: new Date().toISOString() }); // a request made before the change
  const list = await acct.listRequests(old, ENV_OFF);
  assert.deepEqual([list.schemaMissing, list.requests.map((r) => r.email)], [true, ['older@yycadvisors.com']], 'the list still loads and says the schema is out of date');
});

test('the public form names the problem when the address is not allowed, and an owner address still reaches the admins', async () => {
  acct._test.resetLimits();
  const sb = fakeSb({ users: [boss, second] });
  const bad = await acct.createRequest(sb, ENV_OFF, { name: 'Gmail Person', email: 'someone@gmail.com', password: 'a long enough passphrase' }, '13.1.1.1').catch((e) => e);
  assert.deepEqual([bad.status, bad.message], [400, 'Please use your work email address (yycadvisors.com).']);
  assert.equal(sb.tables.access_requests.length, 0);
  assert.deepEqual(await acct.createRequest(sb, ENV_OFF, { name: 'The Owner', email: 'boss@yycadvisors.com', password: 'a long enough passphrase' }, '13.1.1.2'), { ok: true });
  assert.equal(sb.tables.access_requests.length, 1, 'a request from an owner address is not swallowed');
});

// ───── fixes from the second independent review ─────
const jwt = (iatMs) => `x.${Buffer.from(JSON.stringify({ iat: Math.floor(iatMs / 1000) })).toString('base64url')}.y`;

test('review 1: a session older than a temporary password cannot be used to choose a new password for the person', async () => {
  const T = 1_800_000_000_000;
  const env = { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y' };
  const meta = { must_change_password: true, must_change_since: T };
  authTest.cache.clear();
  const stale = jwt(T - 60_000), fresh = jwt(T + 5_000);
  const user = (id) => ({ id, email: 'p@yycadvisors.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: meta });
  authTest.cache.set(stale, { at: T + 10_000, user: user('p') });
  authTest.cache.set(fresh, { at: T + 10_000, user: user('p') });
  const old = await authenticate({ authorization: 'Bearer ' + stale }, env, T + 10_000, { allowMustChange: true });
  assert.deepEqual([old.ok, old.status], [false, 401], 'a token from before the reset is refused, even for "choose a new password"');
  const now = await authenticate({ authorization: 'Bearer ' + fresh }, env, T + 10_000, { allowMustChange: true });
  assert.deepEqual([now.ok, now.user.mustChangePassword], [true, true], 'a token from after the temporary sign-in works');
  authTest.cache.set('garbage', { at: T, user: user('p') });
  assert.equal((await authenticate({ authorization: 'Bearer garbage' }, env, T, { allowMustChange: true })).ok, false, 'an unreadable token counts as old');
  // the temporary password records when it was set
  const sb = fakeSb({ users: [boss, second, person('u-v', 'v@yycadvisors.com')] });
  await acct.tempPassword(sb, ENV_OFF, actor, { id: 'u-v' });
  assert.ok(Number(sb.users.find((u) => u.id === 'u-v').app_metadata.must_change_since) > 0);
});

test('review 3: an owner address takes as long as any other (a hash is worked out either way)', async () => {
  acct._test.resetLimits();
  const sb = fakeSb({ users: [boss, second] });
  const env = { ...ENV_OFF, ADMIN_EMAILS: 'boss@yycadvisors.com' };
  const time = async (email, ip) => { const t0 = process.hrtime.bigint(); await acct.createRequest(sb, env, { name: 'T', email, password: 'a long enough passphrase' }, ip); return Number(process.hrtime.bigint() - t0) / 1e6; };
  const normal = await time('timing1@yycadvisors.com', '14.1.1.1');
  const owner = await time('boss@yycadvisors.com', '14.1.1.2');
  assert.ok(owner > normal / 4, `owner ${owner.toFixed(1)} ms vs normal ${normal.toFixed(1)} ms: far too different`);
  assert.ok(owner > 15, 'a real hash was worked out for the owner address too');
});

test('review 2: the shared budget is checked before any hashing, and an IPv6 /64 counts as one address', async () => {
  rateLimits.reset();
  const { limitKey, clientIp } = await import('../server/rateLimit.js');
  assert.equal(limitKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), limitKey('2001:db8:1:2:1111:2222:3333:4444'), 'same /64');
  assert.notEqual(limitKey('2001:db8:1:2::1'), limitKey('2001:db8:1:3::1'));
  assert.equal(limitKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(limitKey('203.0.113.9'), '203.0.113.9');
  assert.equal(limitKey('fe80::1%eth0'), limitKey('fe80::2'));
  assert.equal(clientIp({ 'x-forwarded-for': '2001:db8:1:2:aaaa:bbbb:cccc:dddd, 10.0.0.1' }), limitKey('2001:db8:1:2::9'));
  acct._test.resetLimits();
  const sb = fakeSb({ users: [boss, second] });
  const T0 = 1_800_000_000_000;
  for (let i = 0; i < 60; i++) await acct.createRequest(sb, ENV_OFF, { name: 'N', email: `b${i}@yycadvisors.com`, password: 'a long enough passphrase' }, `15.0.${i}.1`, T0 + i);
  const t0 = process.hrtime.bigint();
  assert.equal(await code(acct.createRequest(sb, ENV_OFF, { name: 'N', email: 'late@yycadvisors.com', password: 'a long enough passphrase' }, '15.9.9.9', T0 + 100)), 429);
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 25, 'refused before the slow hashing');
});

test('review 4: waiting requests are never crowded out, the list closes old ones, and "reject all" clears a flooded list', async () => {
  acct._test.resetLimits();
  const T0 = Date.now();
  const sb = fakeSb({ users: [boss, second] });
  for (let i = 0; i < 260; i++) sb.tables.access_requests.push({ id: `h${i}`, email: `old${i}@yycadvisors.com`, name: 'Old', status: i % 2 ? 'approved' : 'rejected', requested_at: new Date(T0 - 100 * 86_400_000 + i).toISOString(), password_hash: 'leftover' });
  for (let i = 0; i < 8; i++) sb.tables.access_requests.push({ id: `w${i}`, email: `w${i}@yycadvisors.com`, name: 'W', status: 'pending', requested_at: new Date(T0 - i * 1000).toISOString(), password_hash: 'h' });
  sb.tables.access_requests.push({ id: 'stale', email: 'stale@yycadvisors.com', name: 'S', status: 'pending', requested_at: new Date(T0 - 45 * 86_400_000).toISOString(), password_hash: 'h' });
  const list = await acct.listRequests(sb, ENV_OFF);
  assert.equal(list.requests.filter((r) => r.status === 'pending').length, 8, 'all 8 fresh waiting requests are shown');
  assert.equal(list.requests.length <= 8 + 50, true, 'old decided ones are capped at 50');
  assert.equal(sb.tables.access_requests.find((r) => r.id === 'stale').status, 'rejected', 'a request nobody decided for 30 days is closed by the list itself');
  assert.equal(sb.tables.access_requests.filter((r) => r.status !== 'pending' && r.password_hash).length, 0, 'leftover hashes on decided requests are erased');
  const out = await acct.rejectAllRequests(sb, actor);
  assert.equal(out.rejected, 8);
  assert.equal(sb.tables.access_requests.filter((r) => r.status === 'pending').length, 0);
  assert.equal(sb.tables.account_events.at(-1).action, 'reject_all');
});

test('review 6: an owner address never takes a password hash that came from a public form', async () => {
  const env = { ...ENV_OFF, ADMIN_EMAILS: 'boss@yycadvisors.com, newowner@yycadvisors.com' };
  const sb = fakeSb({ users: [boss, second] });
  sb.tables.access_requests.push({ id: 'old-own', email: 'newowner@yycadvisors.com', name: 'x', status: 'pending', requested_at: new Date().toISOString(), password_hash: '$2b$10$strangerhashstrangerhashstrangerhashstrangerhashstranger' });
  const out = await acct.decideRequest(sb, env, { id: 'u-boss', email: 'boss@yycadvisors.com' }, { id: 'old-own', decision: 'approve' });
  assert.deepEqual([typeof out.password, out.activated], ['string', undefined], 'a temporary password is handed to the owner instead');
  assert.notEqual(sb.users.find((u) => u.email === 'newowner@yycadvisors.com')._hash, '$2b$10$strangerhashstrangerhashstrangerhashstrangerhashstranger');
});

test('review 7: a failed put-back or hash erase is not silent, and a request is not left half-done', async () => {
  acct._test.resetLimits();
  const sb = fakeSb({ users: [boss, second] });
  await acct.createRequest(sb, ENV_OFF, { name: 'Gus', email: 'gus@yycadvisors.com', password: 'gus long password' }, '16.1.1.1');
  const id = sb.tables.access_requests[0].id;
  const realCreate = sb.auth.admin.createUser;
  sb.auth.admin.createUser = async () => ({ data: null, error: { message: 'service unavailable' } });
  const logged = []; const orig = console.error; console.error = (...a) => logged.push(a.join(' '));
  try {
    assert.equal(await code(acct.decideRequest(sb, ENV_OFF, actor, { id, decision: 'approve' })), 502);
  } finally { console.error = orig; }
  assert.equal(sb.tables.access_requests[0].status, 'pending', 'put back so it can be tried again');
  assert.ok(sb.tables.access_requests[0].password_hash, 'and the password is still there for the retry');
  sb.auth.admin.createUser = realCreate;
  assert.equal(await code(acct.decideRequest(sb, ENV_OFF, actor, { id, decision: 'approve' })), 200, 'the retry works');
});

test('review 8: an account left over from the first design is switched on, or removed, by the decision', async () => {
  acct._test.resetLimits();
  const legacy = person('u-leg', 'legacy@yycadvisors.com', { app_metadata: { pending: true }, banned_until: new Date(Date.now() + 1e12).toISOString() });
  const gone = person('u-gone', 'gone@yycadvisors.com', { app_metadata: { pending: true }, banned_until: new Date(Date.now() + 1e12).toISOString() });
  const sb = fakeSb({ users: [boss, second, legacy, gone] });
  sb.tables.access_requests.push({ id: 'l1', email: 'legacy@yycadvisors.com', name: 'L', status: 'pending', requested_at: new Date().toISOString(), password_hash: '$2b$10$somehashsomehashsomehashsomehashsomehashsomehashsomeha' });
  sb.tables.access_requests.push({ id: 'l2', email: 'gone@yycadvisors.com', name: 'G', status: 'pending', requested_at: new Date().toISOString(), password_hash: null });
  const out = await acct.decideRequest(sb, ENV_OFF, actor, { id: 'l1', decision: 'approve', role: 'viewer' });
  assert.deepEqual([out.activated, legacy.app_metadata.pending, legacy.banned_until], [true, false, null], 'switched on');
  await acct.decideRequest(sb, ENV_OFF, actor, { id: 'l2', decision: 'reject' });
  assert.equal(sb.users.some((u) => u.email === 'gone@yycadvisors.com'), false, 'removed');
});

test('review 8: approving for someone who already has an account says so instead of claiming success', async () => {
  acct._test.resetLimits();
  const sb = fakeSb({ users: [boss, second, person('u-have', 'have@yycadvisors.com', { _pw: 'theirs' })] });
  sb.tables.access_requests.push({ id: 'e1', email: 'have@yycadvisors.com', name: 'H', status: 'pending', requested_at: new Date().toISOString(), password_hash: '$2b$10$somehashsomehashsomehashsomehashsomehashsomehashsomeha' });
  const out = await acct.decideRequest(sb, ENV_OFF, actor, { id: 'e1', decision: 'approve' });
  assert.deepEqual([out.status, out.existing, out.activated], ['approved', true, undefined]);
});

test('review 9: disable and enable need a real true or false; two requests at the same moment do not give an error', async () => {
  const sb = fakeSb({ users: [boss, second, person('u-v', 'v@yycadvisors.com')] });
  for (const bad of ['false', 'true', 1, 0, null, undefined]) assert.equal(await code(acct.setDisabled(sb, ENV_OFF, actor, { id: 'u-v', disabled: bad })), 400, String(bad));
  assert.equal((await acct.listUsers(sb, ENV_OFF)).find((u) => u.id === 'u-v').disabled, false);
  acct._test.resetLimits();
  const racing = fakeSb({ users: [boss, second], insertError: { code: '23505', message: 'duplicate key value violates unique constraint "access_requests_one_pending"' } });
  assert.deepEqual(await acct.createRequest(racing, ENV_OFF, { name: 'R', email: 'r@yycadvisors.com', password: 'a long enough passphrase' }, '17.1.1.1'), { ok: true });
});

// A role change takes effect on the SERVER at once for admin-only actions, on every instance: they never trust the one-minute memory.
test('a demoted admin is stopped on the very next admin action, even while the one-minute memory still says admin', async () => {
  const T = 1_700_000_000_000;
  const env = { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y', ALLOWED_EMAIL_DOMAINS: 'yycadvisors.com' };
  const base = { id: 'a1', email: 'was.admin@yycadvisors.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
  authTest.cache.clear();
  authTest.cache.set('tok', { at: T, user: { ...base, app_metadata: { role: 'admin' } } }); // remembered as an admin a few seconds ago
  let calls = 0, answer = { ...base, app_metadata: { role: 'viewer' } }; // ...but Supabase now says viewer
  authTest.setClient({ auth: { getUser: async () => { calls++; if (answer === 'down') throw new Error('network'); return { data: { user: answer } }; } } });
  try {
    const req = (extra) => ({ method: 'POST', headers: { authorization: 'Bearer tok' }, body: { op: 'user_set_role', id: 'x', role: 'viewer' }, ...extra });
    const demoted = await handleDb(req(), { env, now: () => T + 5000 });
    assert.equal(demoted.status, 403, 'refused: the fresh answer says viewer');
    assert.equal(calls, 1, 'Supabase was asked again');
    // ordinary reads still use the memory (no extra call): it is refreshed by the fresh answer above, so this one is a plain cache hit
    const before = calls;
    await authenticate({ authorization: 'Bearer tok' }, env, T + 6000);
    assert.equal(calls, before, 'an ordinary request does not ask Supabase again');
    // fail closed: if the fresh check cannot be made, the admin action is refused, not allowed
    answer = 'down';
    authTest.cache.set('tok', { at: T + 7000, user: { ...base, app_metadata: { role: 'admin' } } });
    const down = await handleDb(req(), { env, now: () => T + 7500 });
    assert.equal(down.status, 401, 'cannot verify, so no admin action');
  } finally { authTest.setClient(null); authTest.cache.clear(); }
});

test('"who am I" always reads the role again (a refresh or a check sees a role change at once, never the one-minute memory)', async () => {
  const T = 1_700_000_000_000;
  const env = { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y', ALLOWED_EMAIL_DOMAINS: 'yycadvisors.com' };
  const base = { id: 'a2', email: 'someone@yycadvisors.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
  authTest.cache.clear();
  authTest.cache.set('tok2', { at: T, user: { ...base, app_metadata: { role: 'admin' } } });
  authTest.setClient({ auth: { getUser: async () => ({ data: { user: { ...base, app_metadata: {} } } }) } }); // now a viewer
  try {
    const cached = await handleDb({ method: 'GET', query: { action: 'me' }, headers: { authorization: 'Bearer tok2' } }, { env, now: () => T + 1000 });
    assert.equal(cached.body.isAdmin, false, 'an ordinary "me" is not answered from the one-minute memory');
    const fresh = await handleDb({ method: 'GET', query: { action: 'me', fresh: '1' }, headers: { authorization: 'Bearer tok2' } }, { env, now: () => T + 1000 });
    assert.equal(fresh.body.isAdmin, false, 'fresh=1 sees the demotion at once');
    const again = await handleDb({ method: 'GET', query: { action: 'me' }, headers: { authorization: 'Bearer tok2' } }, { env, now: () => T + 2000 });
    assert.equal(again.body.isAdmin, false, 'and stays correct for the next request');
  } finally { authTest.setClient(null); authTest.cache.clear(); }
});
