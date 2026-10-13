// Shared by the local Express server (server/index.js) and the Vercel function (api/kv.js).
//
// The whole library is stored as key -> JSON value (kb:index, kb:levers, kb:doc:<id>, kb:config, ...) in ONE Supabase table, `kv`
// (see supabase/schema.sql). The browser never talks to the table: it calls /api/kv with its Supabase Auth session token, and this
// module uses the service-role key (server only) to read and write.
//
//   GET    /api/kv?action=status          -> { mode: "supabase" | "local" | "error", url, anonKey }   (no sign-in needed; the anon key is public)
//   GET    /api/kv?action=me              -> { id, email, isAdmin }
//   GET    /api/kv?key=kb:index           -> { key, value }   (value is a JSON string)  | 404
//   GET    /api/kv?prefix=kb:doc:         -> { keys: [...] }                              (admin)
//   PUT    /api/kv        { key, value }  -> { key }                                      (admin, or the exceptions below)
//   DELETE /api/kv?key=kb:doc:abc         -> { key, deleted: true }                       (admin; a SOFT delete)
//
// Who can do what (every call except `status` needs a signed-in user; see server/auth.js):
//   • any signed-in user reads the library, may append to the Gap Log / suggestions cache, and reads + writes THEIR OWN chat
//     (kb:chat:<their user id>);
//   • admins (ADMIN_EMAILS, or app_metadata.role = "admin") write everything, delete, list keys and may read any chat.
// 401 = not signed in / session expired, 403 = signed in but not allowed.
//
// Nothing is ever hard-deleted: every row has a `status` ('active' | 'deleted'), `deleted_at`, and who changed it (`updated_by`,
// `deleted_by`). DELETE only flips the row to 'deleted' (it then disappears from every read and list, and writing the key again
// brings it back as 'active'); the data stays in the table and can be restored from the Supabase dashboard (supabase/schema.sql).

import { createClient } from '@supabase/supabase-js';
import { authConfigured, authenticate } from './auth.js';

const TABLE = 'kv';
const KEY_RE = /^kb:[A-Za-z0-9:_.-]{1,160}$/;
const SHARED_APPEND = new Set(['kb:gaplog', 'kb:suggestions']); // any signed-in user may write these (Ask the Brain)
const CHAT_RE = /^kb:chat:([0-9a-f-]{36})$/;
// "Continue as guest": people who have not signed in may READ the library (documents, lever records, category names) and nothing else:
// no Ask the Brain (the AI proxy still needs sign-in), no Gap Log, no chats, no writing. Switch it off with ALLOW_GUEST=false.
const GUEST_READ = /^kb:(?:config|index|levers)$|^kb:doc:[A-Za-z0-9_.:-]+$/;
export const guestAllowed = (env = process.env) => String(env.ALLOW_GUEST || '').trim().toLowerCase() !== 'false';
const MAX_VALUE_CHARS = 3_500_000; // keeps well under the ~4.5 MB request limit of a Vercel function

export const kvConfigured = (env = process.env) => !!(String(env.SUPABASE_URL || '').trim() && String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim());

/* The only things this module needs from a database. */
function makeSupabaseDb(env) {
  const sb = createClient(String(env.SUPABASE_URL).trim(), String(env.SUPABASE_SERVICE_ROLE_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } });
  const fail = (what, error) => { throw new Error(`Supabase ${what} failed: ${error.message || error}`); };
  return {
    async get(key) {
      const { data, error } = await sb.from(TABLE).select('value').eq('key', key).eq('status', 'active').maybeSingle();
      if (error) fail('read', error);
      return data ? data.value : undefined;
    },
    async put(key, value, by) {
      const { error } = await sb.from(TABLE).upsert({ key, value, status: 'active', deleted_at: null, deleted_by: null, updated_by: by || null, updated_at: new Date().toISOString() });
      if (error) fail('write', error);
    },
    async del(key, by) {
      const at = new Date().toISOString(); // soft delete: the row stays, marked 'deleted'
      const { error } = await sb.from(TABLE).update({ status: 'deleted', deleted_at: at, deleted_by: by || null, updated_by: by || null, updated_at: at }).eq('key', key);
      if (error) fail('delete', error);
    },
    async list(prefix) {
      const { data, error } = await sb.from(TABLE).select('key').eq('status', 'active').like('key', String(prefix || '').replace(/[\\%_]/g, '\\$&') + '%').order('key').limit(5000);
      if (error) fail('list', error);
      return (data || []).map((r) => r.key);
    },
  };
}
let sharedDb = null;
const getDb = (env) => (sharedDb ||= makeSupabaseDb(env));

