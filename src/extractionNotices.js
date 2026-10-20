// Notices for the top of the review screen (things to check before saving), each { level: "info" | "warn", text }; plain functions, so `npm test` covers them.

// How much of a document is kept when it is saved (the rest is dropped, and so is not searchable or indexed).
export const FULL_TEXT_LIMIT = 60000;

/** Warn when a document is longer than what will be saved. */
export function saveLimitNotice(text) {
  const n = String(text || "").length;
  return n > FULL_TEXT_LIMIT
    ? [{ level: "warn", text: `This document has ${n.toLocaleString("en-US")} characters but only the first ${FULL_TEXT_LIMIT.toLocaleString("en-US")} are saved. The last ${(n - FULL_TEXT_LIMIT).toLocaleString("en-US")} characters will not be searchable. Consider splitting it into two documents.` }]
    : [];
}

/** Add notices to an extraction without losing the ones already on it. */
export function withNotices(extraction, extra) {
  if (!extraction || !extra || !extra.length) return extraction;
  return { ...extraction, notices: [...(extraction.notices || []), ...extra] };
}
