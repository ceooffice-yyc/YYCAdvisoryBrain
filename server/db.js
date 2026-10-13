// The shared-database API, used by the local Express server (server/index.js) and the Vercel function (api/db.js).
//
// The library lives in real Supabase tables (see supabase/schema.sql): documents, records (the lever records), levers (the lever
// definitions the extraction prompt is built from), gap_log, chats, suggestions. The browser never touches them: it calls this API
// with its Supabase Auth session token, and this module uses the service-role key (server only).
//
//   GET  /api/db?action=status   -> { mode: "supabase" | "local" | "error", url, anonKey, guest }   (no sign-in needed)
//   GET  /api/db?action=me       -> { id, email, isAdmin }
//   POST /api/db  { op, ...args } -> { ... }       op names are listed in OPS below
//
// Who can do what (401 = not signed in / session ended, 403 = signed in but not allowed):
//   guest (nobody signed in, if ALLOW_GUEST is not false)   library, kb, document, documents  (read-only)
//   any signed-in user                                       + gap_add, chat_get / chat_save (their own), suggestions_get / suggestions_set
//   admin (ADMIN_EMAILS or app_metadata.role = "admin")      + everything that changes the library, and reading any chat
//
// Nothing is ever hard-deleted: every row has status ('active' | 'deleted'), deleted_at, and who created / changed / deleted it.
// "Delete" only marks the row deleted; it then disappears from every read, and the data stays in the table.

import { createClient } from '@supabase/supabase-js';
import { authConfigured, authenticate } from './auth.js';

export const dbConfigured = (env = process.env) => !!(String(env.SUPABASE_URL || '').trim() && String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim());
export const guestAllowed = (env = process.env) => String(env.ALLOW_GUEST || '').trim().toLowerCase() !== 'false';

const PAGE = 1000; // Supabase returns at most 1000 rows per request: bigger reads are fetched page by page
const MAX_BODY_CHARS = 3_500_000;
const CHUNK = 200;
const DOC_META = ['id', 'status', 'created_by', 'title', 'doc_type', 'industry', 'industry_main', 'industry_sub', 'language', 'problem_signature', 'created'];
const DOC_FULL = [...DOC_META, 'sections', 'full_text', 'html'];
const REC_COLS = ['id', 'doc_id', 'doc_title', 'lever', 'other_category', 'related_to', 'claim_en', 'claim_zh', 'quote', 'impact', 'section'];
const REC_SYSTEM = new Set([...REC_COLS, 'status', 'created_by', 'updated_by', 'deleted_by', 'deleted_at', 'position', 'extra', 'created_at', 'updated_at', '_score']);

let client = null;
const getClient = (env) => (client ||= createClient(String(env.SUPABASE_URL).trim(), String(env.SUPABASE_SERVICE_ROLE_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } }));

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const must = (res, what) => { if (res.error) throw new Error(`Supabase ${what} failed: ${res.error.message || res.error}`); return res.data; };
const chunks = (arr, n = CHUNK) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const str = (v, max = 100000) => (v === undefined || v === null ? null : String(v).slice(0, max));
const nowIso = () => new Date().toISOString();

/* Reads every row of a query, page by page. `build(from, to)` returns the query for that range. */
async function selectAll(build, what) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = must(await build(from, from + PAGE - 1), what);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

