import test from 'node:test';
import assert from 'node:assert/strict';
import { splitStrategy, tidyDescription, parseSummaryStrategyCards, restoreSummaryStrategyCards, usableTitle } from '../src/summaryCardExtraction.js';
import { splitClaim } from '../src/claim.js';

// Invented sentences with the same SHAPES as real "Key Strategy" lines (so no company content is stored in the repo).
const SENTENCES = [
  'Open a second warehouse — cut delivery time to one day; hire local drivers.',
  'Price the premium line at a 20% markup; test it in two cities first.',
  'Build a regional distribution hub funded by two retail partners, focused on speed and returns; exit within five years.',
  'Review the price list monthly, not yearly.',
  'Train every new hire on the customer promise, owned by the store manager.',
  'Rebuild the whole costing model around per-unit economics and let the team redesign each "recipe."',
  'Standardise supplier onboarding documentation checklists across every regional office immediately.',
  'Maintain detailed regional performance dashboards covering all the markets daily.',
  'Pay suppliers faster.',
];

test('title rule: a natural separator after a short lead becomes the cut, and the separator is dropped', () => {
  assert.deepEqual(splitStrategy(SENTENCES[0]), { title: 'Open a second warehouse', description: 'cut delivery time to one day; hire local drivers.' });
  assert.deepEqual(splitStrategy(SENTENCES[1]), { title: 'Price the premium line at a 20% markup', description: 'test it in two cities first.' });
});

test('title rule: a long sentence is cut at a joining word, not left as one giant title', () => {
  const r = splitStrategy(SENTENCES[2]);
  assert.equal(r.title, 'Build a regional distribution hub');
  assert.equal(r.description, 'funded by two retail partners, focused on speed and returns; exit within five years.');
  const q = splitStrategy(SENTENCES[5]);
  assert.equal(q.title, 'Rebuild the whole costing model around per-unit economics');
  assert.equal(q.description, 'and let the team redesign each "recipe."'); // quote marks stay balanced and attached to their words
  assert.equal(splitStrategy(SENTENCES[6]).title, 'Standardise supplier onboarding documentation checklists');
});

test('title rule: commas, short sentences and the last-resort cut', () => {
  assert.deepEqual(splitStrategy(SENTENCES[4]), { title: 'Train every new hire on the customer promise', description: 'owned by the store manager.' });
  assert.deepEqual(splitStrategy(SENTENCES[3]), { title: 'Review the price list monthly, not yearly', description: '' }); // 7 words: the whole sentence is the title
  assert.deepEqual(splitStrategy(SENTENCES[8]), { title: 'Pay suppliers faster', description: '' });
  const last = splitStrategy(SENTENCES[7]);
  assert.ok(!/\b(the|of|and|a)$/i.test(last.title), `title must not end on a filler word: ${last.title}`);
});

test('every title is short, non-empty, free of trailing punctuation, and every description is free of leading punctuation', () => {
  for (const s of SENTENCES) {
    const { title, description } = splitStrategy(s);
    assert.ok(title.length > 0, s);
    assert.ok(title.split(/\s+/).length <= 10, `title too long: ${title}`);
    assert.ok(!/[.,;:—–-]$/.test(title), `title ends in punctuation: ${title}`);
    assert.ok(!/^[\s;:,.—–-]/.test(description), `description starts with punctuation: ${description}`);
  }
});

test('no word is lost: title + description contain every word of the sentence, in order', () => {
  const squash = (s) => s.toLowerCase().replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const s of SENTENCES) {
    const { title, description } = splitStrategy(s);
    assert.equal(squash(`${title} ${description}`), squash(s), s);
  }
});

test('tidyDescription removes separators, lone punctuation lines and stray quote marks', () => {
  assert.equal(tidyDescription('; understand what you actually sell.'), 'understand what you actually sell.');
  assert.equal(tidyDescription('— become the best company to work for.'), 'become the best company to work for.');
  assert.equal(tidyDescription('.'), '');
  assert.equal(tidyDescription('"'), '');
  assert.equal(tidyDescription('first part\n.\nsecond part'), 'first part second part');
});

const DOC = [
  '1. Alpha Co (Retail)', '', 'Problem: Sales were flat.', '', 'Key Strategy: Open a second warehouse — cut delivery time to one day; hire local drivers.', '',
  'Formula/Theory: Speed sells.', '', 'Result: Sales up 30% in a year.', '',
  '2. Beta Ltd (Services)', '', 'Problem: Late payers.', '', 'Key Strategy: Pay suppliers faster.', '', 'Result: N/A',
].join('\n');

