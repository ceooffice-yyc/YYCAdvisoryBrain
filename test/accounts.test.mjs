import test from 'node:test';
import assert from 'node:assert/strict';
import * as acct from '../server/accounts.js';
import { handleDb } from '../server/db.js';
import { authenticate, _test as authTest } from '../server/auth.js';

// A small in-memory stand-in for the Supabase client: just enough of the table queries and the auth admin calls the account code uses.
function fakeSb({ users = [], requests = [] } = {}) {
  const tables = { access_requests: requests, account_events: [] };
  const sent = { invites: [], resets: [] };
  let seq = 1;
  const table = (name) => {
    const filters = []; let lim = Infinity; let mode = 'select'; let patch;
    const api = {
      select() { return api; }, order() { return api; },
      eq(k, v) { filters.push((r) => r[k] === v); return api; },
      limit(n) { lim = n; return api; },
      insert(row) { mode = 'insert'; patch = row; return api; },
      update(p) { mode = 'update'; patch = p; return api; },
      then(resolve) {
        const rows = tables[name] || (tables[name] = []);
        if (mode === 'insert') { rows.push({ id: `r${seq++}`, status: 'pending', requested_at: new Date().toISOString(), ...patch }); return resolve({ data: null, error: null }); }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (mode === 'update') { hit.forEach((r) => Object.assign(r, patch)); return resolve({ data: null, error: null }); }
        return resolve({ data: hit.slice(0, lim), error: null });
      },
    };
    return api;
  };
  return {
    tables, sent,
    from: table,
    auth: {
      resetPasswordForEmail: async (email) => { sent.resets.push(email); return { error: null }; },
      admin: {
        listUsers: async ({ page }) => ({ data: { users: page === 1 ? users : [] }, error: null }),
        getUserById: async (id) => { const u = users.find((x) => x.id === id); return u ? { data: { user: u }, error: null } : { data: null, error: { message: 'not found' } }; },
        inviteUserByEmail: async (email) => { const u = { id: `u${seq++}`, email, app_metadata: {}, email_confirmed_at: null }; users.push(u); sent.invites.push(email); return { data: { user: u }, error: null }; },
        createUser: async ({ email, password, email_confirm, app_metadata }) => { const u = { id: `u${seq++}`, email, app_metadata: { ...app_metadata }, email_confirmed_at: email_confirm ? new Date().toISOString() : null, _pw: password }; users.push(u); return { data: { user: u }, error: null }; },
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
  const outsider = await acct.createRequest(sb, ENV, { name: 'Spam', email: 'x@example.org' }, '1.1.1.3');
  assert.deepEqual([a, again, outsider], [{ ok: true }, { ok: true }, { ok: true }]);
  assert.equal(sb.tables.access_requests.length, 1, 'one pending request, the outside domain is quietly ignored');
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
  authTest.cache.set('viewer', { at: T, user: { id: 'v', email: 'viewer@yycadvisors.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {} } });
  const adminOps = ['doc_save', 'doc_update', 'doc_delete', 'record_save', 'record_delete', 'config_save', 'import_docs', 'ask_log_list', 'gap_list', 'gap_clear',
    'users_list', 'user_invite', 'user_create', 'user_temp_password', 'user_set_role', 'user_set_disabled', 'user_send_reset', 'requests_list', 'request_decide', 'account_events'];
  for (const op of adminOps) {
    const none = await handleDb({ method: 'POST', headers: {}, body: { op } }, { env, now: () => T });
    assert.equal(none.status, 401, `${op} with no sign-in`);
    const viewer = await handleDb({ method: 'POST', headers: { authorization: 'Bearer viewer' }, body: { op } }, { env, now: () => T });
    assert.equal(viewer.status, 403, `${op} as a viewer`);
  }
  const guestRead = await handleDb({ method: 'POST', headers: {}, body: { op: 'library' } }, { env, now: () => T });
  assert.equal(guestRead.status, 401, 'with ALLOW_GUEST=false even the guest reads need a sign-in');
});

test('database API: "request access" needs no sign-in, but its failures never show internals', async () => {
  acct._test.resetLimits();
  const T = 1_700_000_000_000;
  const env = { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y', ALLOWED_EMAIL_DOMAINS: 'yycadvisors.com' };
  const bad = await handleDb({ method: 'POST', headers: { 'x-forwarded-for': '3.3.3.3' }, body: { op: 'access_request', name: '', email: 'q' } }, { env, now: () => T });
  assert.equal(bad.status, 400);
  const down = await handleDb({ method: 'POST', headers: { 'x-forwarded-for': '3.3.3.4' }, body: { op: 'access_request', name: 'Q', email: 'q@yycadvisors.com' } }, { env, now: () => T });
  assert.equal(down.status, 502);
  assert.equal(down.body.error, 'The request could not be saved. Please try again later.');
});

test('no email (the default): accounts are created with a one-time temporary password the person must replace', async () => {
  const sb = fakeSb({ users: [boss, second] });
  assert.equal(await code(acct.inviteUser(sb, ENV_OFF, actor, { email: 'a@yycadvisors.com' })), 400, 'email invites are off');
  assert.equal(await code(acct.sendReset(sb, ENV_OFF, actor, { id: 'u-boss' })), 400, 'reset emails are off');
  assert.equal(await code(acct.createUser(sb, ENV_OFF, actor, { email: 'a@example.org' })), 400);
  assert.equal(await code(acct.createUser(sb, ENV_OFF, actor, { email: 'boss@yycadvisors.com' })), 409);
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
  const me = { id: 'u-t', email: 't@yycadvisors.com' };
  assert.equal(await code(acct.setOwnPassword(sb, me, { password: 'short' })), 400);
  assert.equal(await code(acct.setOwnPassword(sb, me, { password: 'x'.repeat(73) })), 400);
  assert.equal(await code(acct.setOwnPassword(sb, me, { password: 't@yycadvisors.com' })), 400);
  assert.equal(await code(acct.setOwnPassword(sb, me, { password: 12345678901 })), 400);
  await acct.setOwnPassword(sb, me, { password: 'a long enough passphrase' });
  assert.deepEqual([u._pw, u.app_metadata.must_change_password], ['a long enough passphrase', false]);
  assert.equal(sb.tables.account_events.at(-1).action, 'password_changed');
});

test('approving a request without email creates the account and hands the temporary password to the admin', async () => {
  acct._test.resetLimits();
  const sb = fakeSb({ users: [boss, second] });
  await acct.createRequest(sb, ENV_OFF, { name: 'Ann', email: 'ann@yycadvisors.com' }, '4.4.4.4');
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
  const who = await handleDb({ method: 'GET', headers: { authorization: 'Bearer temp' }, query: { action: 'me' } }, { env, now: () => T });
  assert.deepEqual([who.status, who.body.mustChangePassword], [200, true], '"who am I" works so the app knows to ask');
  const change = await handleDb({ method: 'POST', headers: { authorization: 'Bearer temp' }, body: { op: 'set_password', password: 'short' } }, { env, now: () => T });
  assert.equal(change.status, 400, 'set_password is let through and checked (a too-short password is refused)');
});

test('the public status tells the sign-in screen whether emails are used', async () => {
  const base = { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y' };
  assert.equal((await handleDb({ method: 'GET', query: { action: 'status' }, headers: {} }, { env: base })).body.emailInvites, false);
  assert.equal((await handleDb({ method: 'GET', query: { action: 'status' }, headers: {} }, { env: { ...base, EMAIL_INVITES: 'on' } })).body.emailInvites, true);
});
