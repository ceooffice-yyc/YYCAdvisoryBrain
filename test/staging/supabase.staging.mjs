// STAGING TESTS: the same server code the live site runs, against a REAL Supabase project (a separate "staging" one, never the live one).
// The normal tests use an in-memory stand-in for the database; this file is what shows the stand-in matches the real thing for the two features
// where that matters most: role changes (the 60-second login memory, other server instances) and Recently deleted (restore rules).
//
// Run:  npm run test:staging      (needs the settings below; without them every test is skipped, so nothing can run by accident)
//   STAGING_SUPABASE_URL                 e.g. https://abcd1234.supabase.co    (a project made for testing, with supabase/schema.sql applied)
//   STAGING_SUPABASE_ANON_KEY            the "anon public" key of that project
//   STAGING_SUPABASE_SERVICE_ROLE_KEY    its service-role key (server-side only; never put it in the app or in a screenshot)
//   STAGING_CONFIRM=this-is-not-production    you confirm the project above is NOT the live one
//   STAGING_EMAIL_DOMAIN                 optional, default "yyc-staging.test": the made-up email domain of the test accounts
//
// What it creates: two made-up accounts and one made-up material with two strategies, all named "staging-<run id>". Everything is removed again at the end,
// including when a test fails. It never touches anything else in the project.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { handleDb } from '../../server/db.js';
import { deleteDocChunks } from '../../server/indexing.js';

const URL_ = String(process.env.STAGING_SUPABASE_URL || '').trim();
const ANON = String(process.env.STAGING_SUPABASE_ANON_KEY || '').trim();
const SERVICE = String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '').trim();
const CONFIRMED = process.env.STAGING_CONFIRM === 'this-is-not-production';
const DOMAIN = String(process.env.STAGING_EMAIL_DOMAIN || 'yyc-staging.test').trim().toLowerCase();
const live = String(process.env.SUPABASE_URL || '').trim();

const ready = !!(URL_ && ANON && SERVICE && CONFIRMED);
const skip = ready ? false : 'staging settings not given (see the top of this file): skipped on purpose';
if (ready && live && live.replace(/\/+$/, '') === URL_.replace(/\/+$/, '')) throw new Error('STAGING_SUPABASE_URL is the same project as SUPABASE_URL (the live one). Refusing to run.');

