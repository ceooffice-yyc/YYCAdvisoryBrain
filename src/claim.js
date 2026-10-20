// Pure helpers for a lever record's text and for the review screen shown after an AI extraction (before the document is saved).
// No React and no browser APIs here, so they are covered by `npm test`.

/* A record's claim is one text, "Strategy title: description". -> { name, desc } ("name" is empty when there is no title). */
export function splitClaim(text) {
  const s = String(text || "").trim();
  const i = s.indexOf(": ");
  if (i > 0 && i <= 120) return { name: s.slice(0, i), desc: s.slice(i + 2) };
  // Also support a title-only strategy stored as "Title:" with an empty description.
  if (s.endsWith(":") && s.length > 1 && s.length <= 121) return { name: s.slice(0, -1), desc: "" };
  return { name: "", desc: s };
}

/* The reverse: the trimmed combined text that is stored. */
export function combineClaim(name, desc) {
  const n = String(name || "").trim();
  const d = String(desc || "").trim();
  return n ? `${n}: ${d}` : d;
}

/* Take lever record number `i` out of an extraction. The removed record is remembered (`removed`, newest last) so it can be brought back.
   Returns a new extraction; the original is not changed. */
export function removeLever(extraction, i) {
  const rec = (extraction.levers || [])[i];
  if (!rec) return extraction;
  return {
    ...extraction,
    levers: extraction.levers.filter((_, k) => k !== i),
    removed: [...(extraction.removed || []), { rec, index: i }],
  };
}

/* Bring back the most recently removed record, in its old position. */
export function undoRemoveLever(extraction) {
  const stack = extraction.removed || [];
  if (!stack.length) return extraction;
  const { rec, index } = stack[stack.length - 1];
  const levers = [...(extraction.levers || [])];
  levers.splice(Math.min(index, levers.length), 0, rec);
  return { ...extraction, levers, removed: stack.slice(0, -1) };
}
