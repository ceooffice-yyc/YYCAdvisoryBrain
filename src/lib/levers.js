// The levers and their categories, the saved definitions that change them, and the helpers that read industry and impact text.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.

export const LEVERS = ["price", "volume", "cogs", "overheads", "ar_days", "inventory_days", "ap_days", "talent_strategy", "product_differentiation", "acquisition_expansion_valuation", "others"];

/* Records are always listed in lever order (price → volume → cogs → overheads → ar_days → inventory_days → ap_days →
   talent → product differentiation → others). Stable: records of the same lever keep their existing (document) order. */
export const sortByLever = (arr) => (arr || [])
  .map((r, i) => ({ r, i, k: LEVERS.indexOf(r.lever) < 0 ? LEVERS.length : LEVERS.indexOf(r.lever) }))
  .sort((a, b) => a.k - b.k || a.i - b.i)
  .map((x) => x.r);

const OTHER_CATS_BASE = ["legal_regulatory_ip","business_model_execution","financing_capital","operations_process","partnerships_alliances","shareholder_governance"];
export const OTHER_CAT_DEFAULT_DEFS = {
  "legal_regulatory_ip": "legal, regulatory and IP matters combined: trademark / IP protection and enforcement, licences, regulation, contracts and legal clauses (e.g. exclusive lease clauses).",
  "business_model_execution": "the strategy for HOW the business chooses to run and continue itself: its sales / go-to-market model, positioning, strategic focus and the choices that keep the model going (e.g. a strict direct-to-customer sales model, hyper-focused positioning, doubling down on what works, staying focused instead of diversifying).",
  "financing_capital": "how the business is funded: debt, equity or investors, capital structure, self-funding / reinvesting profit, cash reserves.",
  "operations_process": "SOPs and operating processes: standard procedures, workflows, logistics, quality control, how work is organised and carried out.",
  "partnerships_alliances": "brand tie-ups, distribution or supply deals, joint ventures, alliances and partner networks.",
  "shareholder_governance": "ownership and role structure between owners: avoid 50:50 ownership, divide roles clearly, shareholder rights, governance.",
  "uncategorized": "ONLY if none of the above fit."
};
/* The "Others" sub-categories are admin-editable too: config.otherCatOverrides[id] = { name, description } for the built-in ones and
   config.customOtherCats = [{ id, name, description }] for new ones. OTHER_CATS is updated IN PLACE (custom ones sit before "uncategorized"),
   so every place that loops over it sees the current list. With no edits the prompt text is exactly the original. */
export const OTHER_CATS = [...OTHER_CATS_BASE, "uncategorized"];
let OTHER_CAT_OVERRIDES = {}, CUSTOM_OTHER_CATS = [];
export function setOtherCatConfig(overrides, custom) {
  OTHER_CAT_OVERRIDES = overrides && typeof overrides === "object" ? overrides : {};
  CUSTOM_OTHER_CATS = Array.isArray(custom) ? custom.filter((c) => c && c.id && c.name) : [];
  OTHER_CATS.length = 0;
  OTHER_CATS.push(...OTHER_CATS_BASE, ...CUSTOM_OTHER_CATS.map((c) => c.id), "uncategorized");
}
const otherCatDefinition = (id) => {
  const c = CUSTOM_OTHER_CATS.find((x) => x.id === id);
  if (c) return `${c.name}: ${c.description}`;
  return String((OTHER_CAT_OVERRIDES[id] && OTHER_CAT_OVERRIDES[id].description) || "").trim() || OTHER_CAT_DEFAULT_DEFS[id];
};
// What each "Others" category means (shared by the extraction prompt and the classifier call, so they can never drift apart)
export const otherCatDefs = () => OTHER_CATS.map((id) => `  - ${id} = ${otherCatDefinition(id)}`).join("\n");
/* The 10 built-in levers are admin-editable (Admin settings > Edit built-in levers). These are the defaults; an admin override
   (config.leverOverrides[id] = { name, description, headings }) replaces the display name, the definition the AI is given, and
   adds extra heading words that map to the lever. With no overrides the extraction prompt is exactly what it always was. */