// ── row <-> app object ──
const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
const docFromRow = (r) => prune(Object.fromEntries(DOC_FULL.filter((c) => c in r).map((c) => [c, r[c]])));
const indexFromRow = (r) => prune(Object.fromEntries(DOC_META.filter((c) => c in r).map((c) => [c, r[c]])));
function recordFromRow(r) {
  const base = prune(Object.fromEntries([...REC_COLS, 'status', 'created_by'].filter((c) => c in r).map((c) => [c, r[c]])));
  return { ...(r.extra && typeof r.extra === 'object' ? r.extra : {}), ...base };
}
function docToRow(d, by) {
  if (!d || typeof d.id !== 'string' || !d.id || d.id.length > 100) throw bad('Bad document');
  return {
    id: d.id, title: str(d.title, 500) || '', doc_type: str(d.doc_type, 60), industry: str(d.industry, 300), industry_main: str(d.industry_main, 300),
    industry_sub: str(d.industry_sub, 300), language: str(d.language, 20), problem_signature: str(d.problem_signature, 3000),
    sections: Array.isArray(d.sections) ? d.sections : [], full_text: str(d.full_text, 400000) || '', html: str(d.html, 400000) || '',
    created: Number.isFinite(Number(d.created)) ? Number(d.created) : Date.now(),
    status: 'active', deleted_at: null, deleted_by: null, updated_by: by, updated_at: nowIso(),
  };
}
function recordToRow(r, position, by) {
  if (!r || typeof r.id !== 'string' || !r.id || typeof r.doc_id !== 'string' || !r.doc_id || typeof r.lever !== 'string' || !r.lever) throw bad('Bad record');
  const extra = Object.fromEntries(Object.entries(r).filter(([k, v]) => !REC_SYSTEM.has(k) && v !== undefined));
  return {
    id: r.id, doc_id: r.doc_id, doc_title: str(r.doc_title, 500), lever: str(r.lever, 200), other_category: str(r.other_category, 200), related_to: str(r.related_to, 1000),
    claim_en: str(r.claim_en), claim_zh: str(r.claim_zh), quote: str(r.quote), impact: str(r.impact), section: str(r.section, 1000),
    extra, position, status: 'active', deleted_at: null, deleted_by: null, updated_by: by, updated_at: nowIso(),
  };
}

