import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAsk } from '../server/ask/handler.js';
import { docs, records } from './fixtures/library.mjs';
import { chunkDocument } from '../server/chunking.js';

// A fake of the small part of the Supabase client the server uses. Every query is recorded so tests can see what was fetched.
function fakeDb({ rpc }) {
  const log = { selects: [], rpcs: [], inserts: { ask_log: [], gap_log: [] } };
  const table = {
    documents: docs.map((d) => ({ ...d, status: 'active', created: 1 })),
    records: records.map((r, i) => ({ ...r, status: 'active', position: i })),
  };
  const query = (name, columns) => {
    log.selects.push({ table: name, columns });
    const q = {
      eq: () => q, in: () => q, order: () => q, limit: () => q,
      range: (a, b) => Promise.resolve({ data: (table[name] || []).slice(a, b + 1), error: null }),
      then: (f, r) => Promise.resolve({ data: table[name] || [], error: null }).then(f, r),
    };
    return q;
  };
  return {
    log,
    from(name) {
      return {
        select: (columns) => query(name, columns),
        insert(row) { log.inserts[name]?.push(row); return { select: () => ({ single: async () => ({ data: { id: '22222222-2222-4222-8222-222222222222' }, error: null }) }), then: (f) => f({ error: null }) }; },
      };
    },
    rpc: async (fn, args) => { log.rpcs.push({ fn, args }); return rpc(args); },
  };
}

const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' }; // no GEMINI_API_KEY: keyword-only search
const auth = async () => ({ ok: true, user: { id: 'int-user', email: 'int@yycadvisors.com', isAdmin: false } });
const acme = docs[0];
const acmeChunk = chunkDocument(acme).find((c) => /Avoid 50:50 ownership/.test(c.text));
const indexedRows = [{ doc_id: 'd-acme', pos: acmeChunk.pos, heading: acmeChunk.heading, content: acmeChunk.text, score: 0.0164, kw_rank: 1, vec_rank: null }];

function recordingLlm(answerFor, keywords = ['equal shareholding', 'deadlock']) {
  const prompts = [];
  return { prompts, async json(p) { prompts.push(p); if (p.startsWith('You prepare')) return { intent: 'question', standalone: (p.match(/QUESTION: (.*)$/s) || [])[1], keywords }; return answerFor(p); } };
}
const ask = (db, llm, body, extra = {}) => handleAsk({ method: 'POST', headers: {}, body }, { env, authenticate: auth, sb: db, llm, ...extra });

test('end to end: the index search finds the 50:50 passage, the answer cites it exactly, nothing heavy is downloaded', async () => {
  const db = fakeDb({ rpc: () => ({ data: indexedRows, error: null }) });
  const llm = recordingLlm((p) => ({ answerable: true, answer: `Not mandatory: a lawyer advised the founders against a 50:50 split to avoid a deadlock, so Sam held 50.5% and Lee 49.5%. [${(p.match(/\[(C\d+)\] \(section: Shareholder Strategy\)/) || [])[1]}]` }));
  const out = await ask(db, llm, { question: 'is it mandatory to avoid 50 50 ownership', history: [] });

  assert.equal(out.status, 200);
  assert.equal(out.body.answerable, true);
  assert.equal(out.body.notes.mode, 'keyword');
  assert.deepEqual(out.body.citations.map((c) => [c.doc_title, c.section]), [['Acme Coolers', 'Shareholder Strategy']]);
  assert.ok(/50:50/.test(out.body.evidence[0].passage));
  assert.deepEqual(out.body.unsupportedFigures, []);
  assert.equal(db.log.rpcs[0].fn, 'search_chunks');
  assert.match(db.log.rpcs[0].args.query_text, /deadlock/);
  assert.equal(db.log.rpcs[0].args.query_embedding, null);
  // the full document text was never downloaded on the indexed path
  assert.ok(!db.log.selects.some((s) => /full_text/.test(String(s.columns))), 'documents were downloaded');
  assert.equal(out.body.logId, '22222222-2222-4222-8222-222222222222');
  assert.equal(db.log.inserts.ask_log.length, 1);
});

test('end to end: if the search index is missing or failing, the same question still works from the documents (fallback)', async () => {
  const db = fakeDb({ rpc: () => ({ data: null, error: { message: 'function public.search_chunks does not exist' } }) });
  const llm = recordingLlm((p) => ({ answerable: true, answer: `A lawyer advised against 50:50 to avoid a deadlock. [${(p.match(/\[(C\d+)\] \(section: Shareholder Strategy\)/) || [])[1]}]` }));
  const out = await ask(db, llm, { question: 'is it mandatory to avoid 50 50 ownership', history: [] });
  assert.equal(out.status, 200);
  assert.equal(out.body.answerable, true);
  assert.equal(out.body.notes.mode, 'browser'); // i.e. searched in memory
  assert.ok(out.body.citations.some((c) => c.doc_title === 'Acme Coolers'));
  assert.ok(db.log.selects.some((s) => /full_text/.test(String(s.columns))));
});

test('end to end: a document tagged with @ is always included, ahead of the search results', async () => {
  const db = fakeDb({ rpc: () => ({ data: indexedRows, error: null }) });
  const llm = recordingLlm(() => ({ answerable: true, answer: 'Beta ran weekend demos. [C1]' }));
  await ask(db, llm, { question: 'what did @Beta Foods do', history: [], taggedIds: ['d-beta'] });
  const prompt = llm.prompts[1];
  assert.ok(prompt.indexOf('### SOURCE: Beta Foods') >= 0 && prompt.indexOf('### SOURCE: Beta Foods') < prompt.indexOf('### SOURCE: Acme Coolers'));
});

test('end to end: a refused question lands on the gap list and the log says why nothing was found', async () => {
  const db = fakeDb({ rpc: () => ({ data: [], error: null }) });
  const llm = recordingLlm(() => ({ answerable: false, answer: '' }), []);
  const out = await ask(db, llm, { question: 'zebra quantum xylophone', history: [] });
  assert.equal(out.body.answerable, false);
  assert.equal(out.body.gapLogged, true);
  assert.equal(db.log.inserts.gap_log[0].question, 'zebra quantum xylophone');
  assert.equal(db.log.inserts.ask_log[0].answerable, false);
  assert.equal(llm.prompts.length, 1); // only the question analysis ran: nothing to answer from, so no answer call was spent
});
