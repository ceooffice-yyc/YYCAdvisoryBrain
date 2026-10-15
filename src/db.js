// window.db: everything the app reads and writes (documents, lever records, lever definitions, gap log, chat, suggestions).
// Two implementations behind ONE interface:
//   • makeRemoteDb: the shared Supabase tables, through the server's /api/db (src/storage.js adds the sign-in);
//   • makeLocalDb:  this browser's localStorage (no shared database configured): the original behaviour, same data layout as before.
//
// Nothing is hard-deleted in either: every document / record / gap entry carries status "active" | "deleted" and deleting only
// marks it. Reads return active items only. Lever definitions (custom levers, edits to built-in levers, Others sub-categories) are
// handed to the app as the same `config` object it always used; remotely they are rows of the `levers` table.

const isLive = (x) => !x || x.status !== "deleted";
const live = (arr) => (Array.isArray(arr) ? arr.filter(isLive) : []);
const me = (storage) => (storage.user && storage.user.email) || undefined;
const markDeleted = (storage, x) => ({ ...x, status: "deleted", deleted_at: Date.now(), deleted_by: me(storage) });
const META_FIELDS = ["id", "status", "created_by", "title", "doc_type", "industry", "industry_main", "industry_sub", "language", "problem_signature", "created"];
const metaOf = (doc) => Object.fromEntries(META_FIELDS.filter((k) => doc[k] !== undefined).map((k) => [k, doc[k]]));

