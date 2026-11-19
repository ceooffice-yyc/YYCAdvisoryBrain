import test from 'node:test';
import assert from 'node:assert/strict';
import { leverHeadingOf, leverFromHeading } from '../src/pipeline/headings.js';
import { normalizeParas } from '../src/pipeline/extract.js';

// The parsing rules are ordinary modules (src/pipeline/); all text here is invented.
const f = { leverHeadingOf, leverFromHeading, normalizeParas };

const P = (...paras) => paras.join('\n\n');

test('"AP (Payables)" is a heading for the payable-days lever, not a strategy title', () => {
  assert.equal(f.leverHeadingOf('AP (Payables)'), 'AP (Payables)');
  assert.equal(f.leverFromHeading('AP (Payables)'), 'ap_days');
  assert.equal(f.leverHeadingOf('Volume (units sold)'), 'Volume (units sold)');
  const out = f.normalizeParas(P('AP (Payables)', 'Negotiate supplier terms: The founder asked the factory to fund the first run and pay later.'));
  assert.ok(out.some((p) => p.startsWith('Negotiate supplier terms:')), 'the strategy keeps its own title');
  assert.ok(!out.some((p) => p.startsWith('AP (Payables):')), 'the heading is not merged into the strategy');
});

test('numbered "Title: text" strategies one after another all survive', () => {
  const body = P(
    'Talent Strategy',
    '1. Choose a partner with complementary strengths: One founder led design while the other led finance and operations.',
    '2. Allocate work by strength: Each founder spent their time where they were best.',
    'Shareholder Strategy',
    '1. Find partners who think long term: Both founders shared the mindset that they win or lose together.',
    '2. Choose investors who back the vision: Many investors said no before one understood the idea.',
    '3. Keep control with a majority investor: The founders kept two of three board seats.',
  );
  const out = f.normalizeParas(body);
  for (const t of ['1. Choose a partner', '2. Allocate work', '1. Find partners', '2. Choose investors', '3. Keep control']) assert.ok(out.some((p) => p.startsWith(t)), `${t} was dropped`);
});

test('a numbered group heading with no colon of its own is still not a strategy', () => {
  const out = f.normalizeParas(P('Pricing', 'Intro text for the section.', '1. Understand the Business Well', 'First tip: Know the numbers before you talk to the customer about them.'));
  assert.ok(!out.some((p) => p === '1. Understand the Business Well'), 'the group heading is dropped');
  assert.ok(out.some((p) => p.startsWith('First tip:')));
});

test('a one-word label above its description is a title under Product Differentiation', () => {
  const out = f.normalizeParas(P(
    'Unique Product Differentiation', 'Differentiation',
    'Fit', 'Moved away from boxy one-size-fits-all products and created more tailored fits for every customer group in the market.',
    'Comfort & Fabric Quality', 'Built the product around technical comfort using softer stretchable fabrics instead of standard off-the-shelf materials for daily work.',
    'Functionality', 'Designed around how the customers actually work, including pocket placement and where they carry their tools during a long shift.',
  ));
  for (const t of ['Fit: Moved away', 'Comfort & Fabric Quality: Built', 'Functionality: Designed']) assert.ok(out.some((p) => p.startsWith(t)), `${t} was not paired`);
});
