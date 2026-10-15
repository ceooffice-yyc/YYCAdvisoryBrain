import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBudget, makeLlm, LlmError } from '../server/ask/llm.js';
import { handleAsk, clientResult } from '../server/ask/handler.js';
import { docs, index, records } from './fixtures/library.mjs';
import { makeLocalRetriever } from '../server/ask/localRetrieval.js';

const noBudget = { reserve: async () => ({ entry: {} }), settle: () => {} }; // a budget that never limits
const reply = (content) => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content } }] }), retryAfter: null });

test('budget: what fits goes straight through; what does not fit waits briefly, then goes ahead (Groq is the referee); real usage replaces the estimate', async () => {
  let t = 0;
  const sleeps = [];
  const mk = (maxWaitMs) => makeBudget({ limit: 1000, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, maxWaitMs });
  const b = mk(90000);
  const first = await b.reserve(600);
  assert.equal(first.over, false); assert.equal(sleeps.length, 0);
  const second = await b.reserve(600); // waits for the first to leave the 60 s window
  assert.equal(second.over, false); assert.ok(t >= 55000);

  t = 0;
  const impatient = mk(3000);
  await impatient.reserve(900);
  const late = await impatient.reserve(900); // would need ~60 s: it does not block the caller that long
  assert.equal(late.over, true);
  assert.ok(t <= 4000);

  t = 0;
  const settled = mk(3000);
  const h = await settled.reserve(900);
  settled.settle(h, 200); // the call really used 200 tokens: the room is given back
  assert.equal((await settled.reserve(700)).over, false);
});

test('llm: the budget is charged with the tokens a call really used', async () => {
  const charged = [];
  const budget = { reserve: async (n) => ({ entry: { tokens: n } }), settle: (h, actual) => charged.push([h.entry.tokens, actual]) };
  const llm = makeLlm({ keys: ['k'], budget, log: () => {}, forward: async () => ({ status: 200, text: JSON.stringify({ usage: { total_tokens: 1234 }, choices: [{ message: { content: '{"a":1}' } }] }), retryAfter: null }) });
  await llm.json('hello', { expectedOutput: 300 });
  assert.equal(charged[0][1], 1234);
  assert.ok(charged[0][0] < 1000); // reserved the expected size, not the 1500-token ceiling
});

test('llm: a short rate limit is waited out once, a long one is reported, an optional call never waits', async () => {
  const waits = [];
  const seq = (...statuses) => { const out = [...statuses]; return async () => out.shift(); };
  const limited = (sec) => ({ status: 429, text: `Please try again in ${sec}s`, retryAfter: null });
  const ok = { status: 200, text: JSON.stringify({ choices: [{ message: { content: '{"done":true}' } }] }), retryAfter: null };
  const mk = (forward) => makeLlm({ keys: ['k'], budget: { reserve: async () => ({ entry: {} }), settle: () => {} }, log: () => {}, forward, sleep: async (ms) => { waits.push(ms); } });

  assert.deepEqual(await mk(seq(limited(8), ok)).json('x'), { done: true }); // waited ~8 s, then succeeded
  assert.equal(waits.length, 1); assert.ok(waits[0] >= 8000 && waits[0] <= 9000);

  await assert.rejects(() => mk(seq(limited(45), ok)).json('x'), (e) => e.kind === 'minute' && e.waitSec === 45); // too long to wait for
  waits.length = 0;
  await assert.rejects(() => mk(seq(limited(5), ok)).json('x', { waitOnLimit: false }), (e) => e.kind === 'minute'); // optional call: fail fast
  assert.equal(waits.length, 0);
  await assert.rejects(() => mk(seq(limited(5), limited(5), limited(5), limited(5))).json('x'), (e) => e.kind === 'minute'); // not forever: two waits at most
});

test('llm: parses JSON (also inside code fences), retries a malformed reply once with more room', async () => {
  const bodies = [];
  const answers = [reply('not json at all'), reply('```json\n{"ok": true}\n```')];
  const llm = makeLlm({ keys: ['k'], budget: noBudget, sleep: async () => {}, log: () => {}, forward: async (body) => { bodies.push(body); return answers.shift(); } });
  assert.deepEqual(await llm.json('hello', { maxTokens: 800, retries: 1 }), { ok: true });
  assert.equal(bodies.length, 2);
  assert.ok(bodies[1].max_tokens > bodies[0].max_tokens);
  assert.equal(bodies[0].response_format.type, 'json_object');
});