// ── lever definitions <-> the app's config object ──
const trim = (v, max) => String(v === undefined || v === null ? '' : v).trim().slice(0, max);
function configFromRows(rows) {
  const cfg = { customLevers: [], leverOverrides: {}, customOtherCats: [], otherCatOverrides: {} };
  const sorted = [...rows].sort((a, b) => (a.sort_order - b.sort_order) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  for (const r of sorted) {
    if (r.kind === 'custom') cfg.customLevers.push({ id: r.id, name: r.name || '', description: r.definition || '', example: r.example || '', headings: r.headings || '' });
    else if (r.kind === 'builtin_override') cfg.leverOverrides[r.id] = prune({ name: r.name || undefined, description: r.definition || undefined, headings: r.headings || undefined });
    else if (r.kind === 'sub_custom') cfg.customOtherCats.push({ id: r.id, name: r.name || '', description: r.definition || '' });
    else if (r.kind === 'sub_override') cfg.otherCatOverrides[r.id] = prune({ name: r.name || undefined, description: r.definition || undefined });
  }
  return cfg;
}
function rowsFromConfig(cfg, by) {
  const out = [];
  const base = { status: 'active', deleted_at: null, deleted_by: null, updated_by: by, updated_at: nowIso() };
  const id = (v) => { const s = trim(v, 160); if (!s) throw bad('Bad lever id'); return s; };
  (Array.isArray(cfg.customLevers) ? cfg.customLevers : []).forEach((l, i) => out.push({ ...base, id: id(l.id), kind: 'custom', name: trim(l.name, 200), definition: trim(l.description, 4000), example: trim(l.example, 4000), headings: trim(l.headings, 1000), sort_order: i }));
  Object.entries(cfg.leverOverrides && typeof cfg.leverOverrides === 'object' ? cfg.leverOverrides : {}).forEach(([k, o], i) => out.push({ ...base, id: id(k), kind: 'builtin_override', name: trim(o && o.name, 200), definition: trim(o && o.description, 4000), example: '', headings: trim(o && o.headings, 1000), sort_order: i }));
  (Array.isArray(cfg.customOtherCats) ? cfg.customOtherCats : []).forEach((c, i) => out.push({ ...base, id: id(c.id), kind: 'sub_custom', name: trim(c.name, 200), definition: trim(c.description, 4000), example: '', headings: '', sort_order: i }));
  Object.entries(cfg.otherCatOverrides && typeof cfg.otherCatOverrides === 'object' ? cfg.otherCatOverrides : {}).forEach(([k, o], i) => out.push({ ...base, id: id(k), kind: 'sub_override', name: trim(o && o.name, 200), definition: trim(o && o.description, 4000), example: '', headings: '', sort_order: i }));
  const seen = new Set();
  for (const r of out) { if (seen.has(r.id)) throw bad('Duplicate lever id ' + r.id); seen.add(r.id); }
  return out;
}

// ── reads ──
const loadLevers = async (sb) => configFromRows(await selectAll((a, b) => sb.from('levers').select('*').eq('status', 'active').range(a, b), 'read levers'));
const loadIndex = async (sb) => (await selectAll((a, b) => sb.from('documents').select(DOC_META.join(',')).eq('status', 'active').order('created', { ascending: true }).order('id').range(a, b), 'read documents')).map(indexFromRow);
const loadRecords = async (sb) => (await selectAll((a, b) => sb.from('records').select('*').eq('status', 'active').order('created_at', { ascending: true }).order('position', { ascending: true }).order('id').range(a, b), 'read records')).map(recordFromRow);

async function replaceLevers(ctx, cfg) {
  const { sb, user } = ctx;
  const want = rowsFromConfig(cfg, user.email);
  const existing = must(await sb.from('levers').select('id').eq('status', 'active'), 'read levers').map((r) => r.id);
  const wantIds = new Set(want.map((r) => r.id));
  for (const part of chunks(want)) must(await sb.from('levers').upsert(part), 'write levers');
  const gone = existing.filter((i) => !wantIds.has(i));
  for (const part of chunks(gone)) must(await sb.from('levers').update({ status: 'deleted', deleted_at: nowIso(), deleted_by: user.email, updated_by: user.email, updated_at: nowIso() }).in('id', part), 'delete levers');
}

const OPS = {
  // ── guest-readable ──
  library: { level: 'guest', run: async ({ sb }) => { const [config, index, records] = await Promise.all([loadLevers(sb), loadIndex(sb), loadRecords(sb)]); return { config, index, records }; } },
  kb: { level: 'guest', run: async ({ sb }) => { const [index, records] = await Promise.all([loadIndex(sb), loadRecords(sb)]); return { index, records }; } },
  document: {
    level: 'guest',
    run: async ({ sb }, a) => {
      const id = trim(a.id, 100); if (!id) throw bad('Bad id');
      const row = must(await sb.from('documents').select(DOC_FULL.join(',')).eq('id', id).eq('status', 'active').maybeSingle(), 'read document');
      return { doc: row ? docFromRow(row) : null };
    },
  },
  documents: {
    level: 'guest',
    run: async ({ sb }, a) => {
      const ids = (Array.isArray(a.ids) ? a.ids : []).map((i) => trim(i, 100)).filter(Boolean).slice(0, 40);
      if (!ids.length) return { docs: [] };
      const rows = must(await sb.from('documents').select(DOC_FULL.join(',')).in('id', ids).eq('status', 'active'), 'read documents');
      return { docs: rows.map(docFromRow) };
    },
  },

  // ── any signed-in user ──
  gap_add: {
    level: 'user',
    run: async ({ sb, user, now }, a) => {
      const q = trim(a.question, 2000); if (!q) throw bad('Empty question');
      must(await sb.from('gap_log').insert({ id: trim(a.id, 60) || `g${now()}`, question: q, at: now(), status: 'active', created_by: user.email }), 'write gap log');
      return {};
    },
  },
  chat_get: {
    level: 'user',
    run: async ({ sb, user }, a) => {
      let uid = user.id;
      if (a.user_id && a.user_id !== user.id) { if (!user.isAdmin) throw new HttpError(403, 'You need an admin account to do that.'); uid = String(a.user_id); }
      const row = must(await sb.from('chats').select('messages').eq('user_id', uid).maybeSingle(), 'read chat');
      return { messages: row && Array.isArray(row.messages) ? row.messages : null };
    },
  },
  chat_save: {
    level: 'user',
    run: async ({ sb, user }, a) => {
      if (!Array.isArray(a.messages) || JSON.stringify(a.messages).length > MAX_BODY_CHARS) throw bad('Bad chat');
      must(await sb.from('chats').upsert({ user_id: user.id, messages: a.messages, updated_at: nowIso() }), 'write chat');
      return {};
    },
  },
  suggestions_get: { level: 'user', run: async ({ sb }) => { const row = must(await sb.from('suggestions').select('value').eq('id', 'current').maybeSingle(), 'read suggestions'); return { value: row ? row.value : null }; } },
  suggestions_set: { level: 'user', run: async ({ sb, user }, a) => { if (!a.value || typeof a.value !== 'object') throw bad('Bad value'); must(await sb.from('suggestions').upsert({ id: 'current', value: a.value, updated_by: user.email, updated_at: nowIso() }), 'write suggestions'); return {}; } },

  // ── admin ──
  doc_save: {
    level: 'admin',
    run: async ({ sb, user }, a) => {
      const doc = { ...docToRow(a.doc, user.email), created_by: user.email };
      const records = Array.isArray(a.records) ? a.records : [];
      must(await sb.from('documents').upsert(doc), 'write document');
      const rows = records.map((r, i) => ({ ...recordToRow({ ...r, doc_id: doc.id }, i, user.email), created_by: user.email }));
      for (const part of chunks(rows)) must(await sb.from('records').upsert(part), 'write records');
      return { id: doc.id };
    },
  },
  doc_update: {
    level: 'admin',
    run: async ({ sb, user }, a) => {
      const doc = docToRow(a.doc, user.email);
      const records = Array.isArray(a.records) ? a.records : [];
      const existing = must(await sb.from('records').select('id,created_by,status').eq('doc_id', doc.id), 'read records');
      const known = new Map(existing.map((r) => [r.id, r]));
      must(await sb.from('documents').upsert(doc), 'write document');
      const rows = records.map((r, i) => ({ ...recordToRow({ ...r, doc_id: doc.id }, i, user.email), created_by: (known.get(r.id) && known.get(r.id).created_by) || (typeof r.created_by === 'string' ? r.created_by : user.email) }));
      for (const part of chunks(rows)) must(await sb.from('records').upsert(part), 'write records');
      const keep = new Set(rows.map((r) => r.id));
      const gone = existing.filter((r) => r.status === 'active' && !keep.has(r.id)).map((r) => r.id); // removed on the edit screen: marked deleted, kept
      for (const part of chunks(gone)) must(await sb.from('records').update({ status: 'deleted', deleted_at: nowIso(), deleted_by: user.email, updated_by: user.email, updated_at: nowIso() }).in('id', part), 'delete records');
      return { id: doc.id };
    },
  },
  doc_delete: {
    level: 'admin',
    run: async ({ sb, user }, a) => {
      const id = trim(a.id, 100); if (!id) throw bad('Bad id');
      const patch = { status: 'deleted', deleted_at: nowIso(), deleted_by: user.email, updated_by: user.email, updated_at: nowIso() };
      must(await sb.from('documents').update(patch).eq('id', id).eq('status', 'active'), 'delete document');
      must(await sb.from('records').update(patch).eq('doc_id', id).eq('status', 'active'), 'delete records');
      return {};
    },
  },
  record_save: {
    level: 'admin',
    run: async ({ sb, user }, a) => {
      const row = recordToRow(a.record, 0, user.email);
      delete row.position; // keep the record's place inside its document
      must(await sb.from('records').upsert(row), 'write record');
      return {};
    },
  },
  record_delete: {
    level: 'admin',
    run: async ({ sb, user }, a) => {
      const id = trim(a.id, 100); if (!id) throw bad('Bad id');
      must(await sb.from('records').update({ status: 'deleted', deleted_at: nowIso(), deleted_by: user.email, updated_by: user.email, updated_at: nowIso() }).eq('id', id).eq('status', 'active'), 'delete record');
      return {};
    },
  },
  recategorize: { // an Others sub-category was deleted: its records move to another one
    level: 'admin',
    run: async ({ sb, user }, a) => {
      const from = trim(a.from, 200), to = trim(a.to, 200); if (!from || !to) throw bad('Bad category');
      must(await sb.from('records').update({ other_category: to, updated_by: user.email, updated_at: nowIso() }).eq('lever', 'others').eq('other_category', from).eq('status', 'active'), 'update records');
      return {};
    },
  },
  config_save: { level: 'admin', run: async (ctx, a) => { if (!a.config || typeof a.config !== 'object') throw bad('Bad config'); await replaceLevers(ctx, a.config); return {}; } },
  import_docs: {
    level: 'admin',
    run: async ({ sb, user }, a) => {
      const docs = (Array.isArray(a.docs) ? a.docs : []).slice(0, 20);
      const recs = (Array.isArray(a.records) ? a.records : []).slice(0, 2000);
      const have = new Set(must(await sb.from('documents').select('id').in('id', docs.map((d) => String(d && d.id))), 'read documents').map((r) => r.id)); // any status: a deleted one is not resurrected
      const fresh = docs.filter((d) => d && typeof d.id === 'string' && !have.has(d.id));
      for (const d of fresh) must(await sb.from('documents').upsert({ ...docToRow(d, user.email), created_by: (d.created_by || user.email) }), 'write document');
      const docIds = new Set([...have, ...fresh.map((d) => d.id)]);
      const mine = recs.filter((r) => r && typeof r.id === 'string' && docIds.has(r.doc_id));
      const haveRec = new Set();
      for (const part of chunks(mine.map((r) => r.id))) must(await sb.from('records').select('id').in('id', part), 'read records').forEach((r) => haveRec.add(r.id));
      const rows = mine.filter((r) => !haveRec.has(r.id)).map((r, i) => ({ ...recordToRow(r, i, user.email), created_by: (typeof r.created_by === 'string' && r.created_by) || user.email }));
      for (const part of chunks(rows)) must(await sb.from('records').upsert(part), 'write records');
      return { added: fresh.length, records: rows.length };
    },
  },
  config_merge: { // from a backup: add what is missing, never overwrite what exists
    level: 'admin',
    run: async (ctx, a) => {
      const inc = a.config && typeof a.config === 'object' ? a.config : {};
      const cur = await loadLevers(ctx.sb);
      const byId = (mine, theirs) => { const out = [...mine]; const known = new Set(out.map((i) => i.id)); (Array.isArray(theirs) ? theirs : []).forEach((i) => { if (i && i.id && i.name && !known.has(i.id)) { out.push(i); known.add(i.id); } }); return out; };
      const merged = {
        customLevers: byId(cur.customLevers, inc.customLevers),
        customOtherCats: byId(cur.customOtherCats, inc.customOtherCats),
        leverOverrides: { ...(inc.leverOverrides || {}), ...cur.leverOverrides },
        otherCatOverrides: { ...(inc.otherCatOverrides || {}), ...cur.otherCatOverrides },
      };
      await replaceLevers(ctx, merged);
      return { config: await loadLevers(ctx.sb) };
    },
  },
  gap_list: {
    level: 'admin',
    run: async ({ sb }) => ({ log: (await selectAll((a, b) => sb.from('gap_log').select('id,question,at,status').eq('status', 'active').order('at', { ascending: true }).range(a, b), 'read gap log')).map((r) => ({ id: r.id, q: r.question, at: r.at, status: r.status })) }),
  },
  gap_clear: {
    level: 'admin',
    run: async ({ sb, user }) => { must(await sb.from('gap_log').update({ status: 'deleted', deleted_at: nowIso(), deleted_by: user.email }).eq('status', 'active'), 'clear gap log'); return {}; },
  },
};

const json = (status, body) => ({ status, body });

/* req: { method, query, body, headers }  ->  { status, body } */
export async function handleDb(req, { env = process.env, now = Date.now } = {}) {
  const method = String(req.method || 'GET').toUpperCase();
  const q = req.query || {};

  if (method === 'GET' && q.action === 'status') {
    if (!dbConfigured(env)) return json(200, { mode: 'local' });
    if (!authConfigured(env)) return json(200, { mode: 'error', error: 'SUPABASE_ANON_KEY is not set on the server (Supabase → Project Settings → API → anon public key).' });
    return json(200, { mode: 'supabase', url: String(env.SUPABASE_URL).trim(), anonKey: String(env.SUPABASE_ANON_KEY).trim(), guest: guestAllowed(env) });
  }
  if (!dbConfigured(env)) return json(503, { error: 'The shared database is not configured. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY on the server.' });
  if (!authConfigured(env)) return json(503, { error: 'SUPABASE_ANON_KEY is not set on the server.' });

  const signedOut = !/^Bearer\s+\S/i.test(String(Object.entries(req.headers || {}).find(([k]) => k.toLowerCase() === 'authorization')?.[1] || ''));
  const op = method === 'POST' && req.body && typeof req.body.op === 'string' ? OPS[req.body.op] : null;

  let user;
  if (signedOut && op && op.level === 'guest' && guestAllowed(env)) {
    user = { id: null, email: null, isAdmin: false, guest: true };
  } else {
    const a = await authenticate(req.headers, env, now());
    if (!a.ok) return json(a.status, { error: a.error });
    user = a.user;
  }
  if (method === 'GET' && q.action === 'me') return json(200, user);
  if (method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!op) return json(400, { error: 'Unknown operation' });
  if (op.level === 'admin' && !user.isAdmin) return json(403, { error: 'You need an admin account to do that.' });

  try {
    const out = await op.run({ sb: getClient(env), user, now }, req.body || {});
    return json(200, out || {});
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    console.error('db error:', err.message);
    return json(502, { error: 'The shared database request failed' });
  }
}

export const _test = { configFromRows, rowsFromConfig, recordToRow, recordFromRow };
