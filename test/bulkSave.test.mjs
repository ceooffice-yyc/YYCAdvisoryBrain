import test from 'node:test';
import assert from 'node:assert/strict';
import { itemFlags, isTickedByDefault, isTicked, summarizeTicked, saveMany } from '../src/bulkSave.js';

// Invented records only. A tiny stand-in for the app's similarity score: the share of shared words.
const similarity = (a, b) => {
  const A = new Set(String(a || '').toLowerCase().split(/\s+/).filter(Boolean)), B = new Set(String(b || '').toLowerCase().split(/\s+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0; A.forEach((w) => { if (B.has(w)) hit++; });
  return hit / Math.max(A.size, B.size);
};
const item = (id, levers, notices = [], status = 'done') => ({ id, status, extraction: { levers, notices } });
const rec = (lever, claim, extra = {}) => ({ lever, claim_en: claim, impact: 'N/A', ...extra });
const EXISTING = [{ lever: 'price', claim_en: 'Charge a delivery fee on small orders' }, { lever: 'volume', claim_en: 'Open a second warehouse' }];

test('flags: counts records to save, records that look like ones already in the library, and warnings', () => {
  const clean = itemFlags(item('a', [rec('talent_strategy', 'Rebook every patient at the desk')]), EXISTING, similarity);
  assert.deepEqual(clean, { records: 1, similar: 0, warnings: [] });
  const dup = itemFlags(item('b', [rec('price', 'Charge a delivery fee on small orders today'), rec('volume', 'Something entirely new here')]), EXISTING, similarity);
  assert.equal(dup.records, 2);
  assert.equal(dup.similar, 1);                                    // only the price record resembles an existing price record
  const sameWordsOtherLever = itemFlags(item('c', [rec('cogs', 'Charge a delivery fee on small orders')]), EXISTING, similarity);
  assert.equal(sameWordsOtherLever.similar, 0);                    // a different lever never counts
  const warned = itemFlags(item('d', [rec('others', 'Do a thing')], [{ level: 'info', text: 'fyi' }, { level: 'warn', text: 'check the lever' }]), EXISTING, similarity);
  assert.deepEqual(warned.warnings, ['check the lever']);
});

test('flags: skipped and empty records are not counted', () => {
  const f = itemFlags(item('e', [rec('price', 'Keep this one'), rec('price', 'Skipped one', { skip: true }), rec('price', '   ')]), [], similarity);
  assert.equal(f.records, 1);
  assert.equal(itemFlags({ id: 'x' }, [], similarity).records, 0);  // an item with no extraction yet
});

test('default tick: only a ready item with records, no warning and nothing similar is ticked for you', () => {
  const ok = item('a', [rec('price', 'x')]);
  assert.equal(isTickedByDefault(ok, { records: 1, similar: 0, warnings: [] }), true);
  assert.equal(isTickedByDefault(ok, { records: 1, similar: 1, warnings: [] }), false);   // similar to an existing record
  assert.equal(isTickedByDefault(ok, { records: 1, similar: 0, warnings: ['w'] }), false); // has a warning
  assert.equal(isTickedByDefault(ok, { records: 0, similar: 0, warnings: [] }), false);    // nothing to save
  assert.equal(isTickedByDefault(item('p', [], [], 'pending'), { records: 1, similar: 0, warnings: [] }), false); // not ready
});

test('the person\'s own tick always wins over the default, and only ready items can be ticked', () => {
  const it = item('a', [rec('price', 'x')]);
  const flagged = { records: 1, similar: 2, warnings: [] };
  assert.equal(isTicked(it, {}, flagged), false);                  // default: unticked
  assert.equal(isTicked(it, { a: true }, flagged), true);          // ticked by hand
  assert.equal(isTicked(it, { a: false }, { records: 1, similar: 0, warnings: [] }), false); // unticked by hand although the default would tick it
  assert.equal(isTicked(item('p', [], [], 'extracting'), { p: true }, flagged), false);
});

test('summary for the confirmation: documents, records, and how many ticked items still carry a flag', () => {
  const items = [item('a', [rec('price', 'x'), rec('price', 'y')]), item('b', [rec('price', 'z')]), item('c', [rec('price', 'w')]), item('d', [], [], 'error')];
  const flags = { a: { records: 2, similar: 0, warnings: [] }, b: { records: 1, similar: 1, warnings: [] }, c: { records: 1, similar: 0, warnings: ['w'] }, d: { records: 0, similar: 0, warnings: [] } };
  const byDefault = summarizeTicked(items, {}, (it) => flags[it.id]);
  assert.deepEqual(byDefault, { ids: ['a'], docs: 1, records: 2, flagged: 0 });
  const all = summarizeTicked(items, { b: true, c: true, d: true }, (it) => flags[it.id]);
  assert.deepEqual(all, { ids: ['a', 'b', 'c'], docs: 3, records: 4, flagged: 2 }); // d is not ready, so it can never be ticked
});

test('saving many: one by one, a failure never stops the rest, and progress is reported', async () => {
  const items = ['a', 'b', 'c', 'd'].map((id) => item(id, [rec('price', id)]));
  const seen = [], progress = [];
  const out = await saveMany(items, async (it) => { seen.push(it.id); if (it.id === 'b') throw new Error('disk full'); }, (p) => progress.push(p.done + '/' + p.total));
  assert.deepEqual(seen, ['a', 'b', 'c', 'd']);                    // in order, all attempted
  assert.deepEqual(out.saved, ['a', 'c', 'd']);
  assert.deepEqual(out.failed, [{ id: 'b', error: 'disk full' }]);
  assert.deepEqual(progress, ['1/4', '2/4', '3/4', '4/4']);
  assert.deepEqual(await saveMany([], async () => {}), { saved: [], failed: [] });
});
