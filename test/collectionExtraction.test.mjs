import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCollectionFrameworkRecords } from '../src/collectionExtraction.js';
import { splitClaim } from '../src/claim.js';

// An INVENTED mini playbook with the same section names and shapes as the real one (no company text is stored in the repo).
const P = (...paras) => paras.join('\n\n');
const DOC = P(
  'Collection Playbook (invented)',
  'Executive Summary',
  'A short summary that must NOT become a record.',
  'Core Collection Mindset',
  '1.1 Own the follow-through', 'Keep going until a payment date is agreed.',
  '1.2 Ask early', 'Raise payment terms in the first meeting.',
  'Management Approach to Collection Performance (set target, investigate)',
  '2.1 MBO — Management by Objective (set clear targets)', 'For example:', 'Collection percentage target.', 'AR reduction target.',
  'Win the Internal War First',
  'Common internal problems include:', 'Teams blame each other.',
  'The internal war is won when:', 'Payment terms are clear.', 'Sales explains terms upfront.',
  'Current Collection Strategies Identified in YYC (service industry)',
  '4.1 Pay first, do later', 'Many teams ask for payment upfront.',
  '4.3 Advanced billing', 'Billing earlier helps cash flow. One team shared that billing earlier significantly improved collections.',
  'Opening a Collection Call',
  'Start gently.', 'A good call structure:', 'Greet the client.', 'Ask for a date.',
  'Profiling Debtors',
  'Suggested debtor profiles', 'Debtor Type', 'Behaviour', 'Recommended Approach',
  'Late payer', 'Always delays', 'Firm deadline',
  'Avoider', 'Does not answer', 'Visit and letter',
  'Handling Difficult Customers',
  'The company should handle difficult customers through:', 'Persistent calls.', 'Regular visits.',
  '14.1 Intensive Care Accounts', 'An account moves to Intensive Care if it is:', 'Large.', 'Long overdue.',
  'Different Types of Difficult Customers',
  '12.3 Customers giving thousand excuses', 'Example:', 'Client: “Cash flow is tight.”YYC: “How much can you pay today?”',
  'Recommended YYC Collection Excellence Framework',
  'Stage 1: Prevent', 'Clear engagement letter.', 'Advance payment.',
  'Stage 2: Track', 'Weekly ageing review.',
);

const out = extractCollectionFrameworkRecords(DOC, 'Invented Playbook');
const rec = (name) => out.levers.find((r) => splitClaim(r.claim_en).name === name);

test('collection playbook: every section is read, the title block and Executive Summary are not', () => {
  assert.equal(out.doc_type, 'framework');
  assert.deepEqual(out.sections.map((s) => s.heading), [
    'Core Collection Mindset', 'Management Approach to Collection Performance', 'Win the Internal War First',
    'Current Collection Strategies Identified in YYC (service industry)', 'Opening a Collection Call', 'Profiling Debtors',
    'Handling Difficult Customers', 'Different Types of Difficult Customers', 'Recommended YYC Collection Excellence Framework']);
  assert.ok(out.levers.every((r) => r.lever === 'ar_days'));
  assert.ok(!out.levers.some((r) => /must NOT become/.test(r.claim_en)));
  assert.equal(out.levers.length, 13); // 2 + 1 + 1 + 2 + 1 + 1 + 2 + 1 + 2
});

test('numbered items become records with the numbering and any acronym/parenthesis removed from the title', () => {
  assert.equal(rec('Own the follow-through').section, 'Core Collection Mindset');
  assert.equal(splitClaim(rec('Own the follow-through').claim_en).desc, 'Keep going until a payment date is agreed.');
  assert.ok(rec('Management by Objective'));
  assert.deepEqual(splitClaim(rec('Management by Objective').claim_en).desc.split('\n'), ['For example:', '• Collection percentage target.', '• AR reduction target.']);
});

test('"Win the Internal War First" keeps only the practices, as before', () => {
  const d = splitClaim(rec('Win the Internal War First').claim_en).desc;
  assert.ok(d.startsWith('The internal war is won when:'));
  assert.ok(d.includes('Payment terms are clear.') && d.includes('Sales explains terms upfront.'));
  assert.ok(!d.includes('Teams blame each other'));
});

test('an outcome sentence becomes the impact and is taken out of the description', () => {
  const r = rec('Advanced billing');
  assert.equal(r.impact, 'One team shared that billing earlier significantly improved collections.');
  assert.ok(!splitClaim(r.claim_en).desc.includes('One team shared'));
  assert.equal(rec('Pay first, do later').impact, 'N/A');
});

test('an unnumbered section is one record titled with the section name, with its list as bullets', () => {
  const r = rec('Opening a Collection Call');
  assert.equal(r.section, 'Opening a Collection Call');
  assert.deepEqual(splitClaim(r.claim_en).desc.split('\n'), ['Start gently.', 'A good call structure:', '• Greet the client.', '• Ask for a date.']);
});

test('a section with an introduction AND numbered items gives the introduction its own record', () => {
  assert.deepEqual(splitClaim(rec('Handling Difficult Customers').claim_en).desc.split('\n'), ['The company should handle difficult customers through:', '• Persistent calls.', '• Regular visits.']);
  const ic = rec('Intensive Care Accounts');
  assert.equal(ic.section, 'Handling Difficult Customers');
  assert.ok(splitClaim(ic.claim_en).desc.includes('• Long overdue.'));
});

test('a table becomes one record with one readable line per row', () => {
  const d = splitClaim(rec('Profiling Debtors').claim_en).desc.split('\n');
  assert.equal(d[0], 'Suggested debtor profiles (Debtor Type — Behaviour → Recommended Approach):');
  assert.deepEqual(d.slice(1), ['• Late payer — Always delays → Firm deadline', '• Avoider — Does not answer → Visit and letter']);
});

test('dialogue glued together by a soft line break is put back on separate plain lines', () => {
  const d = splitClaim(rec('Customers giving thousand excuses').claim_en).desc.split('\n');
  assert.deepEqual(d, ['Example:', 'Client: “Cash flow is tight.”', 'YYC: “How much can you pay today?”']);
});

test('the stages of the framework become one record each, written "Stage N - Name"', () => {
  const s1 = rec('Stage 1 - Prevent');
  assert.deepEqual(splitClaim(s1.claim_en).desc.split('\n'), ['• Clear engagement letter.', '• Advance payment.']);
  assert.equal(rec('Stage 2 - Track').section, 'Recommended YYC Collection Excellence Framework');
});

test('text with none of the playbook sections gives no records (it is not this kind of document)', () => {
  assert.equal(extractCollectionFrameworkRecords('Just some notes.\n\nNothing here.', 'x').levers.length, 0);
});
