import test from 'node:test';
import assert from 'node:assert/strict';
import { runAsk, AskError, formatHistory } from '../server/ask/pipeline.js';
import { heuristicAnalysis, parseAnalysis, isSmallTalk, analyzeQuestion } from '../server/ask/router.js';
import { unsupportedFigures } from '../server/ask/verify.js';
import { finalizeAnswer } from '../server/ask/postprocess.js';
import { buildContext, rankRecords } from '../server/ask/context.js';
import { makeLocalRetriever } from '../server/ask/localRetrieval.js';
import { docs, index, records } from './fixtures/library.mjs';

// A fake AI: the router call returns `analysis`, the answer call returns `answer`; both record the prompts they were given.
function fakeLlm({ analysis, answer }) {
  const calls = [];
  return {
    calls,
    async json(prompt) {
      calls.push(prompt);
      const isAnalysis = prompt.startsWith('You prepare a question');
      const out = isAnalysis ? analysis : answer;
      if (out instanceof Error) throw out;
      return typeof out === 'function' ? out(prompt) : out;
    },
  };
}
const retriever = makeLocalRetriever(async () => docs);
const deps = (llm) => ({ llm, retrieve: retriever.retrieve, records: async () => records, docIndex: async () => index });

test('router: a bare word like "volume" no longer makes a list request; counts are read from many phrasings', () => {
  assert.equal(heuristicAnalysis('what was the sales volume at Acme?').intent, 'question');
  assert.equal(heuristicAnalysis('volume in Beta Foods').intent, 'question');
  assert.deepEqual([heuristicAnalysis('Give me 10 volume strategies'), heuristicAnalysis('show me 3 examples')].map((a) => [a.intent, a.count]), [['list', 10], ['list', 3]]);
  assert.equal(heuristicAnalysis('top 5 pricing examples').count, 5);
  assert.equal(heuristicAnalysis('give me 99 examples').count, 20);
});

test('router: AI output is validated, bad parts fall back to rules, a typed number wins', () => {
  const a = parseAnalysis({ intent: 'nonsense', count: 'x', standalone: '', keywords: ['equal split', 5, 'x'.repeat(80)] }, 'is 50 50 bad?');
  assert.equal(a.intent, 'question'); assert.deepEqual(a.keywords, ['equal split']); assert.equal(a.standalone, 'is 50 50 bad?');
  const b = parseAnalysis({ intent: 'question', count: 3, standalone: 'x y z', keywords: [] }, 'give me 7 strategies');
  assert.equal(b.intent, 'list'); assert.equal(b.count, 7);
  assert.equal(isSmallTalk('Hello!'), true); assert.equal(isSmallTalk('hello, what is the best pricing strategy for a cooler brand?'), false);
});

test('router: a failing or slow AI never blocks the question', async () => {
  const a = await analyzeQuestion('what about 60/40?', '', fakeLlm({ analysis: new Error('boom') }));
  assert.equal(a.source, 'rules');
  const slow = { json: () => new Promise(() => {}) };
  const b = await analyzeQuestion('hello there friend', '', slow, { timeoutMs: 30 });
  assert.equal(b.source, 'rules');
});

test('verify: figures missing from the sources are flagged, ordinary numbers are not', () => {
  const sources = 'Sam held 50.5% and Lee 49.5%. Lee invested about $100,000. Dealers: about 10 a day.';
  assert.deepEqual(unsupportedFigures('Sam held 50.5% and Lee invested $100,000, 10 dealers a day.', sources), []);
  assert.deepEqual(unsupportedFigures('Lee invested $250,000 and Sam held 60%.', sources), ['$250,000', '60%']);
  assert.deepEqual(unsupportedFigures('1. First point\n2. Second point about 3 things', sources), []);
  assert.deepEqual(unsupportedFigures('A 60/40 split is common', sources, 'what about 60/40?'), []);
});