export const BUILTIN_LEVER_DEFAULTS = {
  price: "pricing strategy, discounts, price sensitivity, value-based pricing, revenue per unit",
  volume: "sales volume, customer count, traffic, repeat purchases, cross-sell, market expansion",
  cogs: "cost of goods sold, gross margin, unit cost, supplier cost, wastage, warranty recovery (NOT receivable or payable days)",
  overheads: "fixed costs, rent/lease, payroll, staff headcount, occupancy, admin expenses (NOT receivable or payable days — those are ar_days / ap_days)",
  ar_days: "receivables, DSO, collections, credit terms, unpaid invoices, cash collection discipline",
  inventory_days: "stock levels, turnover, stock turns, obsolescence, holding days, WIP",
  ap_days: "payables, supplier payment terms, creditor days, negotiated payment windows, payable days",
  talent_strategy: "hiring, training, retention, culture, succession, incentives, employee capability",
  product_differentiation: "product design, IP, unique features, brand equity, customer experience, co-creation, exclusivity, service differentiation",
  acquisition_expansion_valuation: "M&A strategy, target sourcing/screening, acquisition criteria, buy-and-build, platform/bolt-on acquisitions, deal valuation, ownership/earn-out approach, long-term ownership, and post-acquisition integration/operating model when explicitly tied to acquisitions.",
};
let LEVER_OVERRIDES = {}; // set from the saved config by setLeverOverrides(); read by the prompt builder and the heading matcher
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const splitHeadings = (s) => String(s || "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
export let EXTRA_HEADING_LEVER = []; // checked BEFORE the built-in heading rules: a custom lever named "Customer Retention" must not be swallowed by the built-in "Customers" rule
export let CUSTOM_LEVERS = []; // custom levers from the lever definitions (the levers table when the shared database is on)
// words that send a document heading to a custom lever: the admin's heading words, plus the lever's own name
export const customHeadingWords = (l) => [...new Set([...splitHeadings(l.headings), String(l.name || "").trim()].filter(Boolean))];
export function setLeverOverrides(ov, custom) {
  LEVER_OVERRIDES = ov && typeof ov === "object" ? ov : {};
  CUSTOM_LEVERS = Array.isArray(custom) ? custom.filter((l) => l && l.id && l.name) : [];
  const toRe = (h) => new RegExp("^" + escRe(h) + "(?![A-Za-z])", "i");
  EXTRA_HEADING_LEVER = [
    ...Object.entries(LEVER_OVERRIDES).flatMap(([id, o]) => (BUILTIN_LEVER_DEFAULTS[id] ? splitHeadings(o && o.headings).map((h) => [toRe(h), id]) : [])),
    ...CUSTOM_LEVERS.flatMap((l) => customHeadingWords(l).map((h) => [toRe(h), l.id])),
  ];
}
const leverDefinition = (id) => String((LEVER_OVERRIDES[id] && LEVER_OVERRIDES[id].description) || "").trim() || BUILTIN_LEVER_DEFAULTS[id];
export const leverDefLine = (id) => {
  const nm = String((LEVER_OVERRIDES[id] && LEVER_OVERRIDES[id].name) || "").trim();
  return `- ${id}:${nm ? ` (shown to users as "${nm}")` : ""} ${leverDefinition(id)}`;
};
export const extraHeadingNote = () => {
  const rows = [
    ...Object.entries(LEVER_OVERRIDES).filter(([id]) => BUILTIN_LEVER_DEFAULTS[id]).map(([id, o]) => [id, splitHeadings(o && o.headings)]),
    ...CUSTOM_LEVERS.map((l) => [l.id, customHeadingWords(l)]),
  ].filter(([, h]) => h.length);
  return rows.length ? `\nAlso: ${rows.map(([id, h]) => `${h.join(" / ")} → ${id}`).join(" · ")}` : "";
};
const LEGACY_OTHER_CATEGORY = {
  legal_ip: "legal_regulatory_ip", regulatory: "legal_regulatory_ip",
  partnerships: "partnerships_alliances", financing: "financing_capital",
  operations: "operations_process", tech_systems: "business_model_execution",
  moat: "business_model_execution", risk_lessons: "uncategorized", misc: "uncategorized",
};

export function normalizeOther(r) {
  const category = LEGACY_OTHER_CATEGORY[r.other_category] || r.other_category;
  if (r.lever === "others" && r.other_category === "expansion") {
    const migrated = { ...r, lever: "acquisition_expansion_valuation" };
    delete migrated.other_category; delete migrated.related_to;
    return migrated;
  }
  if (r.lever !== "others") { const rest = { ...r }; delete rest.other_category; delete rest.related_to; return rest; }
  return { ...r, other_category: OTHER_CATS.includes(category) ? category : "uncategorized", related_to: String(r.related_to || "").trim() };
}

/* claim_en is always stored as "Strategy name: description". The name is shown in bold, the
   document's actual impact sits in a light-brown box underneath (older records fall back to their quote). */
// The UI prints its own "Actual impact:" heading, so a label copied from the document ("Actual Impact: …") must never stay in the text
export function stripImpactLabel(s) {
  let out = String(s || "").trim();
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/^\s*(?:actual\s+impacts?(?:\s*&\s*power\s+cash\s+link)?|financial\s+impact|impact|results?)\s*[:：\-–—]\s*/i, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}
export const impactOf = (r) => stripImpactLabel(r?.impact || r?.quote || "");
export const citationLabel = (citation, limit = 30) => {
  const full = [citation.doc_title, citation.section, citation.claim].filter(Boolean).join(" · ");
  return { full, short: full.length > limit ? `${full.slice(0, limit - 1)}…` : full };
};
export function summaryCardRealizedImpact(value) {
  const sentences = String(value || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const metricsOnly = /\b(?:KPI|target|NPS|Net Promoter Score|score|scored|utili[sz]ation|rebooking rate|acquisitions? in \d+ years?)\b/i;
  const realized = /\b(?:increased|grew|reduced|raised|improved|doubled|tripled|saved|generated|earned|became|revalued|turned into|turnaround|achieved|reached|cut|lowered|eliminated)\b/i;
  const directionalResult = /\b(?:revenue|profit(?:ability)?|sales|cash flow|valuation|margin|cost|debt)\b.{0,55}\b\d[\d,.]*(?:[kmb])?\s*(?:→|to|from)\s*(?:US\$|RM|\$)?\d[\d,.]*(?:[kmb])?/i;
  const kept = sentences.filter((s) => !metricsOnly.test(s) && (realized.test(s) || directionalResult.test(s)));
  return kept.length ? kept.join(" ") : "N/A";
}

export function leverTag(t, r) {
  const base = t.levers[r.lever] || r.lever;
  return r.lever === "others" && t.otherCats[r.other_category] ? `${base} · ${t.otherCats[r.other_category]}` : base;
}

export function normalizeMainCategory(raw) {
  const s = String(raw || "").toLowerCase();
  if (!s.trim()) return "General";
  if (s.includes("trading") && s.includes("retail")) return "Trading / Retail";
  if (s.includes("trading")) return "Trading";
  if (s.includes("retail")) return "Retail";
  if (s.includes("manufactur")) return "Manufacturing";
  if (s.includes("construction")) return "Construction";
  if (s.includes("healthcare") || s.includes("health care")) return "Healthcare";
  if (s.includes("service") || s.includes("advisory") || s.includes("consult")) return "Services";
  if (s.includes("tech")) return "Technology";
  if (s.includes("education")) return "Education";
  if (s.includes("hospitality") || s.includes("food") || s.includes("f&b")) return "F&B / Hospitality";
  return raw;
}

export function parseIndustry(industry, doc) {
  if (doc && doc.industry_main) {
    return { main: doc.industry_main, sub: doc.industry_sub || "" };
  }
  if (!industry) return { main: "General", sub: "" };
  const s = String(industry).trim();
  const m = s.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    return { main: normalizeMainCategory(m[2].trim()), sub: m[1].trim() };
  }
  return { main: s, sub: "" };
}