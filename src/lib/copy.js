// What gets copied (UX-01): plain text that reads well when pasted into an email, a chat or a slide. Pure functions, no browser needed.
import { docLink } from "./route.js";

const clean = (s) => String(s == null ? "" : s).replace(/[ \t]+\n/g, "\n").trim();
const hasImpact = (v) => { const s = clean(v); return s && !/^(n\/a|na|none|-|—)$/i.test(s); };

/* One strategy (a lever record):
     Smart fees: A small fee filters tiny orders.
     Actual impact: Orders stayed level while margin rose.
     Lever: Price · Source: Acme Bakery: delivery fees (Pricing)
     Link: https://…#/library?doc=d1&section=Pricing                                                                                  */
export function formatStrategy(record, { leverName, docTitle, base } = {}) {
  const lines = [];
  const claim = clean(record.claim_en || record.claim_zh);
  if (claim) lines.push(claim);
  if (hasImpact(record.impact)) lines.push(`Actual impact: ${clean(record.impact)}`);
  if (record.lever === "others" && record.related_to) lines.push(`Related to: ${clean(record.related_to)}`);
  const meta = [];
  if (leverName) meta.push(`Lever: ${leverName}`);
  const title = clean(docTitle || record.doc_title);
  if (title) meta.push(`Source: ${title}${record.section ? ` (${clean(record.section)})` : ""}`);
  if (meta.length) lines.push(meta.join(" · "));
  if (record.doc_id) lines.push(`Link: ${docLink(record.doc_id, record.section, base)}`);
  return lines.join("\n");
}

/* The model writes light markdown (**bold**, "- " lists). For a paste into an email, drop the markers and keep the structure. */
export function markdownToPlain(text) {
  return String(text == null ? "" : text)
    .replace(/\r\n?/g, "\n")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*[-*•][ \t]+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* An answer with the question it answered and the sources it cites (each source once, with a link). */
export function formatAnswer({ question, answer, citations = [], titleOf, base } = {}) {
  const parts = [];
  if (clean(question)) parts.push(`Question: ${clean(question)}`);
  parts.push(markdownToPlain(answer));
  const seen = new Set();
  const sources = [];
  for (const c of citations || []) {
    if (!c || !c.doc_id) continue;
    const key = `${c.doc_id}|${c.section || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = clean(c.doc_title || (titleOf && titleOf(c.doc_id)) || c.doc_id);
    sources.push(`• ${title}${c.section ? ` (${clean(c.section)})` : ""}: ${docLink(c.doc_id, c.section, base)}`);
  }
  if (sources.length) parts.push(`Sources:\n${sources.join("\n")}`);
  return parts.filter(Boolean).join("\n\n");
}