test('pipeline: an answer with tags becomes exact references, evidence, no tags in the text', async () => {
  const llm = fakeLlm({
    analysis: { intent: 'question', count: null, standalone: 'Is it mandatory to avoid 50/50 ownership?', keywords: ['equal shareholding', 'deadlock'] },
    // like a real model, take the tag from the prompt: the record that says "Avoid 50:50"
    answer: (p) => ({ answerable: true, answer: `Not mandatory, but Acme avoided a 50:50 split on a lawyer's advice to prevent a deadlock; Sam held 50.5% and Lee 49.5%. [${(p.match(/\[(R\d+)\][^\n]*Avoid 50:50/) || [])[1]}]` }),
  });
  const out = await runAsk({ question: 'is it mandatory to avoid 50 50 ownership', history: [] }, deps(llm));
  assert.equal(out.answerable, true);
  assert.ok(!/\[R\d\]|\[C\d\]/.test(out.text));
  assert.deepEqual(out.citations.map((c) => [c.doc_title, c.section, c.record_id]), [['Acme Coolers', 'Shareholder Strategy', 'r4']]);
  assert.equal(out.evidence[0].record_id, 'r4');
  assert.ok(out.evidence[0].relevance > 0 && out.evidence[0].relevance <= 100);
  assert.deepEqual(out.unsupportedFigures, []);
  assert.equal(out.notes.analysis, 'ai');
  assert.ok(out.retrieved.some((d) => d.title === 'Acme Coolers'));
  // the model was shown tags, never internal ids
  assert.ok(!llm.calls[1].includes('d-acme') && /\[R\d\]/.test(llm.calls[1]) && /\[C\d\]/.test(llm.calls[1]));
});

test('pipeline: passage tags give section-level references with a REAL excerpt as evidence', async () => {
  const llm = fakeLlm({
    analysis: { intent: 'question', standalone: 'How did Acme set its price?', keywords: ['margin'] },
    answer: (p) => {
      const tag = (p.match(/\[(C\d+)\] \(section: Price\)/) || [])[1];
      return { answerable: true, answer: `Acme worked back from the margin it needed: a $100 cooler sold for $300. [${tag}]` };
    },
  });
  const out = await runAsk({ question: 'how did Acme set its price', history: [] }, deps(llm));
  assert.equal(out.citations[0].section, 'Price');
  assert.ok(docs[0].full_text.replace(/\s+/g, ' ').includes(out.evidence[0].passage.replace(/…$/, '').trim()));
  assert.deepEqual(out.unsupportedFigures, []);
});

test('pipeline: untagged bullets are linked to the right record by wording; leaked ids are removed', async () => {
  const llm = fakeLlm({
    analysis: { intent: 'list', count: 5, standalone: 'volume strategies', keywords: [] },
    answer: { answerable: true, answer: '- Sell through underserved independent dealers that large distributors ignored (Acme Coolers) [d-acme]\n- Run weekend demonstrations within 100 miles of the factory (Beta Foods) [doc_id=d-beta]' },
  });
  const out = await runAsk({ question: 'give me 5 volume strategies', history: [] }, deps(llm));
  assert.ok(!/d-acme|d-beta|doc_id/.test(out.text));
  assert.deepEqual(out.citations.map((c) => c.record_id).sort(), ['r1', 'r2']);
});

test('pipeline: invented tags are ignored; if the AI cites nothing the sources consulted are shown and flagged', async () => {
  const llm = fakeLlm({
    analysis: { intent: 'question', standalone: 'Acme pricing', keywords: [] },
    answer: { answerable: true, answer: 'Acme priced from its needed margin. [R99] [C77]' },
  });
  const out = await runAsk({ question: 'acme price margin', history: [] }, deps(llm));
  assert.equal(out.uncited, true);
  assert.ok(out.citations.length >= 1);
  assert.ok(!/\[R99\]|\[C77\]/.test(out.text));
});

test('pipeline: a made-up figure is flagged', async () => {
  const llm = fakeLlm({
    analysis: { intent: 'question', standalone: 'acme dealers', keywords: [] },
    answer: { answerable: true, answer: 'Acme set up about 45 dealers a day and earned $9,000,000. [R1]' },
  });
  const out = await runAsk({ question: 'how many dealers did Acme set up', history: [] }, deps(llm));
  assert.deepEqual(out.unsupportedFigures, ['$9,000,000']);
});

test('pipeline: refusal gives a closest document built from retrieval (no invented %), nothing found skips the AI call', async () => {
  const llm = fakeLlm({ analysis: { intent: 'question', standalone: 'x', keywords: [] }, answer: { answerable: false, answer: '' } });
  const refused = await runAsk({ question: 'what is the acme corporate tax rate', history: [] }, deps(llm));
  assert.equal(refused.answerable, false);
  assert.equal(refused.closest.relevance, null);
  assert.ok(refused.closest.doc_title);
  const llm2 = fakeLlm({ analysis: { intent: 'question', standalone: 'x', keywords: [] }, answer: new Error('must not be called') });
  const none = await runAsk({ question: 'zebra quantum xylophone', history: [] }, deps(llm2));
  assert.equal(none.answerable, false);
  assert.equal(llm2.calls.length, 1); // only the analysis call
});

