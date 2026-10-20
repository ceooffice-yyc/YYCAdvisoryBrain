import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { splitClaim } from '../src/claim.js';

// The pipeline lives inside src/App.jsx (a React file), so these tests load its pure functions straight from that file; all text here is invented, no company document is stored in the repo.
const src = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const from = src.indexOf('/* ---------- extraction pipeline');
const to = src.indexOf('async function extractDocument');
assert.ok(from >= 0 && to > from, 'could not find the extraction pipeline section in src/App.jsx');
const f = new Function('splitClaim', [
  'let EXTRA_HEADING_LEVER = [];',
  src.slice(from, to).replace(/export\s*$/, ''),
  'return { leverHeadingOf, leverFromHeading, mnaSectionKind, detectMnaDocument, scopeMnaSections, structureMnaParas, mnaNumberedKinds, normalizeParas, findStrategyParas, findSupportGroups, foldSupportGroups };',
].join('\n'))(splitClaim);

const P = (...paras) => paras.join('\n\n');
const GAP = '\n\n\n\n\t\n\n'; // what a Word file leaves between two groups: an empty paragraph
const MNA = P(
  'Acme – M&A Strategy Summary',
  '1. Company Background', 'Acme is an invented serial acquirer.',
  '3. M&A Appetite & Capital Allocation',
  '3.1 Small, Established Businesses', 'Acme typically buys small businesses:', 'US$10 million sales on average', 'Targets are often family owned.',
  '3.2 Disciplined Valuation', 'Acme does not chase deals at any price.', 'Target multiple: approximately 8× EBITDA', 'Average paid: approximately 7× EBITDA',
  '4. Acquisition Criteria',
  '4.1 Stable Operations', 'The business should have a stable history.',
  '4.2 Niche Leadership', 'Acme buys the best company in a narrow market.',
  '5. Post-Acquisition Strategy',
  '5.1 Decentralised Operations', 'Acme leaves management in place while they perform.',
  '6. What Acme Provides to Acquired Companies',
  '6.1 Permanent Ownership', 'Owners gain a long-term home for the company.',
  '6.2 Operational Independence', 'Acquired companies keep operating as before.',
  "Acme's M&A Model in One Line", 'Buy small niche leaders and hold them.',
);

test('M&A headings: a longer "Appetite" heading and "Provides to" are recognised, ordinary headings are not', () => {
  assert.equal(f.mnaSectionKind('3. M&A Appetite & Capital Allocation'), 'appetite');
  assert.equal(f.mnaSectionKind('6. What Acme Provides to Acquired Companies'), 'company_support');
  assert.equal(f.mnaSectionKind('6. What Acme Brings to Acquired Companies'), 'company_support'); // the wording that already worked
  assert.equal(f.mnaSectionKind('4. Acquisition Criteria'), 'criteria');
  assert.equal(f.mnaSectionKind('5. Post-Acquisition Strategy'), 'post_acquisition');
  assert.equal(f.mnaSectionKind('Pricing'), '');
  assert.equal(f.mnaSectionKind('Market appetite for snacks'), '');
});

test('M&A scope keeps every section from 3 to 6 and drops the background and the closing recap', () => {
  assert.equal(f.detectMnaDocument(MNA, 'Acme'), true);
  const body = f.scopeMnaSections(MNA).body;
  for (const h of ['3. M&A Appetite & Capital Allocation', '4. Acquisition Criteria', '5. Post-Acquisition Strategy', '6. What Acme Provides to Acquired Companies']) assert.ok(body.includes(h), h);
  assert.ok(body.includes('6.2 Operational Independence'));
  assert.ok(!body.includes('invented serial acquirer'));
  assert.ok(!body.includes('Buy small niche leaders'));
});

test('numbered items lose ALL of their numbering and keep their short "Label: value" lines inside', () => {
  const s = f.structureMnaParas(f.scopeMnaSections(MNA).body);
  const titles = s.map((p) => p.split(':')[0]);
  assert.ok(titles.includes('Disciplined Valuation') && titles.includes('Permanent Ownership') && titles.includes('Stable Operations'));
  assert.ok(!s.some((p) => /^\d/.test(p) && !/^\d+\./.test(p)), 'a title still starts with a stray number like "2 Title"');
  const valuation = s.find((p) => p.startsWith('Disciplined Valuation:'));
  assert.ok(valuation.includes('Target multiple: approximately 8× EBITDA') && valuation.includes('Average paid: approximately 7× EBITDA'));
  assert.ok(!s.some((p) => p.startsWith('Target multiple:')), 'a multiple became a strategy of its own');
});