/* ───────────────────────── local (browser) ───────────────────────── */
export function makeLocalDb(storage) {
  const rd = async (key, shared = true) => { try { const r = await storage.get(key, shared); return r ? JSON.parse(r.value) : null; } catch { return null; } };
  const wr = async (key, val, shared = true) => { await storage.set(key, JSON.stringify(val), shared); };
  const del = (x) => markDeleted(storage, x);

  return {
    remote: false,
    prefetch() {},
    peek() { return null; },
    warmDocuments() {},

    async loadLibrary() {
      let config = await rd("kb:config");
      if (!config) { config = { adminPass: "12345" }; await wr("kb:config", config); }
      const [index, records] = await Promise.all([rd("kb:index"), rd("kb:levers")]);
      return { config, index: live(index), records: live(records) };
    },
    async loadKB() { const [index, records] = await Promise.all([rd("kb:index"), rd("kb:levers")]); return { index: live(index), records: live(records) }; },
    async getDocument(id) { const d = await rd("kb:doc:" + id); return d && isLive(d) ? d : null; },
    async getDocuments(ids) { return (await Promise.all(ids.map((i) => this.getDocument(i)))).filter(Boolean); },

    async saveDocument(doc, records) {
      await wr("kb:doc:" + doc.id, doc);
      const idx = (await rd("kb:index")) || [];
      idx.push(metaOf(doc));
      await wr("kb:index", idx);
      const all = (await rd("kb:levers")) || [];
      all.push(...records);
      await wr("kb:levers", all);
    },
    async updateDocument(doc, records) {
      await wr("kb:doc:" + doc.id, doc);
      const idx = ((await rd("kb:index")) || []).map((d) => (d.id === doc.id ? { ...metaOf(doc), status: d.status || "active", created: doc.created || d.created } : d));
      await wr("kb:index", idx);
      const stored = (await rd("kb:levers")) || [];
      const others = stored.filter((l) => l.doc_id !== doc.id);
      const keep = new Set(records.map((l) => l.id));
      // records of this document that are no longer on the edit screen stay in storage, marked deleted
      const gone = stored.filter((l) => l.doc_id === doc.id && !keep.has(l.id)).map((l) => (isLive(l) ? del(l) : l));
      await wr("kb:levers", [...others, ...gone, ...records]);
    },
    async deleteDocument(id) {
      const doc = await rd("kb:doc:" + id);
      if (doc && isLive(doc)) await wr("kb:doc:" + id, del(doc));
      await wr("kb:index", ((await rd("kb:index")) || []).map((d) => (d.id === id && isLive(d) ? del(d) : d)));
      await wr("kb:levers", ((await rd("kb:levers")) || []).map((l) => (l.doc_id === id && isLive(l) ? del(l) : l)));
    },
    async saveRecord(rec) { await wr("kb:levers", ((await rd("kb:levers")) || []).map((r) => (r.id === rec.id ? { ...rec } : r))); }, // the full record: fields the app removed (e.g. other_category) must go
    async deleteRecord(id) { await wr("kb:levers", ((await rd("kb:levers")) || []).map((r) => (r.id === id && isLive(r) ? del(r) : r))); },
    async recategorize(from, to) {
      await wr("kb:levers", ((await rd("kb:levers")) || []).map((r) => (r.lever === "others" && r.other_category === from ? { ...r, other_category: to } : r)));
    },
    async saveConfig(cfg) { await wr("kb:config", cfg); return cfg; },

    async importCheck(ids) { // which backup documents are already here (active / previously deleted)
      const raw = (await rd("kb:index")) || [];
      const want = new Set(ids);
      return { exists: raw.filter((d) => want.has(d.id) && isLive(d)).map((d) => d.id), deleted: raw.filter((d) => want.has(d.id) && !isLive(d)).map((d) => d.id) };
    },
    async importBackup(parsed) {
      let addedRecords = 0;
      const curIndex = (await rd("kb:index")) || [];
      const curIds = new Set(curIndex.map((d) => d.id));
      let added = 0;
      for (const doc of parsed.docs) {
        if (!doc?.id || curIds.has(doc.id)) continue; // skip duplicates by id
        await wr("kb:doc:" + doc.id, { status: "active", ...doc });
        const meta = (parsed.index || []).find((x) => x.id === doc.id);
        curIndex.push({ status: "active", ...(meta || metaOf(doc)) });
        curIds.add(doc.id);
        added++;
      }
      await wr("kb:index", curIndex);
      const curLevers = (await rd("kb:levers")) || [];
      const leverIds = new Set(curLevers.map((l) => l.id));
      (Array.isArray(parsed.levers) ? parsed.levers : []).forEach((l) => {
        if (l?.id && !leverIds.has(l.id) && curIds.has(l.doc_id)) { curLevers.push({ status: "active", ...l }); leverIds.add(l.id); addedRecords++; }
      });
      await wr("kb:levers", curLevers);
      // keep local settings and passcode, but merge the category definitions needed to label imported records
      const pc = parsed.config || {};
      const hasCfg = [pc.customLevers, pc.customOtherCats].some((x) => Array.isArray(x) && x.length) || [pc.leverOverrides, pc.otherCatOverrides].some((x) => x && typeof x === "object" && Object.keys(x).length);
      let config = null;
      if (hasCfg) {
        const local = (await rd("kb:config")) || {};
        const mergeById = (mine = [], theirs = [], ok) => {
          const out = [...mine]; const known = new Set(out.map((i) => i.id));
          (Array.isArray(theirs) ? theirs : []).forEach((i) => { if (i?.id && ok(i) && !known.has(i.id)) { out.push(i); known.add(i.id); } });
          return out;
        };
        config = {
          ...local,
          customLevers: mergeById(local.customLevers, pc.customLevers, (i) => i.name),
          customOtherCats: mergeById(local.customOtherCats, pc.customOtherCats, (i) => i.name),
          leverOverrides: { ...(pc.leverOverrides || {}), ...(local.leverOverrides || {}) },
          otherCatOverrides: { ...(pc.otherCatOverrides || {}), ...(local.otherCatOverrides || {}) },
        };
        await wr("kb:config", config);
      }
      return { added, records: addedRecords, config };
    },
    async exportAll() {
      const [config, index, records] = [await rd("kb:config"), live(await rd("kb:index")), live(await rd("kb:levers"))];
      const docs = (await Promise.all(index.map((d) => this.getDocument(d.id)))).filter(Boolean);
      return { config, index, levers: records, docs };
    },

    async gapList() { return live(await rd("kb:gaplog")).map((g) => ({ q: g.q, at: g.at })); },
    async gapAdd(question) { const log = (await rd("kb:gaplog")) || []; log.push({ id: `g${Date.now()}`, status: "active", q: question, at: Date.now() }); await wr("kb:gaplog", log); },
    async gapClear() { await wr("kb:gaplog", ((await rd("kb:gaplog")) || []).map((g) => (isLive(g) ? del(g) : g))); },

    async chatLoad() { const m = await rd("kb:chatlog", false); return Array.isArray(m) ? m : null; },
    async chatSave(messages) { await wr("kb:chatlog", messages.slice(-80), false); },

    async suggestionsGet() { return rd("kb:suggestions"); },
    async suggestionsSet(value) { await wr("kb:suggestions", value); },
  };
}