const json = (status, body) => ({ status, body });

function stripSecrets(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const { adminPass, adminPassHash, ...rest } = cfg;
  void adminPass; void adminPassHash;
  return rest;
}

/* req: { method, query, body, headers }  ->  { status, body } */
export async function handleKv(req, { env = process.env, now = Date.now } = {}) {
  const method = String(req.method || 'GET').toUpperCase();
  const q = req.query || {};

  if (method === 'GET' && q.action === 'status') {
    if (!kvConfigured(env)) return json(200, { mode: 'local' });
    if (!authConfigured(env)) return json(200, { mode: 'error', error: 'SUPABASE_ANON_KEY is not set on the server (Supabase → Project Settings → API → anon public key).' });
    return json(200, { mode: 'supabase', url: String(env.SUPABASE_URL).trim(), anonKey: String(env.SUPABASE_ANON_KEY).trim(), guest: guestAllowed(env) });
  }
  if (!kvConfigured(env)) return json(503, { error: 'The shared database is not configured. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY on the server.' });
  if (!authConfigured(env)) return json(503, { error: 'SUPABASE_ANON_KEY is not set on the server.' });

  const signedOut = !/^Bearer\s+\S/i.test(String(Object.entries(req.headers || {}).find(([k]) => k.toLowerCase() === 'authorization')?.[1] || ''));
  let user;
  if (signedOut && guestAllowed(env) && method === 'GET' && q.prefix === undefined && q.action === undefined && GUEST_READ.test(String(q.key || ''))) {
    user = { id: null, email: null, isAdmin: false, guest: true };
  } else {
    const a = await authenticate(req.headers, env, now());
    if (!a.ok) return json(a.status, { error: a.error });
    user = a.user;
  }
  if (method === 'GET' && q.action === 'me') return json(200, user);

  const store = getDb(env);
  const denied = () => json(403, { error: 'You need an admin account to do that.' });
  const chatAllowed = (key) => { const c = CHAT_RE.exec(key); return !c || c[1] === user.id || user.isAdmin; }; // chats are private to their owner

  try {
    if (method === 'GET') {
      if (q.prefix !== undefined) { // listing keys would expose every chat id
        if (!user.isAdmin) return denied();
        return json(200, { keys: await store.list(String(q.prefix)) });
      }
      const key = String(q.key || '');
      if (!KEY_RE.test(key)) return json(400, { error: 'Bad key' });
      if (!chatAllowed(key)) return denied();
      const value = await store.get(key);
      if (value === undefined) return json(404, { error: 'not found' });
      return json(200, { key, value: JSON.stringify(key === 'kb:config' ? stripSecrets(value) : value) });
    }

    if (method === 'PUT' || method === 'DELETE') {
      const key = String((method === 'PUT' ? req.body && req.body.key : q.key) || '');
      if (!KEY_RE.test(key)) return json(400, { error: 'Bad key' });
      if (method === 'DELETE') {
        if (!user.isAdmin) return denied();
        await store.del(key, user.email);
        return json(200, { key, deleted: true });
      }
      const own = CHAT_RE.exec(key);
      if (!user.isAdmin && !SHARED_APPEND.has(key) && !(own && own[1] === user.id)) return denied();

      const raw = req.body && req.body.value;
      if (typeof raw !== 'string' || raw.length > MAX_VALUE_CHARS) return json(413, { error: 'Value missing or too large' });
      let value;
      try { value = JSON.parse(raw); } catch { return json(400, { error: 'Value is not valid JSON' }); }
      if (key === 'kb:config') value = stripSecrets(value); // sign-in is handled by Supabase Auth; a passcode never belongs in the data
      await store.put(key, value, user.email);
      return json(200, { key });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('kv error:', err.message);
    return json(502, { error: 'The shared database request failed' });
  }
}
