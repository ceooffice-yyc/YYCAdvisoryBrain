// Plain helpers for saving or discarding several extracted documents at once (the bulk list); no React or browser code, so `npm test` covers them.
import { hasClaimText } from "./claim.js";

const SIMILAR_AT = 0.35; // the same cut-off the review screen uses for its "similar to an existing record" warning

/** What the person should know about one extracted item before saving it: how many records it would save, how many look like records already in the library, and its warnings. */
export function itemFlags(item, existing, similarity) {
  const ex = (item && item.extraction) || {};
  const real = (ex.levers || []).filter((l) => !l.skip && hasClaimText(l));
  let similar = 0;
  for (const lr of real) {
    const sameLever = (existing || []).filter((e) => e.lever === lr.lever);
    if (sameLever.some((e) => Math.max(similarity(lr.claim_en, e.claim_en), similarity(lr.claim_zh, e.claim_zh)) >= SIMILAR_AT)) similar++;
  }
  return { records: real.length, similar, warnings: (ex.notices || []).filter((n) => n.level === "warn").map((n) => n.text) };
}

// An item is ticked for you only when it is ready and has nothing to check: records to save, no warning, nothing similar already in the library.
export const isTickedByDefault = (item, flags) => !!item && item.status === "done" && !!flags && flags.records > 0 && flags.warnings.length === 0 && flags.similar === 0;

/** What is ticked for an item: the person's own choice if they made one, otherwise the default rule. */
export function isTicked(item, userTicks, flags) {
  if (!item || item.status !== "done") return false;
  const own = userTicks && userTicks[item.id];
  return own === undefined ? isTickedByDefault(item, flags) : !!own;
}

/** The numbers shown in the confirmation: documents and records to save, and how many ticked items still have a warning or a similar record. */
export function summarizeTicked(items, userTicks, flagsOf) {
  const ticked = items.filter((it) => isTicked(it, userTicks, flagsOf(it)));
  return {
    ids: ticked.map((it) => it.id),
    docs: ticked.length,
    records: ticked.reduce((n, it) => n + flagsOf(it).records, 0),
    flagged: ticked.filter((it) => flagsOf(it).warnings.length > 0 || flagsOf(it).similar > 0).length,
  };
}

/** Saves the items one by one; one failing never stops the rest. -> { saved: [ids], failed: [{ id, error }] } */
export async function saveMany(items, save, onProgress = () => {}) {
  const saved = [], failed = [];
  for (let k = 0; k < items.length; k++) {
    try { await save(items[k]); saved.push(items[k].id); } catch (e) { failed.push({ id: items[k].id, error: String((e && e.message) || e) }); }
    onProgress({ done: k + 1, total: items.length });
  }
  return { saved, failed };
}