test('llm: rate limits become typed errors with a wait time; other failures are generic', async () => {
  const mk = (res) => makeLlm({ keys: ['k'], budget: noBudget, sleep: async () => {}, log: () => {}, forward: async () => res });
  await assert.rejects(() => mk({ status: 429, text: 'Rate limit reached. Please try again in 9.5s', retryAfter: null }).json('x'), (e) => e.kind === 'minute' && e.waitSec === 10);
  await assert.rejects(() => mk({ status: 429, text: 'tokens per day (TPD) limit. Please try again in 1h2m3s', retryAfter: null }).json('x'), (e) => e.kind === 'daily' && e.waitSec === 3723);
  await assert.rejects(() => mk({ status: 500, text: 'boom', retryAfter: null }).json('x'), (e) => e.kind === 'http');
});

test('llm: a model that rejects reasoning_effort is retried without it', async () => {
  const seen = [];
  const llm = makeLlm({ keys: ['k'], budget: noBudget, sleep: async () => {}, log: () => {}, forward: async (body) => { seen.push('reasoning_effort' in body); return body.reasoning_effort ? { status: 400, text: 'unknown param reasoning_effort', retryAfter: null } : reply('{"a":1}'); } });
  assert.deepEqual(await llm.json('x'), { a: 1 });
  assert.deepEqual(seen, [true, false]);
});

// ---- the HTTP handler, with every outside piece replaced ----
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const okAuth = (id = 'u1') => async () => ({ ok: true, user: { id, email: `${id}@yycadvisors.com`, isAdmin: false } });
function fakeSb() {
  const rows = { ask_log: [], gap_log: [] };
  return {
    rows,
    from(table) {
      return { insert(row) { rows[table].push(row); const r = { error: null, data: { id: '11111111-1111-4111-8111-111111111111' } }; return { select: () => ({ single: async () => r }), then: (f) => f({ error: null }) }; } };
    },
  };
}
const fakeLlm = (answer) => ({ async json(p) { if (p.startsWith('You prepare')) return { intent: 'question', standalone: 'q', keywords: [] }; if (answer instanceof Error) throw answer; return answer; } });
const r = makeLocalRetriever(async () => docs);
const makeDeps = (_sb, _env, llm) => ({ llm, retrieve: r.retrieve, records: async () => records, docIndex: async () => index });
const call = (body, opts = {}) => handleAsk({ method: 'POST', headers: {}, body }, { env, authenticate: okAuth(opts.user), sb: opts.sb || fakeSb(), llm: opts.llm || fakeLlm({ answerable: true, answer: 'x' }), makeDeps: opts.makeDeps || makeDeps, ...opts.extra });

test('handler: wrong method, no database and no sign-in are refused clearly', async () => {
  assert.equal((await handleAsk({ method: 'GET' }, { env })).status, 405);
  assert.equal((await handleAsk({ method: 'POST', body: {} }, { env: {} })).status, 501);
  const out = await handleAsk({ method: 'POST', body: { question: 'hi there' }, headers: {} }, { env, authenticate: async () => ({ ok: false, status: 401, error: 'Sign in required' }) });
  assert.deepEqual([out.status, out.body.error], [401, 'Sign in required']);
});

test('handler: input is validated and trimmed', async () => {
  assert.equal((await call({ question: '   ' })).status, 400);
  assert.equal((await call({ question: 'x'.repeat(2001) })).status, 400);
  assert.equal((await call({})).status, 400);
});

test('handler: an answer is returned without the internal trace, and logged', async () => {
  const sb = fakeSb();
  const out = await call({ question: 'how did Acme price its coolers', history: [{ role: 'user', text: 'hi' }], taggedIds: [] }, { sb, user: 'a1', llm: fakeLlm({ answerable: true, answer: 'Acme worked back from the margin it needed. [C1]' }) });
  assert.equal(out.status, 200);
  assert.equal(out.body.answerable, true);
  assert.equal(out.body.logId, '11111111-1111-4111-8111-111111111111');
  assert.ok(!('trace' in out.body));
  assert.equal(sb.rows.ask_log.length, 1);
  assert.equal(sb.rows.ask_log[0].question, 'how did Acme price its coolers');
  assert.ok(sb.rows.ask_log[0].trace.ms.total >= 0);
  assert.equal(sb.rows.gap_log.length, 0);
});