const RUN = `staging-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
const ENV = { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, ALLOWED_EMAIL_DOMAINS: DOMAIN };
const password = () => randomBytes(12).toString('base64url') + 'Aa1!';

const S = { admin: null, viewer: null, adminToken: '', viewerToken: '', sb: null, docId: `${RUN}-doc`, r1: `${RUN}-r1`, r2: `${RUN}-r2` };

const call = (token, body) => handleDb({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, { env: ENV });
const me = (token) => handleDb({ method: 'GET', query: { action: 'me' }, headers: { authorization: `Bearer ${token}` } }, { env: ENV });

async function makeAccount(label, role) {
  const email = `${RUN}-${label}@${DOMAIN}`, pw = password();
  const { data, error } = await S.sb.auth.admin.createUser({ email, password: pw, email_confirm: true, app_metadata: role === 'admin' ? { role: 'admin' } : {}, user_metadata: { full_name: `Staging ${label} ${RUN}` } });
  if (error) throw new Error('could not create the test account: ' + error.message);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await anon.auth.signInWithPassword({ email, password: pw });
  if (signed.error) throw new Error('could not sign the test account in: ' + signed.error.message);
  return { id: data.user.id, email, token: signed.data.session.access_token };
}

before(async () => {
  if (!ready) return;
  S.sb = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const [a, v] = [await makeAccount('admin', 'admin'), await makeAccount('viewer', 'viewer')];
  Object.assign(S, { admin: a, viewer: v, adminToken: a.token, viewerToken: v.token });
});

after(async () => { // always: remove everything this run made (each step on its own, so one failure cannot stop the rest)
  if (!ready || !S.sb) return;
  const quiet = async (fn) => { try { await fn(); } catch (e) { console.error('cleanup:', e.message); } };
  await quiet(() => deleteDocChunks(S.sb, S.docId));
  await quiet(async () => { await S.sb.from('records').delete().eq('doc_id', S.docId); });
  await quiet(async () => { await S.sb.from('documents').delete().eq('id', S.docId); });
  for (const who of [S.admin, S.viewer]) {
    if (!who) continue;
    await quiet(async () => { await S.sb.from('account_events').delete().eq('actor', who.email); });
    await quiet(async () => { await S.sb.from('account_events').delete().eq('target', who.email); });
    await quiet(async () => { await S.sb.auth.admin.deleteUser(who.id); });
  }
});

test('staging: a viewer made admin is an admin on the very next request, and an admin made viewer is stopped at once', { skip }, async () => {
  assert.equal((await me(S.viewerToken)).body.isAdmin, false, 'starts as a viewer (this also puts the login in the 60-second memory)');
  assert.equal((await call(S.viewerToken, { op: 'trash_list' })).status, 403, 'a viewer cannot use admin actions');

  const up = await call(S.adminToken, { op: 'user_set_role', id: S.viewer.id, role: 'admin' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal((await me(S.viewerToken)).body.isAdmin, true, '"who am I" sees the new role at once, with the same login token');
  assert.equal((await call(S.viewerToken, { op: 'trash_list' })).status, 200, 'and the admin action is allowed straight away');

  const down = await call(S.adminToken, { op: 'user_set_role', id: S.viewer.id, role: 'viewer' });
  assert.equal(down.status, 200, JSON.stringify(down.body));
  assert.equal((await call(S.viewerToken, { op: 'trash_list' })).status, 403, 'a demoted admin is refused at once');
  assert.equal((await me(S.viewerToken)).body.isAdmin, false, 'and "who am I" agrees');
});

test('staging: a disabled account is refused at once, and works again when enabled', { skip }, async () => {
  assert.equal((await me(S.viewerToken)).status, 200);
  assert.equal((await call(S.adminToken, { op: 'user_set_disabled', id: S.viewer.id, disabled: true })).status, 200);
  const off = await me(S.viewerToken);
  assert.equal(off.status, 403, 'the old token stops working at once');
  assert.match(String(off.body.error), /disabled/i);
  assert.equal((await call(S.adminToken, { op: 'user_set_disabled', id: S.viewer.id, disabled: false })).status, 200);
  assert.equal((await me(S.viewerToken)).status, 200, 'enabled again');
});

test('staging: Recently deleted lists a deleted material, restores it with its strategies, and restoring twice is harmless', { skip }, async () => {
  const doc = { id: S.docId, title: `Staging material ${RUN}`, doc_type: 'case_study', industry: 'Services (invented)', industry_main: 'Services', industry_sub: 'Test', language: 'en', problem_signature: 'A made-up problem', sections: [], full_text: 'Made-up text.', html: '', created: Date.now() };
  const recs = [
    { id: S.r1, doc_id: S.docId, doc_title: doc.title, lever: 'price', claim_en: 'Staging strategy one.', impact: 'N/A', section: 'Pricing' },
    { id: S.r2, doc_id: S.docId, doc_title: doc.title, lever: 'volume', claim_en: 'Staging strategy two.', impact: 'N/A', section: 'Volume' },
  ];
  const saved = await call(S.adminToken, { op: 'doc_save', doc, records: recs });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  assert.equal((await call(S.adminToken, { op: 'doc_delete', id: S.docId })).status, 200);
  const list = (await call(S.adminToken, { op: 'trash_list' })).body;
  assert.ok(list.docs.some((d) => d.id === S.docId), 'the deleted material is listed');
  assert.ok(!list.records.some((r) => r.doc_id === S.docId), 'its strategies come back with it, so they are not listed on their own');

  const back = await call(S.adminToken, { op: 'doc_restore', id: S.docId });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.deepEqual([back.body.restored, back.body.records], [true, 2]);
  const rows = (await S.sb.from('records').select('id,status').eq('doc_id', S.docId)).data;
  assert.deepEqual(rows.map((r) => r.status).sort(), ['active', 'active'], 'both strategies are active again, in the real table');

  const again = await call(S.adminToken, { op: 'doc_restore', id: S.docId });
  assert.equal(again.body.restored, false, 'pressing restore again (or another admin doing it) changes nothing');
});

test('staging: a strategy deleted on its own is listed and restored, and needs its material alive', { skip }, async () => {
  const keep = await S.sb.from('documents').select('*').eq('id', S.docId).limit(1);
  const doc = keep.data[0];
  const only = { id: S.r1, doc_id: S.docId, doc_title: doc.title, lever: 'price', claim_en: 'Staging strategy one.', impact: 'N/A', section: 'Pricing' };
  const edit = await call(S.adminToken, { op: 'doc_update', doc: { ...doc, sections: doc.sections || [] }, records: [only] }); // strategy two removed on the edit screen
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const list = (await call(S.adminToken, { op: 'trash_list' })).body;
  assert.ok(list.records.some((r) => r.id === S.r2), 'the removed strategy is listed');

  assert.equal((await call(S.adminToken, { op: 'record_restore', id: S.r2 })).body.restored, true);
  assert.equal((await S.sb.from('records').select('status').eq('id', S.r2).limit(1)).data[0].status, 'active');

  // delete the material AFTER a strategy was removed on its own: that strategy needs the material back first
  assert.equal((await call(S.adminToken, { op: 'doc_update', doc: { ...doc, sections: doc.sections || [] }, records: [only] })).status, 200);
  assert.equal((await call(S.adminToken, { op: 'doc_delete', id: S.docId })).status, 200);
  const blocked = await call(S.adminToken, { op: 'record_restore', id: S.r2 });
  assert.equal(blocked.status, 409, 'its material is deleted, so it must be restored first');
  assert.equal((await call(S.adminToken, { op: 'doc_restore', id: S.docId })).status, 200);
});

test('staging: the Activity trail names the admin (name and id) for role changes, deletes and restores', { skip }, async () => {
  const events = (await call(S.adminToken, { op: 'account_events', limit: 100 })).body.events;
  const mine = events.filter((e) => e.actor === S.admin.email);
  const actions = new Set(mine.map((e) => e.action));
  for (const a of ['role', 'disable', 'enable', 'doc_delete', 'doc_restore', 'record_restore']) assert.ok(actions.has(a), `the trail has a "${a}" entry`);
  for (const e of mine) assert.deepEqual([e.actorId, e.actorName], [S.admin.id, `Staging admin ${RUN}`], 'every entry carries the admin\'s id and name');
  assert.ok(mine.every((e) => e.at && !Number.isNaN(Date.parse(e.at))), 'and a real date');
});
