import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStrategy, formatAnswer, markdownToPlain } from '../src/lib/copy.js';
import { copyText } from '../src/lib/clipboard.js';

// UX-01: what is copied reads well in an email, and copying never fails silently. All text here is invented.
const BASE = 'https://example.test/';

test('a strategy is copied with its impact, its lever, its source and a link', () => {
  const text = formatStrategy({ claim_en: 'Smart fees: A small fee filters tiny orders.', impact: 'Orders stayed level.', lever: 'price', doc_id: 'd1', doc_title: 'Acme Bakery', section: 'Pricing' }, { leverName: 'Price', base: BASE });
  assert.equal(text, [
    'Smart fees: A small fee filters tiny orders.',
    'Actual impact: Orders stayed level.',
    'Lever: Price · Source: Acme Bakery (Pricing)',
    'Link: https://example.test/#/library?doc=d1&section=Pricing',
  ].join('\n'));
});

test('"N/A" and empty impact are left out, and a record with little data still copies what it has', () => {
  assert.ok(!formatStrategy({ claim_en: 'X: y.', impact: 'N/A', lever: 'price', doc_id: 'd1' }, { base: BASE }).includes('Actual impact'));
  assert.ok(!formatStrategy({ claim_en: 'X: y.', impact: '', lever: 'price' }, { base: BASE }).includes('Link:'), 'no document, no link');
  assert.equal(formatStrategy({ claim_en: 'Only this.' }, { base: BASE }), 'Only this.');
  assert.ok(formatStrategy({ claim_en: 'X: y.', lever: 'others', related_to: 'Pricing' }, { base: BASE }).includes('Related to: Pricing'));
});

test('light markdown is turned into plain text for pasting', () => {
  assert.equal(markdownToPlain('## Heading\n\n**Bold** text\n\n- one\n* two\n\n\n\nend'), 'Heading\n\nBold text\n\n• one\n• two\n\nend');
  assert.equal(markdownToPlain(null), '');
});

test('an answer is copied with the question and its sources, each source once', () => {
  const text = formatAnswer({
    question: 'How did the bakery handle delivery fees?',
    answer: 'It added a **small fee**.\n- kept menu prices',
    citations: [{ doc_id: 'd1', doc_title: 'Acme Bakery', section: 'Pricing' }, { doc_id: 'd1', doc_title: 'Acme Bakery', section: 'Pricing' }, { doc_id: 'd2', section: '' }, { nothing: true }],
    titleOf: (id) => ({ d2: 'Northwind Clinics' })[id], base: BASE,
  });
  assert.equal(text, [
    'Question: How did the bakery handle delivery fees?',
    'It added a small fee.\n• kept menu prices',
    'Sources:\n• Acme Bakery (Pricing): https://example.test/#/library?doc=d1&section=Pricing\n• Northwind Clinics: https://example.test/#/library?doc=d2',
  ].join('\n\n'));
  assert.ok(!formatAnswer({ answer: 'No sources here.', base: BASE }).includes('Sources'));
});

// ── copyText and its fallbacks, with a stand-in browser ──
const setup = ({ api, legacy, hasDocument = true }) => {
  const events = [];
  const old = Object.fromEntries(['navigator', 'document', 'window', 'CustomEvent'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  def('CustomEvent', class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } });
  def('window', { dispatchEvent: (e) => { events.push(e); return true; } });
  def('navigator', api ? { clipboard: { writeText: api } } : {});
  def('document', hasDocument ? { body: { appendChild() {}, }, createElement: () => ({ style: {}, setAttribute() {}, select() {}, setSelectionRange() {}, parentNode: null }), execCommand: () => { if (legacy === 'throw') throw new Error('no'); return legacy; } } : undefined);
  const restore = () => { for (const [k, d] of Object.entries(old)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } };
  return { events, restore };
};

test('copyText uses the clipboard and says so with a toast', async () => {
  const written = [];
  const { events, restore } = setup({ api: async (t) => { written.push(t); } });
  try {
    assert.equal(await copyText('hello', 'Copied!'), 'copied');
    assert.deepEqual(written, ['hello']);
    assert.deepEqual(events.map((e) => [e.type, e.detail.msg, e.detail.kind]), [['yyc-toast', 'Copied!', 'ok']]);
  } finally { restore(); }
});

test('if the clipboard refuses, the older way is tried; if that works the person never notices', async () => {
  const { events, restore } = setup({ api: async () => { throw new Error('NotAllowedError'); }, legacy: true });
  try {
    assert.equal(await copyText('hello'), 'copied');
    assert.deepEqual(events.map((e) => e.type), ['yyc-toast']);
  } finally { restore(); }
});

test('if both ways fail, the text is offered in a window to copy by hand, not lost', async () => {
  const { events, restore } = setup({ api: undefined, legacy: false });
  try {
    assert.equal(await copyText('the text'), 'manual');
    assert.deepEqual(events.map((e) => e.type), ['yyc-copy-manual']);
    assert.equal(events[0].detail.text, 'the text');
  } finally { restore(); }
  const b = setup({ api: undefined, legacy: 'throw' });
  try { assert.equal(await copyText('x'), 'manual', 'even a throwing older method is survived'); } finally { b.restore(); }
});

test('copying nothing says so instead of copying an empty string', async () => {
  const { events, restore } = setup({ api: async () => {} });
  try {
    assert.equal(await copyText(''), 'manual');
    assert.equal(events[0].detail.kind, 'error');
  } finally { restore(); }
});
