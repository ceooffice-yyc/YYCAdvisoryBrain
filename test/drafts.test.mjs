import test from 'node:test';
import assert from 'node:assert/strict';
import { saveDraft, loadDraft, clearDraft, restoreItems, describeDraft, ageLabel, draftKey } from '../src/lib/drafts.js';

// DRAFT-01: unsaved Review / Bulk work is kept in the browser. A tiny stand-in for localStorage; all text here is invented.
const makeStore = (limit = Infinity) => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), removeItem: (k) => m.delete(k), setItem: (k, v) => { if (v.length > limit) throw new Error('QuotaExceededError'); m.set(k, v); } };
};
const T = 1_700_000_000_000;
const extraction = (title = 'Acme Bakery') => ({ title, doc_type: 'case_study', sections: [{ heading: 'Pricing', summary_en: 'x' }], levers: [{ lever: 'price', claim_en: 'Smart fees: fees filter small orders.', impact: 'N/A' }] });
const single = (over = {}) => ({ kind: 'single', title: 'Acme Bakery', text: 'Pricing\n\nSmart fees: fees filter small orders.', html: '<p>Pricing</p>', extraction: extraction(), mnaChoice: null, ...over });
const item = (id, status, over = {}) => ({ id, name: id + '.docx', title: 'Case ' + id, text: 'text ' + id, html: '<p>' + id + '</p>', status, include: true, extraction: status === 'done' ? extraction('Case ' + id) : null, ...over });
const bulk = (items) => ({ kind: 'bulk', items, ticks: { a: true }, reviewId: null, reviewExtraction: null });

test('a single review is saved and comes back exactly as it was', () => {
  const s = makeStore();
  const r = saveDraft('u1', single({ title: 'Edited title' }), { store: s, now: T });
  assert.equal(r.state, 'saved');
  const back = loadDraft('u1', { store: s, now: T + 5000 });
  assert.equal(back.draft.title, 'Edited title');
  assert.deepEqual(back.draft.extraction, extraction());
  assert.equal(back.light, false);
  assert.equal(back.at, T);
});

test('a bulk list keeps every file with its status, its extraction and the ticks', () => {
  const s = makeStore();
  saveDraft('u1', bulk([item('a', 'done'), item('b', 'error', { error: 'The AI was busy' }), item('c', 'ready')]), { store: s, now: T });
  const back = loadDraft('u1', { store: s, now: T }).draft;
  assert.deepEqual(back.items.map((x) => [x.id, x.status]), [['a', 'done'], ['b', 'error'], ['c', 'ready']]);
  assert.equal(back.items[1].error, 'The AI was busy');
  assert.equal(back.items[0].extraction.title, 'Case a');
  assert.deepEqual(back.ticks, { a: true });
});

test('a file that was waiting or being extracted goes back to ready after a refresh; finished ones stay', () => {
  const out = restoreItems([item('a', 'done'), item('b', 'extracting'), item('c', 'pending'), item('d', 'error')]);
  assert.deepEqual(out.map((x) => x.status), ['done', 'ready', 'ready', 'error']);
});

test('each account has its own draft, and one never shows another', () => {
  const s = makeStore();
  saveDraft('u1', single({ title: 'One' }), { store: s, now: T });
  saveDraft('u2', single({ title: 'Two' }), { store: s, now: T });
  assert.equal(loadDraft('u1', { store: s, now: T }).draft.title, 'One');
  assert.equal(loadDraft('u2', { store: s, now: T }).draft.title, 'Two');
  assert.equal(loadDraft('u3', { store: s, now: T }), null);
  assert.notEqual(draftKey('u1'), draftKey('u2'));
  assert.equal(draftKey(null), draftKey('local'), 'with no sign-in the draft belongs to the browser');
});

test('clearing removes the draft', () => {
  const s = makeStore();
  saveDraft('u1', single(), { store: s, now: T });
  clearDraft('u1', { store: s });
  assert.equal(loadDraft('u1', { store: s, now: T }), null);
  assert.equal(s.m.size, 0);
});

