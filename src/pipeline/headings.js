// Reads headings: which lever a heading names, which M&A section it is, and whether a document is an M&A document. Small, so the screens can use it without the whole extraction code.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { wordCount } from "./text.js";
import { EXTRA_HEADING_LEVER } from "../lib/levers.js";

/* ---------- extraction pipeline (shared by single + bulk upload) ---------- */
/* Split on blank lines so a named strategy's paragraphs stay together. One giant call
   made the model (and its hidden reasoning) run out of output budget and silently drop
   the LAST sections (Talent, Other Strategies, Failed Strategies). Small chunks = every
   part of the doc gets its own full output budget. */
/* A lever heading is a SHORT line with no sentence punctuation that names a lever (Pricing, Volume, "Unique Product
   Differentiation/Position", "Talent Strategy:"…) or an "other strategies" group ("Other Key Strategies For Growth",
   "Strategies Used to Grow MadeGood"). Detected structurally, so new heading wordings in new documents still work. */
function leverHeadingRaw(p) {
  const x = String(p || "").trim().replace(/:$/, "").trim();
  if (!x || x.length > 90 || /\n/.test(x) || /[.!?]$/.test(x)) return null;
  if (MNA_SECTION_RE.test(x)) return x; // M&A section headings may be long ("What <Company> Brings to Acquired Companies")
  const words = wordCount(x);
  // the line must BE a heading phrase, not merely start with a lever word ("Customer pays before fulfilment" is a strategy title, not "Customers")
  const hit = words <= 5 ? [...EXTRA_HEADING_LEVER, ...HEADING_LEVER].find(([re]) => re.test(x)) : null;
  if (hit) {
    const rest = x.slice(x.match(hit[0])[0].length);
    if (/^(\s*\([^)]{1,30}\))?[\s/&,-]*(and\s+)?(days?|strateg(y|ies)|position(ing)?|growth|levers?)?[\s:]*$/i.test(rest)) return x; // "Receivable Days", "Payable Days", "Talent Strategy", "AP (Payables)"
  }
  if (words <= 8 && /^(other\b[^.]*strateg|strategies\s+(used\s+)?(to|for)\b|key strategies\b|shareholders?\b[^.]*strateg|ownership\b[^.]*strateg|(additional|further|supporting|more)\b[^.]*(strateg|growth))/i.test(x)) return x;
  // a short line that ends with a colon and names strategies/growth is a group heading ("Additional Cash & Growth Strategies:")
  if (words <= 8 && /:\s*$/.test(String(p || "").trim()) && /\b(strateg(y|ies)|growth)\b/i.test(x) && !/^(?:its|their|this|these|those|it|they|we|our)\b/i.test(x)) return x; // "Its growth model therefore combines:" is a sentence, not a heading
  return null;
}
// numbering ("4. Acquisition Criteria") is not part of the heading's name
export function leverHeadingOf(p) { const h = leverHeadingRaw(p); return h ? h.replace(/^\s*\d+\s*[.)]\s*/, "") : h; }
export const KNOWN_HEADING = { test: (p) => !!leverHeadingOf(p) }; // keeps the old .test() call sites working
// A heading-looking line right after a paragraph that ends with ":" is a LIST ITEM of that paragraph ("The two major reasons deals fail are:" → "Valuation"), not a heading.
export const isHeadingAt = (arr, i) => !!leverHeadingOf(arr[i]) && !(i > 0 && /:\s*$/.test(String(arr[i - 1] || "").trim()));

/* M&A case studies ("M&A Strategy Summary") are organised by section headings such as "3. Acquisition M&A Appetite",
   "4. Acquisition Criteria", "5. Post-Acquisition Strategy", "6. What <Company> Brings to Acquired Companies".
   Matching is on the WHOLE heading line, never on a keyword somewhere in the text, so an ordinary case study that merely
   mentions an acquisition (Build A Bear's UK acquisition, an "acquisition engine") is NOT treated as an M&A document. */