test('handler: a refused question goes to the gap list; a greeting is not logged at all', async () => {
  const sb = fakeSb();
  const refused = await call({ question: 'what is the acme corporate tax rate' }, { sb, user: 'a2', llm: fakeLlm({ answerable: false, answer: '' }) });
  assert.equal(refused.body.answerable, false);
  assert.equal(refused.body.gapLogged, true);
  assert.equal(sb.rows.gap_log.length, 1);
  assert.equal(sb.rows.gap_log[0].question, 'what is the acme corporate tax rate');
  const sb2 = fakeSb();
  const hi = await call({ question: 'hello' }, { sb: sb2, user: 'a3' });
  assert.equal(hi.body.kind, 'greeting');
  assert.equal(sb2.rows.ask_log.length, 0);
});

test('handler: ASK_LOG=off stops the log but a refused question still reaches the gap list', async () => {
  const sb = fakeSb();
  const extra = { env: { ...env, ASK_LOG: 'off' } };
  await call({ question: 'how did Acme price its coolers' }, { sb, user: 'a4', llm: fakeLlm({ answerable: true, answer: 'ok [C1]' }), extra });
  assert.equal(sb.rows.ask_log.length, 0);
  const out = await call({ question: 'what is the acme corporate tax rate' }, { sb, user: 'a5', llm: fakeLlm({ answerable: false, answer: '' }), extra });
  assert.equal(sb.rows.ask_log.length, 0);
  assert.equal(sb.rows.gap_log.length, 1);
  assert.equal(out.body.gapLogged, true);
});

test('handler: each person is limited per minute, and others are not affected', async () => {
  const extra = { env: { ...env, ASK_RATE_PER_MIN: '2' }, now: () => 1_000_000 };
  const q = { question: 'how did Acme price its coolers' };
  assert.equal((await call(q, { user: 'rl1', extra })).status, 200);
  assert.equal((await call(q, { user: 'rl1', extra })).status, 200);
  const third = await call(q, { user: 'rl1', extra });
  assert.equal(third.status, 429);
  assert.equal(third.body.kind, 'user_rate');
  assert.ok(Number(third.headers['Retry-After']) >= 1);
  assert.equal((await call(q, { user: 'rl2', extra })).status, 200);
});

test('handler: AI and search failures map to clear statuses and are logged as errors', async () => {
  const q = { question: 'how did Acme price its coolers' };
  const sb = fakeSb();
  const limited = await call(q, { sb, user: 'e1', llm: fakeLlm(new LlmError('minute', 'The AI service is rate-limited.', 12)) });
  assert.deepEqual([limited.status, limited.body.kind, limited.body.waitSec], [429, 'minute', 12]);
  assert.match(sb.rows.ask_log[0].error, /minute/);
  const down = await call(q, { user: 'e3', makeDeps: (sb, e, llm) => ({ ...makeDeps(sb, e, llm), retrieve: async () => { throw new Error('db exploded: secret-connection-string'); } }) });
  assert.equal(down.status, 502);
  assert.ok(!JSON.stringify(down.body).includes('secret-connection-string')); // internals are never sent to the browser
});

test('clientResult drops the server-only trace', () => {
  assert.ok(!('trace' in clientResult({ kind: 'answer', trace: { a: 1 }, text: 't', citations: [], evidence: [], retrieved: [], notes: {} }, { logId: 'id' })));
});

test('llm: the answer can think harder when ASK_REASONING says so, while the small analysis call stays light', async () => {
  const efforts = [];
  const mk = (env) => makeLlm({ env, keys: ['k'], budget: noBudget, sleep: async () => {}, log: () => {}, forward: async (body) => { efforts.push(body.reasoning_effort); return reply('{"a":1}'); } });
  await mk({ ASK_REASONING: 'medium' }).json('x');
  await mk({ ASK_REASONING: 'medium' }).json('x', { reasoning: 'low' });
  await mk({ ASK_REASONING: 'nonsense' }).json('x');
  await mk({}).json('x');
  assert.deepEqual(efforts, ['medium', 'low', 'low', 'low']);
});
