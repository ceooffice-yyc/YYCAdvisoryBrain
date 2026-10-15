/* global process */
// POST /api/ask: the hosted Ask the Brain. Shared by the Express server (server/index.js) and the Vercel function (api/ask.js).
//
//   request   { question, history: [{ role: "user" | "ai", text }], taggedIds: [documentId] }       Authorization: Bearer <Supabase session>
//   response  200 { kind, answerable, text, citations, evidence, closest, retrieved, unsupportedFigures, uncited, notes, logId, gapLogged }
//             400 bad request | 401/403 not signed in / not allowed | 429 rate limited ({ kind, waitSec }) | 502/503/504 a service problem
//
// Who may ask: any signed-in person (guests cannot: every question costs AI tokens). Each person is limited to ASK_RATE_PER_MIN questions
// a minute (default 20). Every question is written to the ask_log table unless ASK_LOG=off.

import { authenticate } from '../auth.js';
import { dbConfigured, getClient } from '../db.js';
import { makeLlm, LlmError } from './llm.js';
import { runAsk, AskError } from './pipeline.js';
import { makeServerDeps } from './serverDeps.js';

const json = (status, body, headers = {}) => ({ status, body, headers });
const TIMEOUT_MS = 55_000;
const MAX_HISTORY = 8;

const recent = new Map(); // user id -> timestamps of recent questions (per server instance)
function rateLimited(userId, now, perMinute) {
  const hits = (recent.get(userId) || []).filter((t) => now - t < 60_000);
  if (hits.length >= perMinute) { recent.set(userId, hits); return Math.max(1, Math.ceil((60_000 - (now - hits[0])) / 1000)); }
  hits.push(now);
  recent.set(userId, hits);
  if (recent.size > 2000) for (const [k, v] of recent) if (!v.some((t) => now - t < 60_000)) recent.delete(k);
  return 0;
}

/* Only what the screen needs: the trace stays on the server (in ask_log). */
export function clientResult(r, rec = {}) {
  return {
    logId: rec.logId || null,
    gapLogged: !!rec.gapLogged,
    kind: r.kind, answerable: r.answerable, text: r.text,
    citations: r.citations, evidence: r.evidence, closest: r.closest, retrieved: r.retrieved,
    unsupportedFigures: r.unsupportedFigures, uncited: r.uncited, notes: r.notes,
  };
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new AskError('timeout', 'The answer took too long.')), ms))]);

/* Writes the ask log row and, for a question the library could not answer, the Gap list entry. The two are independent and both
   best-effort: a failure here is logged but never breaks the answer. -> { logId, gapLogged } */
async function recordAsk(sb, env, user, question, result, error, now) {
  const out = { logId: null, gapLogged: false };
  if (result && result.kind === 'answer' && result.answerable === false) { // the content team's list (the Gap tab)
    try {
      const g = await sb.from('gap_log').insert({ id: `g${now()}`, question, at: now(), status: 'active', created_by: user.email });
      if (g.error) throw new Error(g.error.message);
      out.gapLogged = true;
    } catch (e) { console.error('could not write the gap list:', e.message); }
  }
  if (String(env.ASK_LOG || '').trim().toLowerCase() === 'off') return out;
  try {
    const row = {
      user_id: user.id, user_email: user.email, question,
      standalone: result && result.notes ? result.notes.standalone : null,
      intent: result && result.notes ? result.notes.intent : null,
      keywords: result && result.notes ? result.notes.keywords || [] : [],
      mode: result && result.notes ? result.notes.mode : null,
      answerable: result ? !!result.answerable : null,
      answer: result ? String(result.text || '').slice(0, 20000) : null,
      citations: result ? result.citations : null,
      retrieved: result ? result.retrieved : null,
      unsupported: result ? result.unsupportedFigures || [] : [],
      trace: result ? result.trace || null : null,
      ms: result && result.trace && result.trace.ms ? result.trace.ms.total : null,
      error: error ? String(error).slice(0, 500) : null,
    };
    const ins = await sb.from('ask_log').insert(row).select('id').single();
    if (ins.error) throw new Error(ins.error.message);
    out.logId = ins.data.id;
  } catch (e) {
    console.error('could not write the ask log:', e.message);
  }
  return out;
}

/* req: { method, body, headers }  ->  { status, body, headers }.   `opts` exists so tests can replace the pieces. */
export async function handleAsk(req, opts = {}) {
  const env = opts.env || process.env;
  const now = opts.now || Date.now;
  if (String(req.method || '').toUpperCase() !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'POST' });
  if (!dbConfigured(env)) return json(501, { error: 'Server-side search needs the shared database (Supabase) to be configured.' });

  const auth = await (opts.authenticate || authenticate)(req.headers || {}, env, now());
  if (!auth.ok) return json(auth.status, { error: auth.error });
  const user = auth.user;

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 2000) return json(400, { error: 'Ask a question of up to 2000 characters.' });
  const history = (Array.isArray(body.history) ? body.history : []).slice(-MAX_HISTORY)
    .filter((m) => m && typeof m.text === 'string').map((m) => ({ role: m.role === 'user' ? 'user' : 'ai', text: m.text.slice(0, 1500) }));
  const taggedIds = (Array.isArray(body.taggedIds) ? body.taggedIds : []).filter((i) => typeof i === 'string' && i.length <= 100).slice(0, 5);

  const perMinute = Number(env.ASK_RATE_PER_MIN) > 0 ? Number(env.ASK_RATE_PER_MIN) : 20;
  const wait = rateLimited(user.id || user.email, now(), perMinute);
  if (wait) return json(429, { error: `You are asking very quickly. Please wait ${wait}s.`, kind: 'user_rate', waitSec: wait }, { 'Retry-After': String(wait) });

  const sb = opts.sb || getClient(env);
  const llm = opts.llm || makeLlm({ env });
  const deps = (opts.makeDeps || makeServerDeps)(sb, env, llm);
  try {
    const result = await withTimeout(runAsk({ question, history, taggedIds }, { ...deps, now }), TIMEOUT_MS);
    const rec = result.kind === 'greeting' ? {} : await recordAsk(sb, env, user, question, result, null, now); // a "hello" is not worth a row
    return json(200, clientResult(result, rec));
  } catch (e) {
    const kind = e instanceof LlmError || e instanceof AskError ? e.kind : 'internal';
    await recordAsk(sb, env, user, question, null, `${kind}: ${e.message}`, now);
    if (e instanceof LlmError && (e.kind === 'minute' || e.kind === 'daily')) return json(429, { error: e.message, kind: e.kind, waitSec: e.waitSec }, { 'Retry-After': String(e.waitSec) });
    if (e instanceof AskError && e.kind === 'bad_request') return json(400, { error: e.message });
    if (e instanceof AskError && e.kind === 'timeout') return json(504, { error: 'The answer took too long. Please try again.', kind: 'timeout' });
    console.error(`ask failed (${kind}):`, e.message);
    return json(502, { error: 'Something went wrong while answering. Please try again.', kind });
  }
}