test('pipeline: greetings cost nothing; empty questions and failed searches are clear errors', async () => {
  const llm = fakeLlm({ analysis: {}, answer: {} });
  const hi = await runAsk({ question: 'hello', history: [] }, deps(llm));
  assert.equal(hi.kind, 'greeting'); assert.equal(llm.calls.length, 0);
  await assert.rejects(() => runAsk({ question: '   ' }, deps(llm)), (e) => e instanceof AskError && e.kind === 'bad_request');
  const broken = { ...deps(llm), retrieve: async () => { throw new Error('db down'); } };
  await assert.rejects(() => runAsk({ question: 'anything about pricing' }, broken), (e) => e.kind === 'retrieval_failed');
});

test('context stays inside the character budget and tags are unique', () => {
  const chunks = Array.from({ length: 12 }, (_, i) => ({ doc_id: i % 2 ? 'd-acme' : 'd-beta', pos: i, heading: 'Volume', text: 'x'.repeat(790), score: 1 - i / 100 }));
  const docMap = new Map(index.map((d) => [d.id, { ...d, sections: [] }]));
  const ctx = buildContext({ chunks, docs: docMap, records: rankRecords({ question: 'dealers volume', records, titleOf: (id) => docMap.get(id)?.title, limit: 6 }), budget: 5000 });
  assert.ok(ctx.sourcesBlock.length + ctx.recordsBlock.length <= 5200);
  const tags = [...ctx.chunkTags.keys(), ...ctx.recordTags.keys()];
  assert.equal(new Set(tags).size, tags.length);
});

test('history is shortened for the prompts', () => {
  const h = formatHistory(Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? 'ai' : 'user', text: 'a'.repeat(2000) })));
  assert.equal(h.split('\n').length, 4); // 4 messages kept
  assert.ok(h.length < 2000);
});

test('finalizeAnswer: not answerable returns no text even if the AI wrote one', () => {
  const out = finalizeAnswer({ raw: { answerable: false, answer: 'maybe' }, context: { usedRecords: [], recordTags: new Map(), chunkTags: new Map(), sourcesBlock: '', recordsBlock: '' }, question: 'q', docs: new Map(), allChunks: [] });
  assert.equal(out.answerable, false); assert.equal(out.text, '');
});

test('levers: a list request about one lever returns only that lever, spread across companies', () => {
  const titleOf = (id) => index.find((d) => d.id === id)?.title;
  const volumeOnly = rankRecords({ question: 'give me 5 strategies', records, titleOf, limit: 5, lever: 'volume', diverse: true });
  assert.deepEqual(volumeOnly.map((r) => r.id).sort(), ['r1', 'r2', 'r3']); // all the volume records, nothing else, even though r2/r3 do not match the words
  assert.equal(volumeOnly[0].id === 'r1' || volumeOnly[0].lever === 'volume', true);
  const none = rankRecords({ question: 'give me strategies', records, titleOf, limit: 5, lever: 'no_such_lever' });
  assert.ok(none.length > 0); // an unknown lever is ignored rather than returning nothing
  const spread = rankRecords({ question: 'volume', records: [...records, { ...records[1], id: 'r2b' }, { ...records[1], id: 'r2c' }], titleOf, limit: 3, lever: 'volume', diverse: true });
  assert.ok(new Set(spread.map((r) => r.doc_id)).size >= 2); // at most two from the same company before others are used
});

test('levers: rules recognise built-in lever words; the AI may only pick a lever that exists', () => {
  assert.equal(heuristicAnalysis('Give me 10 volume strategies').lever, 'volume');
  assert.equal(heuristicAnalysis('Top 5 pricing examples').lever, 'price');
  assert.equal(heuristicAnalysis('Show me 3 inventory strategies').lever, 'inventory_days');
  assert.equal(heuristicAnalysis('how did Acme grow').lever, null);
  assert.equal(parseAnalysis({ intent: 'list', lever: 'invented', standalone: 'x y z', keywords: [] }, 'give me 4 ideas', ['volume', 'price']).lever, null);
  assert.equal(parseAnalysis({ intent: 'list', lever: 'price', standalone: 'x y z', keywords: [] }, 'give me 4 ideas', ['volume', 'price']).lever, 'price');
});