test('a section of titled items is not folded into one record; an untitled list still is', () => {
  assert.ok(f.mnaNumberedKinds(f.scopeMnaSections(MNA).body).has('company_support'));
  const untitled = P('What Acme Brings to Acquired Companies', 'Acme provides:', 'Capital', 'Advice', 'Contacts');
  assert.equal(f.mnaNumberedKinds(untitled).has('company_support'), false);
});

test('Product Differentiation: a label keeps its own lines, each separate differentiator is its own strategy', () => {
  const doc = P('Analysis', 'Pricing', 'Smart fees: Fees filter small orders.', 'Product Differentiation',
    'Packaging', 'Colourful and playful', 'Some bags are transparent')
    + GAP + P('Selling high quality and fresh products', 'Fast delivery (within 1-2 days)', 'Personalised shopping experience (recipes, storage tips and more information for the shopper)',
    'Other Key Strategies for Growth', 'Spot odd orders: Staff noticed unusual orders and investigated them.');
  const norm = f.normalizeParas(doc);
  assert.ok(norm.includes('Packaging: Colourful and playful\nSome bags are transparent'), 'the label takes only its own group');
  assert.ok(norm.includes('Selling high quality and fresh products: Selling high quality and fresh products'));
  assert.ok(norm.includes('Fast delivery: within 1-2 days'));
  assert.ok(norm.some((p) => p.startsWith('Personalised shopping experience: recipes, storage tips')));
  const titles = f.findStrategyParas(norm.join('\n\n')).map((x) => x.title);
  for (const t of ['Packaging', 'Fast delivery', 'Spot odd orders']) assert.ok(titles.includes(t), t);
});

test('the same layout under another heading is left alone', () => {
  const doc = P('Analysis', 'Pricing', 'Packaging', 'Colourful and playful', 'Some bags are transparent');
  assert.ok(!f.normalizeParas(doc).some((p) => p.startsWith('Packaging:')));
});

test('a numbered strategy, its intro sentence and labelled points are ONE strategy; a plain group heading is not touched', () => {
  const doc = P('Analysis', 'Talent Strategy',
    '1. Lean into Strengths (Letting Go of Weaknesses)',
    'The founder saw that scaling needs different leadership styles at different phases, and that founders often bottleneck growth:',
    'Recognizing Strengths: He focused on what he does best.', 'Stepping Down: He became Chairman and hired a professional CEO.',
    'Other Key Strategies for Growth',
    '1.Understand the Business Well', 'Know the numbers: Review the figures every week.');
  const norm = f.normalizeParas(doc);
  const one = norm.find((p) => p.startsWith('Lean into Strengths (Letting Go of Weaknesses): '));
  assert.ok(one && one.includes('Recognizing Strengths: He focused') && one.includes('Stepping Down: He became Chairman'));
  assert.ok(norm.includes('Know the numbers: Review the figures every week.'), 'a plain group heading is still dropped and its child kept');
  const found = f.findStrategyParas(norm.join('\n\n'));
  assert.deepEqual(found.map((x) => x.title).filter((t) => /Lean|Recogn|Stepping/.test(t)), ['Lean into Strengths (Letting Go of Weaknesses)']);
});

test('if the model still returns the supporting points as records, they are folded into the one numbered strategy', () => {
  const body = P('Talent Strategy', '1. Lean into Strengths', 'He recognised that founders often bottleneck growth by doing everything himself:',
    'Recognizing Strengths: He focused on what he does best.', 'Stepping Down: He hired a professional CEO.');
  const groups = f.findSupportGroups(body);
  assert.equal(groups.length, 1);
  const rec = (name, desc, impact = 'N/A') => ({ lever: 'talent_strategy', claim_en: `${name}: ${desc}`, impact });
  // only the points came back: one record with the numbered title
  let out = f.foldSupportGroups([rec('Recognizing Strengths', 'He focused.'), rec('Stepping Down', 'He hired.', 'Profit doubled.')], groups);
  assert.equal(out.length, 1);
  assert.equal(splitClaim(out[0].claim_en).name, 'Lean into Strengths');
  assert.equal(out[0].impact, 'Profit doubled.');
  // the parent came back as well: the points are removed, unrelated records stay
  out = f.foldSupportGroups([rec('Lean into Strengths', 'x'), rec('Stepping Down', 'He hired.'), rec('Other thing', 'y')], groups);
  assert.deepEqual(out.map((l) => splitClaim(l.claim_en).name), ['Lean into Strengths', 'Other thing']);
});

test('a sentence ending in a colon is not mistaken for a "growth" heading, a real one still is', () => {
  assert.equal(f.leverHeadingOf('Its growth model therefore combines:'), null);
  assert.ok(f.leverHeadingOf('Additional Cash & Growth Strategies:'));
});