test('cards: one per Key Strategy, with a short title, a clean description and the Result as impact', () => {
  const cards = parseSummaryStrategyCards(DOC);
  assert.equal(cards.length, 2);
  assert.deepEqual([cards[0].heading, cards[0].title, cards[0].description, cards[0].impact], ['Alpha Co (Retail)', 'Open a second warehouse', 'cut delivery time to one day; hire local drivers.', 'Sales up 30% in a year.']);
  assert.deepEqual([cards[1].title, cards[1].description], ['Pay suppliers faster', '']);
});

test('restore: the model keeps its lever, a good short title from the model is used, a bad one is replaced by the code split', () => {
  const cards = parseSummaryStrategyCards(DOC);
  const model = [
    { lever: 'others', other_category: 'operations_process', section: 'Alpha Co (Retail)', claim_en: 'Open a second warehouse: — cut delivery time to one day; hire local drivers.', impact: 'x' },
    // the model returned the whole sentence as its title: not acceptable, the code's split is used instead
    { lever: 'ap_days', section: 'Beta Ltd (Services)', claim_en: 'Pay suppliers faster and keep every single supplier happy forever more: ', impact: 'N/A' },
  ];
  const out = restoreSummaryStrategyCards(model, cards);
  assert.equal(out[0].lever, 'others'); assert.equal(out[0].other_category, 'operations_process');
  assert.deepEqual(splitClaim(out[0].claim_en), { name: 'Open a second warehouse', desc: 'cut delivery time to one day; hire local drivers.' });
  assert.equal(out[0].impact, 'Sales up 30% in a year.');
  assert.equal(out[1].lever, 'ap_days');
  assert.deepEqual(splitClaim(out[1].claim_en), { name: 'Pay suppliers faster', desc: '' }); // "Title:" with nothing after it is a title-only record
});

test('restore: a card the model missed still becomes a record (never lost), under a safe default lever', () => {
  const out = restoreSummaryStrategyCards([], parseSummaryStrategyCards(DOC));
  assert.equal(out.length, 2);
  assert.ok(out.every((r) => r.lever === 'others' && splitClaim(r.claim_en).name));
});

test('usableTitle: a short label that shares a real word with its sentence is kept, anything else is refused', () => {
  const s = 'Open a second warehouse — cut delivery time to one day; hire local drivers.';
  assert.equal(usableTitle('Faster delivery with local drivers', s), 'Faster delivery with local drivers');
  assert.equal(usableTitle('"Faster delivery."', s), 'Faster delivery');                 // quotes and a final full stop are tidied
  assert.equal(usableTitle('Key Strategy: Second warehouse for speed', s), 'Second warehouse for speed');
  assert.equal(usableTitle('Great growth plan', s), '');                                 // about nothing in the sentence
  assert.equal(usableTitle('Strategy', s), '');                                          // one word
  assert.equal(usableTitle('Open a second warehouse cut delivery time to one day hire local drivers', s), ''); // the whole sentence
  assert.equal(usableTitle('One two three four five six seven eight nine ten eleven warehouse', s), ''); // too long to be a title
  assert.equal(usableTitle('', s), '');
});

test('restore: a label the model WROTE is used with the whole original sentence as the description (nothing cut, nothing dropped)', () => {
  const cards = parseSummaryStrategyCards(DOC);
  const out = restoreSummaryStrategyCards([
    { lever: 'volume', section: 'Alpha Co (Retail)', claim_en: 'Faster delivery with a second warehouse: a model-written description that is ignored', impact: 'x' },
    { lever: 'ap_days', section: 'Beta Ltd (Services)', claim_en: 'Quicker supplier payment: whatever', impact: 'N/A' },
  ], cards);
  assert.deepEqual(splitClaim(out[0].claim_en), { name: 'Faster delivery with a second warehouse', desc: 'Open a second warehouse — cut delivery time to one day; hire local drivers.' });
  assert.deepEqual(splitClaim(out[1].claim_en), { name: 'Quicker supplier payment', desc: 'Pay suppliers faster.' });
  assert.equal(out[0].lever, 'volume');
  assert.equal(out[0].impact, 'Sales up 30% in a year.');
});

test('restore: a label that is only the sentence\'s own opening words does not repeat them in the description', () => {
  const out = restoreSummaryStrategyCards([{ lever: 'volume', section: 'Alpha Co (Retail)', claim_en: 'Open a second warehouse: x', impact: '' }], parseSummaryStrategyCards(DOC));
  assert.deepEqual(splitClaim(out[0].claim_en), { name: 'Open a second warehouse', desc: 'cut delivery time to one day; hire local drivers.' });
});