test('pipeline: "give me N volume strategies" is built from volume records only, and the AI is told which lever ids exist', async () => {
  const llm = fakeLlm({
    analysis: { intent: 'list', count: 3, lever: 'volume', standalone: 'volume strategies', keywords: [] },
    answer: (p) => ({ answerable: true, answer: ['r1', 'r2', 'r3'].map((_, i) => `- point ${i + 1} [R${i + 1}]`).join('\n') }),
  });
  const seen = [];
  const spy = { ...llm, async json(p, o) { seen.push(p); return llm.json(p, o); } };
  const out = await runAsk({ question: 'give me 3 volume strategies', history: [] }, deps(spy));
  assert.match(seen[0], /Lever ids: .*volume/);
  assert.ok(out.citations.every((c) => c.record_id && ['r1', 'r2', 'r3'].includes(c.record_id)));
});

test('references: a lever record and a passage from the same section show as ONE reference (the record, which is more exact)', async () => {
  const llm = fakeLlm({
    analysis: { intent: 'question', standalone: 'acme ownership', keywords: [] },
    answer: (p) => ({ answerable: true, answer: `A lawyer advised against 50:50. [${(p.match(/\[(R\d+)\][^\n]*Avoid 50:50/) || [])[1]}] Sam held 50.5%. [${(p.match(/\[(C\d+)\] \(section: Shareholder Strategy\)/) || [])[1]}]` }),
  });
  const out = await runAsk({ question: 'acme 50 50 ownership', history: [] }, deps(llm));
  const mine = out.citations.filter((c) => c.doc_title === 'Acme Coolers' && c.section === 'Shareholder Strategy');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].record_id, 'r4');
});

test('prompt: the AI is told to credit facts to the company they are about (family businesses are not the company)', async () => {
  const llm = fakeLlm({ analysis: { intent: 'question', standalone: 'acme', keywords: [] }, answer: { answerable: true, answer: 'x [C1]' } });
  const seen = [];
  await runAsk({ question: 'acme price margin', history: [] }, deps({ ...llm, async json(p, o) { seen.push(p); return llm.json(p, o); } }));
  assert.match(seen[1], /ATTRIBUTION/);
});

test('no tags from the AI: the references are the sources that match what it wrote, not just whatever ranked first', async () => {
  const llm = fakeLlm({
    analysis: { intent: 'question', standalone: 'acme equal split', keywords: ['equal', 'deadlock', 'weekend demonstrations'] },
    answer: { answerable: true, answer: 'A lawyer advised the founders against a 50:50 split to avoid a deadlock, so one held 50.5% and the other 49.5%.' }, // no tags at all
  });
  const out = await runAsk({ question: 'acme equal split deadlock weekend demonstrations', history: [] }, deps(llm));
  assert.equal(out.uncited, true);
  assert.ok(out.citations.some((c) => c.doc_title === 'Acme Coolers' && /Shareholder/.test(c.section)));
  assert.ok(!out.citations.some((c) => c.doc_title === 'Beta Foods')); // Beta matched a search keyword, but nothing the answer said
});

test('the catch-all "others" lever is never used to narrow a list request', () => {
  const a = parseAnalysis({ intent: 'list', lever: 'others', standalone: 'minority stakes of investors', keywords: [] }, 'what minority stakes did investors take', ['volume', 'others']);
  assert.equal(a.lever, null);
  const titleOf = (id) => index.find((d) => d.id === id)?.title;
  const unrestricted = rankRecords({ question: 'ownership', records, titleOf, limit: 5, lever: null });
  assert.ok(unrestricted.some((r) => r.lever === 'others'));
});

test('the prompt asks for company names and for tags on every statement', async () => {
  const llm = fakeLlm({ analysis: { intent: 'list', count: 4, standalone: 'x', keywords: [] }, answer: { answerable: true, answer: 'x [R1]' } });
  const seen = [];
  await runAsk({ question: 'give me 4 volume strategies', history: [] }, deps({ ...llm, async json(p, o) { seen.push(p); return llm.json(p, o); } }));
  assert.match(seen[1], /Name the company/);
  assert.match(seen[1], /add items from the SOURCES passages/);
  assert.match(seen[1], /without any source tags is not acceptable/);
  assert.match(seen[1], /read EVERY source and record again/);
  assert.match(seen[1], /leave out any company that has nothing relevant/);
});
