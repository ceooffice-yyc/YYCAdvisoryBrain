import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCompilation, planSplit, buildClassifyPrompt, readClassification, buildCardExtraction } from '../src/compilationSplit.js';
import { splitClaim } from '../src/claim.js';

// All text here is INVENTED; no company document is stored in the repo.
const P = (...x) => x.join('\n\n');
const story = (n, name, ind, strategy, result) => [`${n}. ${name} (${ind})`, `Problem: ${name} could not grow.`, `Key Strategy: ${strategy}`, `Formula/Theory: Some idea about ${name}.`, ...(result ? [`Result: ${result}`] : [])];
const FILE = P(
  ...story(1, 'Acme Bakery', 'Food', 'Bake early — sell out by noon and never discard stock', 'Waste fell by half.'),
  ...story(2, 'Borg Tools', 'Hardware', 'Charge for delivery to filter small orders; keep margins whole', ''),
  ...story(3, 'Cato Clinics', 'Healthcare', 'Rebook every patient before they leave the desk', 'Utilisation reached 95%.'),
  ...story(4, 'Dune Retail', 'Retail', 'Rank products by cash they return and drop the slow ones', ''),
);
const LEVERS = { leverIds: ['price', 'volume', 'talent_strategy', 'others'], otherCats: ['business_model_execution', 'uncategorized'] };

test('a file of separate stories with the same labels is offered for splitting, one card per story', () => {
  assert.equal(detectCompilation(FILE).level, 'strong');
  const plan = planSplit(FILE);
  assert.equal(plan.cards.length, 4);
  assert.deepEqual(plan.cards.map((c) => c.title), ['Acme Bakery (Food)', 'Borg Tools (Hardware)', 'Cato Clinics (Healthcare)', 'Dune Retail (Retail)']);
  assert.equal(plan.intro, '');
});

test('the cut is lossless: the cards joined together are the file, word for word', () => {
  const plan = planSplit(FILE);
  assert.equal([plan.intro, ...plan.cards.map((c) => c.text)].filter(Boolean).join('\n\n'), FILE);
});

test('text before the first story is kept aside and reported, not silently dropped', () => {
  const plan = planSplit(P('A short introduction to the collection.', FILE));
  assert.equal(plan.cards.length, 4);
  assert.equal(plan.intro, 'A short introduction to the collection.');
  const ex = buildCardExtraction({ card: plan.cards[0], total: 4, parentTitle: 'Stories', classification: null, intro: plan.intro });
  assert.ok(ex.notices.some((n) => /introduction/i.test(n.text)));
  assert.ok(!buildCardExtraction({ card: plan.cards[1], total: 4, parentTitle: 'Stories', classification: null, intro: plan.intro }).notices.some((n) => /introduction/i.test(n.text)));
});

test('things that are NOT a collection are left alone', () => {
  // sections of one document with an "Actual Impact:" in each
  const oneStudy = P(...['Pricing', 'Volume', 'Overhead', 'Inventory'].flatMap((n) => [n, 'Fair prices: we kept prices steady.', 'Actual Impact: margin rose.']));
  assert.equal(planSplit(oneStudy, ['Pricing', 'Volume', 'Overhead', 'Inventory'].map((n) => `<h1>${n}</h1>`).join('')), null);
  // years of one company
  assert.equal(detectCompilation(P(...['Year 1', 'Year 2', 'Year 3', 'Year 4'].flatMap((y) => [y, 'Problem: cash was tight.', 'Key Strategy: tighter terms.'])), ['Year 1', 'Year 2', 'Year 3', 'Year 4'].map((y) => `<h1>${y}</h1>`).join('')).level, 'none');
  // different kinds of numbered sections
  assert.equal(detectCompilation(P('1. Company Background', 'It began in 1990.', '2. The Market', 'Prices vary: they fell.', '3. Acquisition Criteria', 'Size matters.', '4. Summary', 'Buy small.')).level, 'none');
  // only two stories
  assert.equal(planSplit(P(...story(1, 'Acme', 'Food', 'Bake early', ''), ...story(2, 'Borg', 'Tools', 'Deliver late', ''))), null);
});