test('a draft older than 7 days is forgotten (and removed)', () => {
  const s = makeStore();
  saveDraft('u1', single(), { store: s, now: T });
  assert.ok(loadDraft('u1', { store: s, now: T + 6 * 86_400_000 }), 'still there after 6 days');
  assert.equal(loadDraft('u1', { store: s, now: T + 8 * 86_400_000 }), null);
  assert.equal(s.m.size, 0, 'removed from storage');
});

test('unreadable, wrong-version or wrong-shape drafts are treated as no draft and removed', () => {
  for (const bad of ['{not json', JSON.stringify({ v: 99, at: T, draft: single() }), JSON.stringify({ v: 1, at: T, draft: { kind: 'single' } }), JSON.stringify({ v: 1, at: T, draft: { kind: 'bulk', items: [] } }), JSON.stringify({ v: 1, at: T, draft: { kind: 'other' } }), JSON.stringify({ v: 1, at: T + 10 * 86_400_000, draft: single() })]) {
    const s = makeStore(); s.m.set(draftKey('u1'), bad);
    assert.equal(loadDraft('u1', { store: s, now: T }), null, bad.slice(0, 30));
    assert.equal(s.m.size, 0, 'the bad draft is removed: ' + bad.slice(0, 30));
  }
});

test('too big for the browser: the formatted view is dropped first, and the person is told', () => {
  const s = makeStore();
  const big = bulk([item('a', 'done', { html: 'H'.repeat(3_000_000) }), item('b', 'done')]);
  const r = saveDraft('u1', big, { store: s, now: T });
  assert.equal(r.state, 'saved-light');
  const back = loadDraft('u1', { store: s, now: T });
  assert.equal(back.light, true);
  assert.equal(back.draft.items[0].html, '', 'formatting dropped');
  assert.equal(back.draft.items[0].extraction.title, 'Case a', 'the extraction and the text are kept');
});

test('too big even without the formatted view: nothing is saved, the older draft is removed, and the answer says so', () => {
  const s = makeStore();
  saveDraft('u1', single({ title: 'Older' }), { store: s, now: T });
  const r = saveDraft('u1', single({ text: 'T'.repeat(3_000_000) }), { store: s, now: T + 1000 });
  assert.equal(r.state, 'too-big');
  assert.equal(loadDraft('u1', { store: s, now: T + 2000 }), null, 'no stale draft left behind');
});

test('a full browser storage never throws: it falls back to the light copy, then to "too big"', () => {
  const s = makeStore(500); // a very small storage
  assert.equal(saveDraft('u1', single({ html: 'H'.repeat(2000), text: 'x', extraction: { title: 't', levers: [] } }), { store: s, now: T }).state, 'saved-light');
  assert.equal(saveDraft('u1', single({ text: 'x'.repeat(2000) }), { store: s, now: T }).state, 'too-big');
  assert.equal(saveDraft('u1', single(), { store: null, now: T }).state, 'failed', 'no storage at all (a private window) is a quiet "failed"');
  assert.equal(loadDraft('u1', { store: null }), null);
});

test('the banner text describes what was kept', () => {
  assert.equal(describeDraft(single({ extraction: extraction('Nuts.com') })), 'Unsaved review: "Nuts.com"');
  assert.equal(describeDraft(bulk([item('a', 'done'), item('b', 'error'), item('c', 'ready')])), 'Unsaved bulk list: 3 files, 1 extracted, 1 with errors');
  assert.equal(describeDraft(bulk([item('a', 'done')])), 'Unsaved bulk list: 1 file, 1 extracted');
  assert.equal(ageLabel(T, T + 20_000), 'just now');
  assert.equal(ageLabel(T, T + 5 * 60_000), '5 minutes ago');
  assert.equal(ageLabel(T, T + 3 * 3_600_000), '3 hours ago');
  assert.equal(ageLabel(T, T + 4 * 86_400_000), '4 days ago');
});
