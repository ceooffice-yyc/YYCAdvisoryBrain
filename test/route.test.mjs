import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildHash, docLink, mergeRoute, defaultRoute, KB_DEFAULTS, EXPLORER_DEFAULTS, TAB_SLUGS } from '../src/lib/route.js';

// UX-03: the address bar is part of the app. Everything read from it is untrusted; all text here is invented.

test('an empty or plain address is the first page with default filters, and builds back to no hash at all', () => {
  assert.deepEqual(parseHash(''), defaultRoute());
  assert.deepEqual(parseHash('#'), defaultRoute());
  assert.equal(buildHash(defaultRoute()), '');
});

test('every tab has its own readable address and comes back from it', () => {
  for (const [tab, slug] of Object.entries(TAB_SLUGS)) {
    const r = parseHash(`#/${slug}`);
    assert.equal(r.tab, tab);
    if (tab !== 'kb') assert.equal(buildHash(r), `#/${slug}`);
  }
  assert.equal(parseHash('#/Explorer/').tab, 'explorer', 'capitals and a trailing slash do not matter');
});

test('library filters round-trip through the address', () => {
  const r = { ...defaultRoute(), kb: { q: 'delivery fees', lever: 'price', industry: 'Trading / Retail', sub: 'Bakery', sort: 'az' } };
  const h = buildHash(r);
  assert.ok(h.startsWith('#/library?'));
  assert.deepEqual(parseHash(h).kb, r.kb);
});

test('explorer filters round-trip, and a default filter is left out of the address', () => {
  const r = { ...defaultRoute(), tab: 'explorer', explorer: { ...EXPLORER_DEFAULTS, lever: 'volume', q: 'bundles' } };
  const h = buildHash(r);
  assert.equal(h, '#/explorer?lever=volume&q=bundles');
  assert.deepEqual(parseHash(h).explorer, r.explorer);
  assert.equal(buildHash({ ...defaultRoute(), tab: 'explorer' }), '#/explorer', 'all defaults: nothing after the tab');
});

test('an open document and its section are part of the address', () => {
  const h = buildHash({ ...defaultRoute(), doc: 'd1', section: 'Pricing & fees' });
  assert.equal(parseHash(h).doc, 'd1');
  assert.equal(parseHash(h).section, 'Pricing & fees');
  assert.equal(docLink('d1', 'Pricing', 'https://example.test/'), 'https://example.test/#/library?doc=d1&section=Pricing');
  assert.equal(docLink('d1', null, 'https://example.test/'), 'https://example.test/#/library?doc=d1');
});

test('anything unknown or wrong falls back to the default instead of breaking the page', () => {
  assert.equal(parseHash('#/nonsense').tab, 'kb');
  assert.equal(parseHash('#/library?sort=bogus').kb.sort, 'oldest');
  assert.equal(parseHash('#/library?lever=NOT A LEVER!').kb.lever, 'all');
  assert.equal(parseHash('#/explorer?lever=has spaces').explorer.lever, 'price');
  assert.equal(parseHash('#/library?doc=../../etc/passwd').doc, null, 'a document id with slashes is refused');
  assert.equal(parseHash('#/library?doc=' + 'x'.repeat(200)).doc, null, 'an over-long id is refused');
  assert.equal(parseHash('#/library?unknown=1&another=2').tab, 'kb', 'unknown settings are ignored');
  assert.doesNotThrow(() => parseHash('#/library?q=%E0%A4%A')); // a broken % sequence
  assert.doesNotThrow(() => parseHash('#/?&&&===?'));
});

test('hostile text in the address stays plain text: no control characters, limited length', () => {
  const r = parseHash('#/library?q=' + encodeURIComponent('<img src=x onerror=alert(1)>\u0000\u0007 hello') + '&industry=' + encodeURIComponent('a'.repeat(500)));
  assert.equal(r.kb.q, '<img src=x onerror=alert(1)> hello', 'kept as text (React escapes it); control characters removed');
  assert.ok(r.kb.industry.length <= 80);
  assert.ok(parseHash('#/library?q=' + 'q'.repeat(1000)).kb.q.length <= 200);
  assert.ok(parseHash('#/library?doc=d1&section=' + 's'.repeat(1000)).section.length <= 120);
});

test('filters belong to the tab they are on: a library address does not set explorer filters and the other way round', () => {
  const lib = parseHash('#/library?lever=price&q=a');
  assert.deepEqual(lib.explorer, { ...EXPLORER_DEFAULTS });
  const exp = parseHash('#/explorer?lever=volume&q=b');
  assert.deepEqual(exp.kb, { ...KB_DEFAULTS });
});

test('merging a change keeps the other tab\'s filters', () => {
  const base = { ...defaultRoute(), kb: { ...KB_DEFAULTS, q: 'fees' } };
  const next = mergeRoute(base, { tab: 'explorer', explorer: { lever: 'cogs' } });
  assert.equal(next.tab, 'explorer');
  assert.equal(next.kb.q, 'fees', 'library filters survive a visit to another tab');
  assert.equal(next.explorer.lever, 'cogs');
  assert.equal(next.explorer.cat, 'all');
});

test('building then parsing never changes the route (a round trip for many combinations)', () => {
  const levers = ['all', 'price', 'volume', 'ar_days'];
  const sorts = ['oldest', 'newest', 'az', 'levers'];
  for (const lever of levers) for (const sort of sorts) for (const q of ['', 'fees', 'a & b = c?']) {
    const r = { ...defaultRoute(), kb: { ...KB_DEFAULTS, lever, sort, q }, doc: q ? 'd9' : null, section: q ? 'Pricing' : null };
    assert.deepEqual(parseHash(buildHash(r)), r, JSON.stringify([lever, sort, q]));
  }
});
