import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeQuery, bm25Rank, bestExcerpt, squash } from '../server/ask/text.js';
import { chunkDocument } from '../server/chunking.js';
import { docs } from './fixtures/library.mjs';

test('tokenizer keeps short numbers and handles M&A and stemming', () => {
  assert.deepEqual(tokenizeQuery('is it mandatory to avoid 50 50 ownership'), ['mandatory', 'avoid', '50', 'ownership']);
  assert.ok(tokenizeQuery('M&A criteria').includes('mna'));
  assert.deepEqual(tokenizeQuery('reinvesting dividends'), tokenizeQuery('reinvest dividend'));
  assert.ok(tokenizeQuery('采购成本').length > 0);
});

test('bm25: synonyms from the rewrite count, but less than the question words', () => {
  const items = ['alpha beta', 'gamma delta'];
  const plain = bm25Rank('alpha', items, (x) => x);
  assert.equal(plain.length, 1);
  const withExtra = bm25Rank('alpha', items, (x) => x, 'gamma');
  assert.equal(withExtra.length, 2);
  assert.equal(withExtra[0].item, 'alpha beta');
  assert.ok(withExtra[0].score > withExtra[1].score);
});

test('chunking: section headings are carried and chunks stay small', () => {
  const chunks = docs.flatMap((d) => chunkDocument(d));
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.text.length <= 1000));
  const own = chunks.find((c) => /Avoid 50:50 ownership/.test(c.text));
  assert.equal(own.heading, 'Shareholder Strategy');
});

test('bestExcerpt returns a real, short excerpt from the text', () => {
  const text = docs[0].full_text;
  const terms = tokenizeQuery('lawyer advised against 50:50 deadlock');
  const ex = bestExcerpt(text, terms, 200);
  assert.ok(ex.length <= 200);
  assert.ok(/lawyer|deadlock/i.test(ex));
  assert.ok(squash(text).includes(squash(ex).replace(/…$/, '')));
});

test('chunks never cross a section heading (so the heading label is exact)', () => {
  for (const d of docs) {
    const heads = new Set(d.sections.map((x) => x.heading.toLowerCase()));
    for (const c of chunkDocument(d)) {
      const lines = c.text.split('\n');
      const headingLines = lines.map((l, i) => (heads.has(l.trim().toLowerCase()) ? i : -1)).filter((i) => i >= 0);
      assert.ok(headingLines.length === 0 || (headingLines.length === 1 && headingLines[0] === 0), `chunk of ${d.title} straddles sections`);
    }
  }
});
