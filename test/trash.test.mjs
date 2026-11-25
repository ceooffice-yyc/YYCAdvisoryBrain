import test from 'node:test';
import assert from 'node:assert/strict';
import { _test } from '../server/db.js';

// UX-04 "Recently deleted": list what was deleted and bring it back. An in-memory stand-in for the database; all text here is invented.
const { trashList, restoreDoc, restoreRecord } = _test;

function fakeSb(tables) {
  const from = (name) => {
    const rows = tables[name];
    if (!rows) return { select: () => { throw new Error('no table ' + name); } };
    const filters = []; let op = 'select', patch = null, lim = Infinity, order = null, back = false;
    const q = {
      select() { if (op === 'update') back = true; return q; },
      eq(c, v) { filters.push((r) => r[c] === v); return q; },
      in(c, arr) { filters.push((r) => arr.includes(r[c])); return q; },
      order(c, { ascending = true } = {}) { order = [c, ascending]; return q; },
      limit(n) { lim = n; return q; },
      update(p) { op = 'update'; patch = p; return q; },
      then(resolve) {
        let out = rows.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') out.forEach((r) => Object.assign(r, patch));
        if (order) out = [...out].sort((a, b) => (String(a[order[0]]) < String(b[order[0]]) ? -1 : 1) * (order[1] ? 1 : -1));
        resolve({ data: op === 'update' && !back ? null : out.slice(0, lim).map((r) => ({ ...r })), error: null });
      },
    };
    return q;
  };
  return { from };
}

const T0 = '2026-11-01T09:00:00.000Z', T1 = '2026-11-10T10:00:00.000Z', T2 = '2026-11-20T11:00:00.000Z';
const gone = (extra) => ({ status: 'deleted', deleted_by: 'admin@yycadvisors.com', ...extra });
const world = () => ({
  documents: [
    { id: 'd1', status: 'deleted', title: 'Acme Bakery', doc_type: 'case_study', industry: 'Food', deleted_at: T1, deleted_by: 'admin@yycadvisors.com', created: 1 },
    { id: 'd2', status: 'active', title: 'Northwind Clinics', doc_type: 'case_study', industry: 'Health', deleted_at: null, created: 2 },
    { id: 'd3', status: 'deleted', title: 'Globex Furniture', doc_type: 'case_study', industry: 'Furniture', deleted_at: T2, deleted_by: 'admin@yycadvisors.com', created: 3 },
  ],
  records: [
    { id: 'r1', doc_id: 'd1', doc_title: 'Acme Bakery', lever: 'price', claim_en: 'Smart fees: A.', ...gone({ deleted_at: T1 }) }, // deleted together with d1
    { id: 'r2', doc_id: 'd1', doc_title: 'Acme Bakery', lever: 'volume', claim_en: 'Bundles: B.', ...gone({ deleted_at: T1 }) }, // deleted together with d1
    { id: 'r3', doc_id: 'd2', doc_title: 'Northwind Clinics', lever: 'cogs', claim_en: 'Buy flour: C.', ...gone({ deleted_at: T0 }) }, // deleted on its own, material alive
    { id: 'r4', doc_id: 'd3', doc_title: 'Globex Furniture', lever: 'price', claim_en: 'Lease: D.', ...gone({ deleted_at: T0 }) }, // deleted on its own, THEN the material was deleted
    { id: 'r5', doc_id: 'd3', doc_title: 'Globex Furniture', lever: 'cogs', claim_en: 'Make to order: E.', ...gone({ deleted_at: T2 }) }, // deleted together with d3
    { id: 'r6', doc_id: 'd2', doc_title: 'Northwind Clinics', lever: 'volume', claim_en: 'Alive.', status: 'active', deleted_at: null },
  ],
});
const user = { email: 'admin@yycadvisors.com' };
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } }; // indexing is not available in this stand-in

test('the list shows deleted materials newest first, and only strategies that were deleted on their own', async () => {
  const out = await trashList(fakeSb(world()));
  assert.deepEqual(out.docs.map((d) => d.id), ['d3', 'd1']);
  assert.deepEqual(out.records.map((r) => r.id).sort(), ['r3', 'r4'], 'r1, r2, r5 come back with their material, so they are not listed');
  const r3 = out.records.find((r) => r.id === 'r3'), r4 = out.records.find((r) => r.id === 'r4');
  assert.equal(r3.docDeleted, false); assert.equal(r3.doc_title, 'Northwind Clinics');
  assert.equal(r4.docDeleted, true, 'its material is deleted too: restore the material first');
  assert.equal(out.records[0].claim.length > 0, true);
});

test('restoring a material brings back exactly the strategies deleted with it, and nothing deleted earlier', async () => {
  const w = world();
  const out = await quiet(() => restoreDoc(fakeSb(w), user, {}, 'd1'));
  assert.equal(out.restored, true); assert.equal(out.records, 2);
  const d1 = w.documents.find((d) => d.id === 'd1');
  assert.deepEqual([d1.status, d1.deleted_at, d1.deleted_by], ['active', null, null]);
  assert.deepEqual(w.records.filter((r) => r.doc_id === 'd1').map((r) => r.status), ['active', 'active']);
  // restore d3: r5 (deleted with it) returns; r4 (deleted earlier, on its own) stays deleted
  const out3 = await quiet(() => restoreDoc(fakeSb(w), user, {}, 'd3'));
  assert.equal(out3.records, 1);
  assert.equal(w.records.find((r) => r.id === 'r5').status, 'active');
  assert.equal(w.records.find((r) => r.id === 'r4').status, 'deleted', 'a strategy deleted on its own stays in the list');
  assert.equal(w.records.find((r) => r.id === 'r4').updated_by, undefined, 'and was not touched');
});

test('restoring twice, or a material that does not exist, is handled', async () => {
  const w = world();
  await quiet(() => restoreDoc(fakeSb(w), user, {}, 'd1'));
  assert.deepEqual(await quiet(() => restoreDoc(fakeSb(w), user, {}, 'd1')), { restored: false, records: 0 }, 'the second press (or another admin) does nothing');
  await assert.rejects(() => restoreDoc(fakeSb(w), user, {}, 'nope'), (e) => e.status === 404 && /not found/.test(e.message));
});

test('restoring a strategy needs its material to be there', async () => {
  const w = world();
  assert.deepEqual(await restoreRecord(fakeSb(w), user, 'r3'), { restored: true });
  assert.equal(w.records.find((r) => r.id === 'r3').status, 'active');
  assert.equal(w.records.find((r) => r.id === 'r3').deleted_at, null);
  await assert.rejects(() => restoreRecord(fakeSb(w), user, 'r4'), (e) => e.status === 409 && /Restore its material first/.test(e.message));
  assert.equal(w.records.find((r) => r.id === 'r4').status, 'deleted', 'nothing changed after the refusal');
  assert.deepEqual(await restoreRecord(fakeSb(w), user, 'r6'), { restored: false }, 'an active strategy is left as it is');
  await assert.rejects(() => restoreRecord(fakeSb(w), user, 'zzz'), (e) => e.status === 404);
});

test('a database error is reported, not swallowed', async () => {
  const sb = { from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'connection lost' } }) }) }) }) };
  await assert.rejects(() => restoreRecord(sb, user, 'r3'), /connection lost/);
});
