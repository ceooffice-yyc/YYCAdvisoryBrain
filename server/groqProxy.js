// Shared by the local Express server (server/index.js) and the Vercel function (api/groq/chat.js).
//
// Several Groq keys can be configured; they are tried in order. When a key hits a rate limit (per-minute or
// per-day) it is benched until it recovers and the same request is retried on the next key, so the browser
// never sees the 429 unless EVERY key is limited. Keys never leave the server and are never logged.
//
// Keys are read from (any mix, duplicates ignored):
//   GROQ_API_KEY, GROQ_API_KEY_2 ... GROQ_API_KEY_9      one key per variable
//   GROQ_API_KEYS                                        comma / space / newline separated list

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export function loadGroqKeys(env = process.env) {
  const keys = [];
  const add = (v) => { const k = String(v || '').trim().replace(/^["']|["']$/g, ''); if (k && !keys.includes(k)) keys.push(k); };
  add(env.GROQ_API_KEY);
  for (let i = 2; i <= 9; i++) add(env[`GROQ_API_KEY_${i}`]);
  String(env.GROQ_API_KEYS || '').split(/[\s,;]+/).forEach(add);
  return keys;
}

// "Please try again in 7m12.5s" / "in 850ms" / "in 2h3m1s" → milliseconds (0 when absent)
function waitFromMessage(text) {
  const m = /try again in\s+((?:\d+(?:\.\d+)?\s*(?:h|ms|m|s)\s*)+)/i.exec(text || '');
  if (!m) return 0;
  let ms = 0;
  for (const [, n, u] of m[1].matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/gi)) ms += parseFloat(n) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[u.toLowerCase()]);
  return ms;
}

// per-process memory of benched keys: key index -> time (ms) when it may be used again
const benchedUntil = new Map();

/* Forwards one chat-completion body to Groq. Resolves to { status, text, retryAfter } exactly like a single upstream call;
   `fetchImpl` / `keys` / `now` exist so the failover can be tested without the network. */
export async function forwardToGroq(body, { keys = loadGroqKeys(), fetchImpl = fetch, now = Date.now, log = console.log } = {}) {
  if (!keys.length) return { status: 500, text: JSON.stringify({ error: 'No GROQ_API_KEY is configured on the server.' }), retryAfter: null };
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const t = now();
  // keys that are not benched, in order (key 1 is always preferred as soon as it has recovered); benched ones go last, soonest-recovering first
  const order = keys.map((_, i) => i).sort((a, b) => {
    const ba = (benchedUntil.get(a) || 0) > t, bb = (benchedUntil.get(b) || 0) > t;
    if (ba !== bb) return ba ? 1 : -1;
    return ba ? benchedUntil.get(a) - benchedUntil.get(b) : a - b;
  });
  let limited = null; // the limited response that will recover soonest, returned if every key is limited
  for (const i of order) {
    let up;
    try {
      up = await fetchImpl(GROQ_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keys[i]}` }, body: payload });
    } catch (err) {
      log(`Groq key #${i + 1}: network error (${err.message}); trying the next key`);
      continue;
    }
    const text = await up.text();
    const header = up.headers.get('retry-after');
    if (up.status === 429) {
      const wait = Math.max(header ? parseFloat(header) * 1000 : 0, waitFromMessage(text)) || 60000;
      benchedUntil.set(i, now() + wait);
      log(`Groq key #${i + 1} is rate-limited (back in ~${Math.ceil(wait / 1000)}s)${i < keys.length - 1 ? '; trying the next key' : ''}`);
      if (!limited || wait < limited.wait) limited = { status: 429, text, retryAfter: header, wait };
      continue;
    }
    if (up.status === 401 || up.status === 403) { // a revoked / mistyped key: set it aside for a while and use another
      benchedUntil.set(i, now() + 10 * 60000);
      log(`Groq key #${i + 1} was rejected (HTTP ${up.status})${i < keys.length - 1 ? '; trying the next key' : ''}`);
      if (!limited) limited = { status: up.status, text, retryAfter: null, wait: 10 * 60000 };
      continue;
    }
    return { status: up.status, text, retryAfter: header };
  }
  return limited
    ? { status: limited.status, text: limited.text, retryAfter: limited.retryAfter }
    : { status: 502, text: JSON.stringify({ error: 'Upstream request to Groq failed' }), retryAfter: null };
}

export const _test = { benchedUntil, waitFromMessage };
