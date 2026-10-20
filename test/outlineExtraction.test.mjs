import test from 'node:test';
import assert from 'node:assert/strict';
import { detectOutlineDocument, extractCollectionFrameworkRecords } from '../src/collectionExtraction.js';
import { FULL_TEXT_LIMIT, saveLimitNotice, withNotices } from '../src/extractionNotices.js';
import { splitClaim } from '../src/claim.js';

// INVENTED text only. Section names here are NOT in any built-in list, so they can only be found from the Word headings or the numbering.
const P = (...paras) => paras.join('\n\n');
const TEXT = P(
  'Receivables Field Guide (invented)',
  'Why invoices go late',
  '1.1 Unclear terms', 'Terms were never written down.',
  '1.2 No reminder', 'Nobody chased the invoice.', '1.3 Wrong contact', 'The bill went to the wrong person.',
  'Chasing politely',
  '2.1 Call first', 'Phone before you write.',
  '2.2 Write after', 'Confirm the call by email.', '2.3 Keep notes', 'Log every contact.',
  'Escalation ladder',
  '3.1 Manager call', 'A manager phones on day 45.',
  '3.2 Final notice', 'Send a final notice on day 60.', '3.3 Legal step', 'Refer to a lawyer after day 90.',
  'Quarterly review',
  'Review the ageing report every quarter and note which clients keep paying late.',
);
const html = (...hs) => hs.map((h) => `<h2>${h}</h2>`).join('') + '<p>x</p>';

test('headings from the Word file are used, whatever they are called', () => {
  const out = extractCollectionFrameworkRecords(TEXT, 'Field Guide',
    html('Why invoices go late', 'Chasing politely', 'Escalation ladder', 'Quarterly review'));
  assert.deepEqual(out.sections.map((s) => s.heading), ['Why invoices go late', 'Chasing politely', 'Escalation ladder', 'Quarterly review']);
  assert.equal(out.levers.length, 10); // 3 + 3 + 3 + 1 single
  const r = out.levers.find((x) => splitClaim(x.claim_en).name === 'Call first');
  assert.equal(r.section, 'Chasing politely');
  assert.equal(out.levers.find((x) => x.section === 'Quarterly review').claim_en.startsWith('Quarterly review:'), true);
});

test('without Word headings, the line before each numbered group is its heading', () => {
  const out = extractCollectionFrameworkRecords(TEXT, 'Field Guide');
  assert.deepEqual(out.sections.map((s) => s.heading), ['Why invoices go late', 'Chasing politely', 'Escalation ladder']);
  assert.equal(out.levers.length, 9);
  assert.ok(out.levers.every((r) => r.lever === 'ar_days'));
});

test('plain-text mode tells the person that headings were guessed', () => {
  const out = extractCollectionFrameworkRecords(TEXT, 'Field Guide');
  assert.ok(out.notices.some((n) => /heading styles/i.test(n.text)));
});

test('a numbered item that is not turned into a record is reported, not lost silently', () => {
  const odd = P('Receivables Field Guide', 'Chasing politely', '2.1 Call first', 'Phone before you write.', '2.2 Empty item', '2.3 Write after', 'Email it.');
  const out = extractCollectionFrameworkRecords(odd, 'Field Guide', html('Chasing politely', 'Other one', 'Third one'));
  assert.ok(out.notices.some((n) => /numbered/i.test(n.text)));
});

test('the gate: a collection outline is claimed, other documents are not', () => {
  assert.equal(detectOutlineDocument(TEXT, 'Field Guide'), true);
  assert.equal(detectOutlineDocument(TEXT.replace(/receivables|invoice/gi, 'thing'), 'Field Guide'), false); // wrong topic
  assert.equal(detectOutlineDocument('Collection notes\n\n1.1 One\n\n1.2 Two', 'x'), false); // too few items
  assert.equal(detectOutlineDocument(TEXT + '\n\nAnalysis\n\nMore.', 'Field Guide'), false); // a case study with an Analysis part
});

test('saveLimitNotice warns only when the text is longer than what is saved', () => {
  assert.deepEqual(saveLimitNotice('a'.repeat(FULL_TEXT_LIMIT)), []);
  const n = saveLimitNotice('a'.repeat(FULL_TEXT_LIMIT + 5));
  assert.equal(n.length, 1);
  assert.equal(n[0].level, 'warn');
  assert.match(n[0].text, /5 characters/);
});

test('withNotices appends without losing existing notices and leaves the input alone', () => {
  const base = { levers: [], notices: [{ level: 'info', text: 'a' }] };
  const out = withNotices(base, [{ level: 'warn', text: 'b' }]);
  assert.deepEqual(out.notices.map((n) => n.text), ['a', 'b']);
  assert.equal(base.notices.length, 1);
  assert.equal(withNotices(base, []), base);
  assert.equal(withNotices(null, [{ level: 'warn', text: 'b' }]), null);
});