test('Word headings alone do not make a collection, but headings plus the same labels do', () => {
  const html = ['Acme', 'Borg', 'Cato'].map((n) => `<h1>${n}</h1>`).join('');
  const labelled = P(...['Acme', 'Borg', 'Cato'].flatMap((n) => [n, `Problem: ${n} was stuck.`, `Key Strategy: ${n} changed its pricing today.`]));
  assert.equal(detectCompilation(labelled, html).level, 'strong');
  const prose = P(...['Acme', 'Borg', 'Cato'].flatMap((n) => [n, `${n} grew a lot over the years by serving customers better and better.`]));
  assert.notEqual(detectCompilation(prose, html).level, 'strong');
});

test('a collection whose stories code cannot read (no "Key Strategy:" field) is not offered, so normal extraction handles it', () => {
  const noField = P(...['Acme', 'Borg', 'Cato'].flatMap((n, k) => [`${k + 1}. ${n} Group`, `Challenge: ${n} was stuck.`, `Approach: ${n} changed course.`, `Outcome: ${n} grew.`]));
  assert.equal(detectCompilation(noField).level, 'strong');
  assert.equal(planSplit(noField), null);
});

test('each card builds the same kind of extraction the normal path returns, with exact title, description and result', () => {
  const plan = planSplit(FILE);
  const cls = { lever: 'volume', other_category: '', related_to: '', industry_main: 'Food', industry_sub: 'Bakery', guessed: true };
  const ex = buildCardExtraction({ card: plan.cards[0], total: 4, parentTitle: 'Stories file', classification: cls, intro: '' });
  assert.equal(ex.title, 'Acme Bakery (Food)');
  assert.equal(ex.doc_type, 'case_study');
  assert.equal(ex.industry, 'Bakery (Food)');
  assert.equal(ex.levers.length, 1);
  assert.deepEqual(splitClaim(ex.levers[0].claim_en), { name: 'Bake early', desc: 'sell out by noon and never discard stock' });
  assert.equal(ex.levers[0].impact, 'Waste fell by half.');
  assert.equal(ex.levers[0].lever, 'volume');
  assert.equal(ex.levers[0].section, 'Acme Bakery (Food)');
  assert.ok(ex.sections.some((s) => s.heading === 'Source' && /Story 1 of 4/.test(s.summary_en) && /Stories file/.test(s.summary_en)));
  assert.equal(ex.problem_signature, 'Acme Bakery could not grow.');
  assert.ok(!ex.notices.some((n) => n.level === 'warn'));
  assert.equal(buildCardExtraction({ card: plan.cards[1], total: 4, parentTitle: 'x', classification: cls }).levers[0].impact, 'N/A'); // no Result field
});

test('without a classification the card lands under Others with a clear warning (the AI call failed)', () => {
  const ex = buildCardExtraction({ card: planSplit(FILE).cards[2], total: 4, parentTitle: 'x', classification: null });
  assert.equal(ex.levers[0].lever, 'others');
  assert.equal(ex.levers[0].other_category, 'uncategorized');
  assert.ok(ex.notices.some((n) => n.level === 'warn' && /lever or industry/.test(n.text)));
  assert.equal(ex.industry_sub, 'Healthcare'); // the bracket in the heading is the fallback
});