/* ───────────────────────── shared database (Supabase) ───────────────────────── */
const PREFETCH_TTL_MS = 60_000;
const DOC_TTL_MS = 5 * 60_000;
const DOC_MAX = 60;
const PEEK_KEY = "yyc:cache:v2:library";
const PEEK_MAX_CHARS = 3_000_000;

export function makeRemoteDb(storage) {
  let pre = null; // { at, p }: the library, prefetched (single use)
  const docs = new Map(); // id -> { at, doc }
  const inflight = new Map();

  const call = async (op, args = {}, opts = {}) => {
    const { res, data } = await storage.api("POST", { body: { op, ...args }, quiet: !!opts.quiet });
    if (!res.ok) throw new Error((data && data.error) || `Shared database error (${res.status})`);
    return data || {};
  };
  const keepCopy = (lib) => { try { const s = JSON.stringify(lib); if (s.length < PEEK_MAX_CHARS) localStorage.setItem(PEEK_KEY, s); else localStorage.removeItem(PEEK_KEY); } catch { /* storage full or blocked: just no local copy */ } };
  const dropCaches = () => { pre = null; docs.clear(); inflight.clear(); try { localStorage.removeItem(PEEK_KEY); } catch { /* ignore */ } };
  const forgetDoc = (id) => { docs.delete(id); pre = null; };
  const fillDocs = (list) => list.forEach((d) => { if (docs.size >= DOC_MAX) docs.delete(docs.keys().next().value); docs.set(d.id, { at: Date.now(), doc: d }); });
  const fresh = (e) => e && Date.now() - e.at < DOC_TTL_MS;

  const db = {
    remote: true,

    /* Load the whole library in ONE request, in the background; loadLibrary() picks it up. */
    prefetch() {
      const p = call("library", {}, { quiet: true });
      p.catch(() => { /* loadLibrary() falls back to a normal request */ });
      pre = { at: Date.now(), p };
    },
    /* The copy kept in this browser, for painting the page instantly while the fresh copy loads. */
    peek() { try { const raw = localStorage.getItem(PEEK_KEY); const o = raw ? JSON.parse(raw) : null; return o && o.index && o.records ? o : null; } catch { return null; } },

    async loadLibrary() {
      let lib = null;
      if (pre) { const hit = pre; pre = null; if (Date.now() - hit.at < PREFETCH_TTL_MS) { try { lib = await hit.p; } catch { lib = null; } } }
      if (!lib) lib = await call("library");
      keepCopy(lib);
      return { config: lib.config || {}, index: lib.index || [], records: lib.records || [] };
    },
    async loadKB() {
      const kb = await call("kb");
      const prev = db.peek();
      if (prev) keepCopy({ ...prev, index: kb.index, records: kb.records });
      return { index: kb.index || [], records: kb.records || [] };
    },

    /* Documents for READING come from memory when read in the last few minutes; pass {fresh:true} before changing one. */
    async getDocument(id, opts = {}) {
      if (!opts.fresh && fresh(docs.get(id))) return docs.get(id).doc;
      if (!opts.fresh && inflight.has(id)) return inflight.get(id);
      const p = call("document", { id }).then((r) => { if (r.doc) fillDocs([r.doc]); return r.doc || null; }).finally(() => inflight.delete(id));
      if (!opts.fresh) inflight.set(id, p);
      return p;
    },
    async getDocuments(ids) {
      // the result is built from what was fetched, not re-read from the memory cache: the cache holds at most DOC_MAX documents,
      // so with a bigger library it would have dropped the earlier ones and Ask the Brain would silently search only part of it
      const got = new Map(ids.filter((i) => fresh(docs.get(i))).map((i) => [i, docs.get(i).doc]));
      const missing = ids.filter((i) => !got.has(i));
      for (let i = 0; i < missing.length; i += 40) {
        const part = (await call("documents", { ids: missing.slice(i, i + 40) })).docs || [];
        fillDocs(part);
        part.forEach((d) => got.set(d.id, d));
      }
      return ids.map((i) => got.get(i)).filter(Boolean);
    },
    /* Ask the Brain, answered on the server (POST /api/ask). Throws an Error with { kind, waitSec } for rate limits, so the screen can say how
       long to wait, and kind "unavailable" when this server has no /api/ask (the caller then runs the same pipeline in the browser). */
    async ask(payload) {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json", ...(await storage.authHeader()) }, body: JSON.stringify(payload) });
      let data = null;
      try { data = await res.json(); } catch { /* empty body */ }
      if (res.status === 401) window.dispatchEvent(new Event("yyc-auth-expired"));
      if (!res.ok) {
        const err = new Error((data && data.error) || `Ask the Brain failed (${res.status})`);
        err.status = res.status;
        err.kind = res.status === 404 || res.status === 501 ? "unavailable" : data && data.kind;
        err.waitSec = data && data.waitSec;
        throw err;
      }
      return data;
    },
    async askLog(filter) { return (await call("ask_log_list", { filter, limit: 100 })).log || []; }, // admin: recent questions and how they went
    async askFeedback(id, rating, note) { await call("ask_feedback", { id, rating, note }, { quiet: true }); },

    /* Load documents into memory in the background (hover, opening Ask the Brain). Never throws. */
    async warmDocuments(ids) { try { await db.getDocuments([...new Set(ids)].slice(0, DOC_MAX)); } catch { /* fetched when needed */ } },

    async saveDocument(doc, records) { pre = null; await call("doc_save", { doc, records }); forgetDoc(doc.id); },
    async updateDocument(doc, records) { await call("doc_update", { doc, records }); forgetDoc(doc.id); },
    async deleteDocument(id) { await call("doc_delete", { id }); forgetDoc(id); },
    async saveRecord(rec) { pre = null; await call("record_save", { record: rec }); },
    async deleteRecord(id) { pre = null; await call("record_delete", { id }); },
    async recategorize(from, to) { pre = null; await call("recategorize", { from, to }); },
    async saveConfig(cfg) { pre = null; await call("config_save", { config: cfg }); return cfg; },

    async importCheck(ids) {
      const out = { exists: [], deleted: [] };
      for (let i = 0; i < ids.length; i += 200) { const r = await call("import_check", { ids: ids.slice(i, i + 200) }); out.exists.push(...(r.exists || [])); out.deleted.push(...(r.deleted || [])); }
      return out;
    },
    async importBackup(parsed) {
      let addedRecords = 0;
      const backupDocs = (parsed.docs || []).filter((d) => d && d.id);
      const recs = Array.isArray(parsed.levers) ? parsed.levers : [];
      let added = 0;
      for (let i = 0; i < backupDocs.length; i += 5) {
        const part = backupDocs.slice(i, i + 5);
        const ids = new Set(part.map((d) => d.id));
        const out = await call("import_docs", { docs: part, records: recs.filter((r) => ids.has(r.doc_id)) });
        added += out.added || 0;
        addedRecords += out.records || 0;
      }
      pre = null;
      const pc = parsed.config || {};
      const hasCfg = [pc.customLevers, pc.customOtherCats].some((x) => Array.isArray(x) && x.length) || [pc.leverOverrides, pc.otherCatOverrides].some((x) => x && typeof x === "object" && Object.keys(x).length);
      const config = hasCfg ? (await call("config_merge", { config: pc })).config : null;
      return { added, records: addedRecords, config };
    },
    async exportAll() {
      const lib = await call("library");
      const out = [];
      for (let i = 0; i < lib.index.length; i += 20) out.push(...((await call("documents", { ids: lib.index.slice(i, i + 20).map((d) => d.id) })).docs || []));
      return { config: lib.config, index: lib.index, levers: lib.records, docs: out };
    },

    async gapList() { return ((await call("gap_list")).log || []).map((g) => ({ q: g.q, at: g.at })); },
    async gapAdd(question) { await call("gap_add", { question }); },
    async gapClear() { await call("gap_clear"); },

    async chatLoad() { const m = (await call("chat_get")).messages; return Array.isArray(m) ? m : null; },
    async chatSave(messages) { await call("chat_save", { messages: messages.slice(-500) }); },

    async suggestionsGet() { return (await call("suggestions_get")).value || null; },
    async suggestionsSet(value) { await call("suggestions_set", { value }); },
  };

  storage.hooks.signedIn = () => db.prefetch();
  storage.hooks.signedOut = dropCaches;
  return db;
}

export function installDb() {
  window.db = window.storage.remote ? makeRemoteDb(window.storage) : makeLocalDb(window.storage);
  return window.db;
}
