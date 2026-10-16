import test from 'node:test';
import assert from 'node:assert/strict';
import { splitClaim, combineClaim, removeLever, undoRemoveLever } from '../src/claim.js';

test('claim text: split and combine are inverses for tidy text', () => {
  assert.deepEqual(splitClaim('Premium pricing: Charge more for value'), { name: 'Premium pricing', desc: 'Charge more for value' });
  assert.deepEqual(splitClaim('No title here, just a sentence'), { name: '', desc: 'No title here, just a sentence' });
  assert.deepEqual(splitClaim('  Padded title: and description  '), { name: 'Padded title', desc: 'and description' });
  assert.equal(combineClaim('Premium pricing', 'Charge more'), 'Premium pricing: Charge more');
  assert.equal(combineClaim('', 'Only a description'), 'Only a description');
  assert.equal(combineClaim('Title only', ''), 'Title only: ');
});

test('claim text: the STORED text is trimmed (so the library stays tidy) even though the boxes keep every space while typing', () => {
  assert.equal(combineClaim('Premium pricing ', 'Charge more '), 'Premium pricing: Charge more');
  assert.equal(combineClaim('  Premium pricing  ', '  Charge more'), 'Premium pricing: Charge more');
  assert.equal(combineClaim('   ', '  just text  '), 'just text');
});

const sample = () => ({ title: 'T', levers: [{ claim_en: 'A: one' }, { claim_en: 'B: two' }, { claim_en: 'C: three' }] });

test('review: removing a record takes it out, remembers it, and leaves the original untouched', () => {
  const x = sample();
  const y = removeLever(x, 1);
  assert.deepEqual(y.levers.map((l) => l.claim_en), ['A: one', 'C: three']);
  assert.deepEqual(y.removed, [{ rec: { claim_en: 'B: two' }, index: 1 }]);
  assert.equal(x.levers.length, 3); assert.equal(x.removed, undefined); // not mutated
  assert.equal(y.title, 'T');
  assert.equal(removeLever(x, 9), x); // nothing there: unchanged
});

test('review: Undo restores records last-removed-first, in their old places', () => {
  let x = removeLever(removeLever(sample(), 2), 0);          // remove C, then A
  assert.deepEqual(x.levers.map((l) => l.claim_en), ['B: two']);
  x = undoRemoveLever(x);                                    // A comes back first
  assert.deepEqual(x.levers.map((l) => l.claim_en), ['A: one', 'B: two']);
  x = undoRemoveLever(x);                                    // then C
  assert.deepEqual(x.levers.map((l) => l.claim_en), ['A: one', 'B: two', 'C: three']);
  assert.equal(x.removed.length, 0);
  assert.equal(undoRemoveLever(x), x);                       // nothing left to undo
});

test('review: removing everything is allowed, and Undo copes when the list is shorter than before', () => {
  let x = sample();
  for (let i = 0; i < 3; i++) x = removeLever(x, 0);
  assert.equal(x.levers.length, 0);
  x = undoRemoveLever(x);
  assert.equal(x.levers.length, 1);
  assert.equal(x.levers[0].claim_en, 'C: three');
});

test('review: the removal list lives on the extraction, never inside a record, so it cannot be saved with the document', () => {
  const y = removeLever(sample(), 0);
  assert.ok(y.levers.every((l) => !('removed' in l)));
  assert.ok(!JSON.stringify(y.levers).includes('removed'));
});
