// Small helpers: personal browser storage, "is this deleted", timing text, token estimates, ids, titles.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { tokenizeQuery } from "../../server/ask/text.js";

// Personal, per-browser values only (UI hints). The library itself is read and written through window.db (src/db.js).
// eslint-disable-next-line no-unused-vars -- kept for the language switch that is turned off for now
async function sget(key, shared = true) {
  try { const r = await window.storage.get(key, shared); return r ? JSON.parse(r.value) : null; }
  catch { return null; }
}
// eslint-disable-next-line no-unused-vars -- kept for the language switch that is turned off for now
async function sset(key, val, shared = true) {
  const r = await window.storage.set(key, JSON.stringify(val), shared);
  if (!r) throw new Error("storage write failed");
}

/* Nothing is hard-deleted. Every stored item (document, index entry, lever record, chat message, gap-log entry) has a status:
   "active" (missing = active, for older data) or "deleted" (kept in storage with deleted_at, hidden everywhere in the app). */
export const isLive = (x) => !x || x.status !== "deleted";
export const me = () => (window.storage?.user && window.storage.user.email) || undefined; // signed-in user (shared database), for the audit trail
export const softDelete = (x) => ({ ...x, status: "deleted", deleted_at: Date.now(), deleted_by: me() });

export const fmtElapsed = (ms) => { const sec = Math.round(ms / 1000); return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`; };
export function estimateTokens(str) { return Math.ceil((str || "").length / 3.5); }


export function claimSimilarity(a, b) {
  const A = new Set(tokenizeQuery(a));
  const B = new Set(tokenizeQuery(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter++; });
  return inter / (A.size + B.size - inter);
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* "14. YETI d" / "13. Bobbie-d" -> "YETI" / "Bobbie": drops the leading list number and a trailing lone lowercase marker letter (a draft suffix) */
export function cleanDocTitle(s) {
  const t = String(s || "")
    .replace(/^\s*\d+\s*[.)_-]\s*/, "")
    .replace(/[\s_-]+[a-z]$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return t || String(s || "").trim();
}