test('the classification question lists every story once, and the answer is read defensively', () => {
  const cards = planSplit(FILE).cards;
  const prompt = buildClassifyPrompt(cards, { leverLines: ['- price: pricing', '- volume: volume'], otherCats: LEVERS.otherCats, otherCatDefs: '' });
  for (const c of cards) assert.ok(prompt.includes(c.title));
  assert.match(prompt, /^0\. Acme Bakery/m);
  assert.match(prompt, /^3\. Dune Retail/m);
  const out = readClassification({ items: [
    { i: 0, lever: 'volume', industry_main: 'Food', industry_sub: 'Bakery' },
    { i: 1, lever: 'made_up_lever' },                                   // not a lever we have: stays Others
    { i: 2, lever: 'others', other_category: 'not_a_category', related_to: 'one two three four five six seven eight nine ten' },
    { i: 99, lever: 'price' },                                           // no such story: ignored
  ] }, cards, LEVERS);
  assert.equal(out[0].lever, 'volume');
  assert.equal(out[0].guessed, true);
  assert.equal(out[1].lever, 'others');
  assert.equal(out[1].guessed, false);
  assert.equal(out[2].other_category, 'uncategorized');
  assert.equal(out[2].related_to.split(' ').length, 8);
  assert.equal(out[3].guessed, false); // the model skipped it
  assert.equal(readClassification(null, cards.slice(0, 2), LEVERS).length, 2); // a broken answer gives a safe default for every card
});

test('the question asks for a title per strategy sentence, in the same call', () => {
  const prompt = buildClassifyPrompt(planSplit(FILE).cards, { leverLines: ['- price: pricing'], otherCats: LEVERS.otherCats, otherCatDefs: '' });
  assert.match(prompt, /strategy 1: Bake early/);
  assert.match(prompt, /"titles":\[/);
});

test('an AI title is used with the WHOLE original sentence; a title that does not fit its sentence is thrown away and the old split is the fallback', () => {
  const cards = planSplit(FILE).cards;
  const cls = readClassification({ items: [
    { i: 0, lever: 'volume', titles: ['Sell out by noon daily'] },                                                   // fits (shares "noon", "sell")
    { i: 1, lever: 'price', titles: ['Great growth plan'] },                                                           // shares no word with the sentence
    { i: 2, lever: 'price', titles: ['Rebook every patient before they leave the desk'] },                             // just the whole sentence
    { i: 3, lever: 'price', titles: ['Strategy'] },                                                                    // one word
  ] }, cards, LEVERS);
  assert.deepEqual(cls.map((c) => c.titles), [['Sell out by noon daily'], [''], [''], ['']]);
  const ex = buildCardExtraction({ card: cards[0], total: 4, parentTitle: 'x', classification: cls[0] });
  assert.deepEqual(splitClaim(ex.levers[0].claim_en), { name: 'Sell out by noon daily', desc: 'Bake early — sell out by noon and never discard stock' }); // description = the sentence, nothing cut
  const fb = buildCardExtraction({ card: cards[1], total: 4, parentTitle: 'x', classification: cls[1] });
  assert.equal(splitClaim(fb.levers[0].claim_en).name, 'Charge for delivery to filter small orders'); // fallback: the code's own split
});

test('a story with two Key Strategy lines stays ONE record that keeps both sentences (nothing is lost), and gets one title', () => {
  const two = P('1. Acme (Food)', 'Problem: Slow.', 'Key Strategy: Bake early to sell out daily.', 'Key Strategy: Hire local drivers for faster delivery.', '2. Borg (Hardware)', 'Problem: Late.', 'Key Strategy: Charge for delivery on small orders.', '3. Cato (Health)', 'Problem: Idle.', 'Key Strategy: Rebook every patient at the desk.');
  const plan = planSplit(two);
  assert.deepEqual(plan.cards.map((c) => c.records.length), [1, 1, 1]);
  assert.ok(/Bake early to sell out daily/.test(plan.cards[0].records[0].strategy) && /Hire local drivers for faster delivery/.test(plan.cards[0].records[0].strategy));
  const cls = readClassification({ items: [{ i: 0, lever: 'volume', titles: ['Dawn ovens fuel sales'] }, { i: 1, lever: 'price', titles: ['Delivery fees on small orders'] }] }, plan.cards, LEVERS);
  assert.deepEqual(cls.map((c) => c.titles), [[''], ['Delivery fees on small orders'], ['']]); // an unrelated title is refused, a fitting one kept, a missing one stays empty
});
