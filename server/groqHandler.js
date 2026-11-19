// /api/groq/chat: the AI proxy the browser uses for document extraction. Shared by the Express server (server/index.js) and the Vercel
// function (api/groq/chat.js), so the two can never drift apart (SEC-02).
//
// Who may use it: with the shared database (Supabase) only ADMINS, because only admins extract documents; everyone else asks questions
// through /api/ask, which builds its own prompts on the server. It is not a general relay: only the app's model is allowed, the request is
// rebuilt from a fixed list of fields, and sizes are capped. On a hosted site with no sign-in configured it refuses to run at all.

import { forwardToGroq, loadGroqKeys } from './groqProxy.js';
import { authenticate } from './auth.js';
import { dbConfigured } from './db.js';
import { hit, waitFor, clientIp, limitFrom } from './rateLimit.js';

export const ALLOWED_MODEL = 'openai/gpt-oss-120b';
const MAX_MESSAGES = 4;
const MAX_CONTENT_CHARS = 60_000;   // one extraction part is about 27,000 characters at most
const MAX_TOKENS = 8_000;

const json = (status, body, headers = {}) => ({ status, body, headers });
/* With no sign-in the proxy is meant for this PC only: the request must be addressed to it by a local name (unless HOST opens it to the LAN on purpose). */
function localHost(headers = {}, env = process.env) {
  const bind = String(env.HOST || '127.0.0.1').trim();
  if (bind && !['127.0.0.1', 'localhost', '::1'].includes(bind)) return true; // deliberately served to the network (npm start with HOST=0.0.0.0)
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const host = String(h.host || '').toLowerCase().replace(/:\d+$/, '');
  return !host || ['localhost', '127.0.0.1', '[::1]'].includes(host);
}

const hosted = (env) => !!String(env.VERCEL || '').trim() || String(env.NODE_ENV || '').trim() === 'production';

/* Rebuilds the request from the fields the app really uses; anything else (other models, tools, streaming, extra options) is dropped or refused.
   -> { ok: true, body } | { ok: false, error } */
export function cleanChatBody(raw) {
  const b = raw && typeof raw === 'object' ? raw : null;
  if (!b) return { ok: false, error: 'Bad request' };
  if (b.model !== ALLOWED_MODEL) return { ok: false, error: 'That model is not allowed.' };
  if (!Array.isArray(b.messages) || !b.messages.length || b.messages.length > MAX_MESSAGES) return { ok: false, error: 'Bad messages' };
  const messages = [];
  let chars = 0;
  for (const m of b.messages) {
    if (!m || (m.role !== 'system' && m.role !== 'user') || typeof m.content !== 'string' || !m.content) return { ok: false, error: 'Bad messages' };
    chars += m.content.length;
    messages.push({ role: m.role, content: m.content });
  }
  if (chars > MAX_CONTENT_CHARS) return { ok: false, error: 'The request is too large.' };
  const maxTokens = Math.floor(Number(b.max_tokens));
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_TOKENS) return { ok: false, error: 'Bad max_tokens' };
  const body = { model: ALLOWED_MODEL, messages, max_tokens: maxTokens, temperature: Math.min(Math.max(Number(b.temperature) || 0, 0), 1), response_format: { type: 'json_object' } };
  if (['low', 'medium', 'high'].includes(b.reasoning_effort)) body.reasoning_effort = b.reasoning_effort;
  return { ok: true, body };
}

/* req: { method, body, headers } -> { status, body (object) | text (string), headers }.  `opts` lets tests replace the pieces. */
export async function handleGroq(req, opts = {}) {
  const env = opts.env || process.env;
  const now = opts.now || Date.now;
  const keys = opts.keys || loadGroqKeys(env);
  const method = String(req.method || 'GET').toUpperCase();
  const withDb = dbConfigured(env);
  const auth = opts.authenticate || authenticate;

  if (method === 'GET') { // how many keys there are: the app sizes its parallel work from it. Told to admins only; everyone else is told 1.
    let n = 1;
    if (!withDb) n = hosted(env) ? 1 : keys.length;
    else { const a = await auth(req.headers || {}, env, now()); if (a.ok && a.user.isAdmin) n = keys.length; }
    return json(200, { keys: n }, { 'Cache-Control': 'no-store' });
  }
  if (method !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });

  let who;
  const ip = req.ip || clientIp(req.headers);
  if (withDb) {
    const blocked = waitFor('auth-fail', ip, 30, 60_000, now()); // already over the wrong-token limit: refused before Supabase is asked again
    if (blocked) return json(429, { error: 'Too many attempts. Please wait a moment.' }, { 'Retry-After': String(blocked) });
    const a = await auth(req.headers || {}, env, now());
    if (!a.ok) {
      hit('auth-fail', ip, 30, 60_000, now());
      return json(a.status, { error: a.error, ...(a.code ? { code: a.code } : {}) });
    }
    if (!a.user.isAdmin) return json(403, { error: 'You need an admin account to do that.' });
    who = a.user.id || a.user.email;
  } else {
    // No sign-in configured. Fine on your own PC (the server only listens on this machine); never on a hosted site, where it would be open to everyone.
    if (hosted(env)) return json(503, { error: 'The AI service needs sign-in to be configured on this site (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).' });
    if (!localHost(req.headers, env)) return json(403, { error: 'This address is not allowed.' });
    who = `ip:${ip}`;
  }

  const wait = hit('groq', who, limitFrom(env, 'GROQ_RATE_PER_MIN', 300), 60_000, now());
  if (wait) return json(429, { error: `Too many AI requests. Please wait ${wait}s.` }, { 'Retry-After': String(wait) });

  if (!keys.length) return json(500, { error: 'GROQ_API_KEY is not set on the server.' });
  const clean = cleanChatBody(req.body);
  if (!clean.ok) return json(400, { error: clean.error });

  try {
    const { status, text, retryAfter } = await (opts.forward || forwardToGroq)(clean.body, { keys });
    return { status, text, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(retryAfter ? { 'retry-after': retryAfter } : {}) } };
  } catch (err) {
    console.error('Groq proxy error:', err && err.message);
    return json(502, { error: 'Upstream request to Groq failed' });
  }
}