const MNA_SECTION_RE = /^(?:\d+\s*[.)]?\s*)?(?:(?:acquisition\s+)?m\s*&\s*a\s+(?:appetite|criteria|approach|thesis|strategy(?:\s+summary)?)(?:\s*(?:&|and)\s+[A-Za-z][A-Za-z ]{2,40})?|acquisition\s+(?:criteria|appetite|approach)|post[- ]?(?:acquisition|merger|deal)\s+(?:strategy|approach|integration|model)|what\s+.{1,50}?\s+(?:brings?|provides?|offers?|gives?)\s+to\s+(?:acquired|portfolio|target)\s+(?:compan(?:y|ies)|businesses))\s*:?\s*$/i;
export function mnaSectionKind(p) {
  const label = String(p || "").trim().replace(/^\s*\d+\s*[.)]\s*/, "").replace(/[:：]\s*$/, "");
  if (!MNA_SECTION_RE.test(label)) return "";
  if (/criteria/i.test(label)) return "criteria";
  if (/post/i.test(label)) return "post_acquisition";
  if (/(?:brings?|provides?|offers?|gives?)\s+to/i.test(label)) return "company_support";
  return "appetite";
}

// Which M&A sections are lists of numbered, titled items ("6.1 …", "6.2 …")? Those get one record per item; only an untitled list under "What <Company> Brings…" is folded into one.
export function mnaNumberedKinds(body) {
  const counts = {};
  let kind = "";
  for (const p of String(body || "").split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
    const k = mnaSectionKind(p);
    if (k) { kind = k; continue; }
    if (kind && /^\d+\.\d+\s+\S/.test(p) && p.length <= 120) counts[kind] = (counts[kind] || 0) + 1;
  }
  return new Set(Object.keys(counts).filter((k) => counts[k] >= 2));
}

/* The lever is decided by the HEADING a strategy sits under, not by how the strategy "sounds" (e.g. a USP or brand-value
   strategy listed under "Pricing" is still a price strategy). The model gets this wrong, so code enforces it. */
const HEADING_LEVER = [
  [MNA_SECTION_RE, "acquisition_expansion_valuation"],
  [/^(pricing|price)\b/i, "price"],
  [/^(volume|sales|customers?|demand)\b/i, "volume"],
  [/^(cost of goods sold|cogs|cost of sales|margin)\b/i, "cogs"],
  [/^(overheads?|fixed costs?)\b/i, "overheads"],
  [/^(inventory|stock)\b/i, "inventory_days"],
  [/^(accounts )?(receivables?|collections?)\b|^ar\b/i, "ar_days"],
  [/^(accounts )?payables?\b|^ap\b/i, "ap_days"],
  [/^(talent|people|hiring)\b/i, "talent_strategy"],
  [/^(unique )?(product )?differentiation\b|^unique product\b/i, "product_differentiation"],
  [/^(acquisitions?\s*,?\s*(expansion\s*|\w+\s*)?(&|and)\s*valuation|expansion\s*&\s*valuation|acquisition\s*&\s*expansion|mergers?\s*(and|&)\s*acquisitions?|m\s*&\s*a\s*$|post[- ]merger integration|business combinations?)(?![A-Za-z])/i, "acquisition_expansion_valuation"],
  [/^(other\b|strategies\s+(used\s+)?(to|for)\b|key strategies\b|shareholders?\b[^.]*strateg|ownership\b[^.]*strateg|(additional|further|supporting|more)\b[^.]*(strateg|growth))/i, "others"], // "Other Strategies…", "Strategies Used to Grow X", "Shareholder Strategy"
];
export const leverFromHeading = (h) => { const x = String(h || "").trim(); const hit = [...EXTRA_HEADING_LEVER, ...HEADING_LEVER].find(([re]) => re.test(x)); return hit ? hit[1] : null; };
// outline numbering in front of a title: "4." / "4)" / "3.2" / "3.2." (a year such as "2024 results" is not numbering)
export const stripItemNumber = (s) => String(s || "").replace(/^\s*(?:\d+(?:\.\d+)+\s*[.)]?|\d+\s*[.)])\s*/, "");
export const isTitleLike = (p) => { const t = p.trim(); return t.length <= 80 && !/\n/.test(t) && !/[.!?]$/.test(t); };

export const mnaTitle = (t) => { const x = String(t || ""); return x ? x.charAt(0).toUpperCase() + x.slice(1) : x; };

/* M&A mode is decided by STRUCTURE: the document must contain at least two of the M&A section headings (or one plus "M&A" in
   its title / first line). The word "acquisition" appearing in the text is not enough. */
export function detectMnaDocument(text, title) {
  const paras = String(text || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const kinds = new Set(paras.map((p) => mnaSectionKind(p)).filter(Boolean));
  if (kinds.size >= 2) return true;
  return kinds.size === 1 && /\bm\s*&\s*a\b|mergers?\s*(?:and|&)\s*acquisitions?/i.test(`${title || ""} ${paras[0] || ""}`);
}