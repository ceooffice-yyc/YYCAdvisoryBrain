import test from 'node:test';
import assert from 'node:assert/strict';
import * as acct from '../server/accounts.js';
import { _test } from '../server/db.js';

// The Activity table (Users screen): who (name - id), what, when. An in-memory stand-in for the database; all names here are invented.
function fakeSb({ events = [], users = [], usersFail = false, docs = [], records = [] } = {}) {
  const tables = { account_events: events, documents: docs, records };
  const from = (name) => {
    const rows = tables[name] || (tables[name] = []);
    const filters = []; let op = 'select', patch = null, lim = Infinity, back = false;
    const q = {
      select() { if (op === 'update') back = true; return q; },
      eq(c, v) { filters.push((r) => r[c] === v); return q; },
      order() { return q; },
      limit(n) { lim = n; return q; },
      insert(row) { op = 'insert'; patch = row; return q; },
      update(p) { op = 'update'; patch = p; return q; },
      then(resolve) {
        if (op === 'insert') { rows.push({ id: 'e' + (rows.length + 1), at: '2026-11-26T08:00:00.000Z', ...patch }); return resolve({ data: null, error: null }); }
        const out = rows.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') out.forEach((r) => Object.assign(r, patch));
        return resolve({ data: op === 'update' && !back ? null : out.slice(0, lim).map((r) => ({ ...r })), error: null });
      },
    };
    return q;
  };
  return { tables, from, auth: { admin: { listUsers: async ({ page }) => (usersFail ? { data: null, error: { message: 'auth is down' } } : { data: { users: page === 1 ? users : [] }, error: null }) } } };
}
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const ev = (id, actor, action, target = null, detail = {}) => ({ id, at: '2026-11-25T10:00:00.000Z', actor, action, target, detail });

test('each trail row says who acted as a name and an id', async () => {
  const sb = fakeSb({
    events: [ev('e1', 'amira@yycadvisors.com', 'role', 'lee@yycadvisors.com', { role: 'admin' }), ev('e2', 'Amira@YYCAdvisors.com', 'disable', 'sam@yycadvisors.com')],
    users: [{ id: 'aaaa1111-2222-3333-4444-555566667777', email: 'amira@yycadvisors.com', user_metadata: { full_name: '  Amira   Tan ' } }],
  });
  const out = await acct.listEvents(sb);
  assert.deepEqual(out.map((e) => [e.actorName, e.actorId]), [['Amira Tan', 'aaaa1111-2222-3333-4444-555566667777'], ['Amira Tan', 'aaaa1111-2222-3333-4444-555566667777']], 'the lookup ignores capital letters and extra spaces');
  assert.equal(out[0].action, 'role'); assert.equal(out[0].target, 'lee@yycadvisors.com'); assert.equal(out[0].detail.role, 'admin');
});

test('an account with no name still gets its id, and an account that no longer exists keeps just the email', async () => {
  const sb = fakeSb({ events: [ev('e1', 'nameless@yycadvisors.com', 'enable', 'x@yycadvisors.com'), ev('e2', 'gone@yycadvisors.com', 'approve', 'y@yycadvisors.com')], users: [{ id: 'u-nameless-1', email: 'nameless@yycadvisors.com' }] });
  const [a, b] = await acct.listEvents(sb);
  assert.deepEqual([a.actorName, a.actorId], ['', 'u-nameless-1']);
  assert.deepEqual([b.actorName, b.actorId, b.actor], ['', '', 'gone@yycadvisors.com']);
});

test('if the accounts cannot be read, the trail is still shown (email only)', async () => {
  const sb = fakeSb({ events: [ev('e1', 'amira@yycadvisors.com', 'reset', 'z@yycadvisors.com')], usersFail: true });
  const out = await quiet(() => acct.listEvents(sb));
  assert.equal(out.length, 1); assert.equal(out[0].actor, 'amira@yycadvisors.com'); assert.equal(out[0].actorId, '');
});

test('an empty trail needs no account lookup', async () => {
  const sb = fakeSb({ usersFail: true });
  assert.deepEqual(await acct.listEvents(sb), []);
});

test('restoring a material and a strategy is written to the trail with the admin and the title', async () => {
  const docs = [{ id: 'd1', status: 'deleted', title: 'Acme Bakery', deleted_at: '2026-11-10T10:00:00.000Z' }];
  const records = [{ id: 'r1', doc_id: 'd1', claim_en: 'Smart fees: A.', status: 'deleted', deleted_at: '2026-11-10T10:00:00.000Z' }, { id: 'r2', doc_id: 'd1', claim_en: 'Bundles: B.', status: 'deleted', deleted_at: '2026-01-01T00:00:00.000Z' }];
  const sb = fakeSb({ docs, records });
  const user = { email: 'amira@yycadvisors.com' };
  await quiet(() => _test.restoreDoc(sb, user, {}, 'd1'));
  await _test.restoreRecord(sb, user, 'r2');
  const trail = sb.tables.account_events;
  assert.deepEqual(trail.map((e) => [e.actor, e.action, e.target]), [['amira@yycadvisors.com', 'doc_restore', 'Acme Bakery'], ['amira@yycadvisors.com', 'record_restore', 'Bundles: B.']]);
  assert.equal(trail[0].detail.records, 1, 'how many strategies came back with the material');
  await quiet(() => _test.restoreDoc(sb, user, {}, 'd1')); // pressing it again changes nothing, so nothing new is written
  assert.equal(sb.tables.account_events.length, 2);
});
