// Spots a file that is really a collection of separate stories (like "13 company case studies") and cuts it into one card per story; plain code, so the same file always gives the same cards.
import { parseSummaryStrategyCards, usableTitle } from "./summaryCardExtraction.js";

// labels that appear in almost every kind of document, so sharing them says nothing about a collection
const GENERIC_LABELS = new Set(["example", "examples", "eg", "e.g", "for example", "note", "notes", "impact", "actual impact", "financial impact", "power cash link", "source", "client", "yyc", "industry",
  "link", "result", "results", "actions", "recommended actions", "suggested response", "possible actions", "key message", "the key message", "the principle", "problem", "solution"]);
const WEAK_LABELS = new Set(["problem", "solution", "result", "results"]);
// titles that name a part of ONE document (a section, a year, a step), not a separate story
const SECTION_WORDS = /^(pricing|price|volume|cost of goods sold|cogs|overheads?|inventory|talent( strategy)?|product differentiation|other key strategies.*|other strategies.*|analysis|background.*|summary|executive summary|conclusion|introduction|lessons?.*|failed strategies.*|problems? encountered.*|timeline|company background|acquisition criteria|post-acquisition strategy|m&a appetite.*|power cash.*|key takeaways?|overview|appendix|references?)$/i;
const CHRONO = /^(year|stage|step|phase|part|chapter|day|week|month|q[1-4]|round|era|period|age)\s*\d*\b|^(19|20)\d\d\b/i;
const MAX_CARDS = 40;

const norm = (s) => String(s || "").toLowerCase().replace(/&amp;/g, "&").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const decodeText = (s) => String(s).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const paragraphsOf = (text) => String(text || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

// where a story could start: "1. Name" lines in a running 1, 2, 3 ... order
function numberedStarts(paras) {
  const items = [];
  paras.forEach((p, i) => { const m = p.match(/^(\d{1,2})[.)](?!\d)\s*(\S.{2,139})$/); if (m && !/\n/.test(p) && !/[.!?]$/.test(p)) items.push({ index: i, n: Number(m[1]), title: m[2].trim() }); });
  let best = [], cur = [];
  for (const it of items) { if (cur.length && it.n === cur[cur.length - 1].n + 1) cur.push(it); else cur = [it]; if (cur.length > best.length) best = cur.slice(); }
  return best.length >= 3 ? best.map(({ index, title }) => ({ index, title })) : [];
}

// "Case 1: Name" / "Company 2 - Name" lines
function prefixStarts(paras) {
  const items = [];
  paras.forEach((p, i) => { const m = p.match(/^(?:case(?: study)?|company|story|client)\s*#?\s*(\d{1,2})\s*[:.–—-]\s*(\S.{2,139})$/i); if (m && !/\n/.test(p) && !/[.!?]$/.test(p)) items.push({ index: i, title: m[2].trim() }); });
  return items.length >= 3 ? items : [];
}

// Word headings of the level used most often (3 or more)
function headingStarts(paras, html) {
  const heads = [...String(html || "").matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ level: Number(m[1]), title: decodeText(m[2]) })).filter((h) => h.title);
  const byLevel = {};
  heads.forEach((h) => { byLevel[h.level] = (byLevel[h.level] || 0) + 1; });
  const level = Object.keys(byLevel).sort((a, b) => byLevel[b] - byLevel[a])[0];
  if (!level || byLevel[level] < 3) return [];
  const out = [];
  let from = 0;
  for (const h of heads.filter((x) => x.level === Number(level))) {
    const i = paras.findIndex((p, k) => k >= from && norm(p) === norm(h.title));
    if (i >= 0) { out.push({ index: i, title: h.title }); from = i + 1; }
  }
  return out.length >= 3 ? out : [];
}

// plain "Name (Industry)" lines; skips "Problem: ..." lines and a bracket that is only a year, which are steps of one story
function parentheticalStarts(paras) {
  const items = [];
  paras.forEach((p, i) => { if (p.length <= 90 && !/\n/.test(p) && !/[.!?:]$/.test(p) && !/:\s/.test(p) && !/\((?:19|20)\d\d(?:\s*[–-]\s*(?:(?:19|20)\d\d|present))?\)$/i.test(p) && /^[A-Z0-9][^()]{2,60}\([^)]{3,50}\)$/.test(p) && i + 1 < paras.length && paras[i + 1].length > 40) items.push({ index: i, title: p.trim() }); });
  return items.length >= 3 ? items : [];
}

function scoreOption(how, starts, paras) {
  const total = paras.reduce((s, p) => s + p.length, 0) || 1;
  const blocks = starts.map((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].index : paras.length;
    const body = paras.slice(s.index + 1, end);
    return { title: s.title, chars: body.reduce((a, p) => a + p.length, 0), body };
  });
  // the field labels at the start of a paragraph ("Key Strategy: ...") that most blocks share
  const seen = new Map();
  for (const b of blocks) {
    const mine = new Set();
    for (const p of b.body) { const m = p.match(/^([A-Z][A-Za-z/&' -]{2,30}?)\s*[:：]\s*\S/); if (m) mine.add(norm(m[1])); }
    mine.forEach((l) => seen.set(l, (seen.get(l) || 0) + 1));
  }
  const need = Math.ceil(blocks.length * 0.6);
  const shared = [...seen].filter(([, c]) => c >= need).map(([l]) => l);
  return {
    how, starts, blocks,
    strongLabels: shared.filter((l) => !GENERIC_LABELS.has(l)),
    weakLabels: shared.filter((l) => WEAK_LABELS.has(l)),
    parens: blocks.filter((b) => /\([^)]{3,50}\)\s*$/.test(b.title)).length / blocks.length,
    sectionish: blocks.filter((b) => SECTION_WORDS.test(b.title.trim()) || CHRONO.test(b.title.trim())).length / blocks.length,
    coverage: blocks.reduce((s, b) => s + b.chars, 0) / total,
    distinct: new Set(blocks.map((b) => norm(b.title))).size / blocks.length,
  };
}

const PRIORITY = ["numbered lines", '"Case N:" lines', "Word headings", '"Name (Industry)" lines']; // when two readings agree, trust the more specific signal

function analyse(text, html) {
  const paras = paragraphsOf(text);
  const options = [["numbered lines", numberedStarts(paras)], ['"Case N:" lines', prefixStarts(paras)], ["Word headings", headingStarts(paras, html)], ['"Name (Industry)" lines', parentheticalStarts(paras)]]
    .filter(([, s]) => s.length >= 3).map(([how, s]) => scoreOption(how, s, paras));
  if (!options.length) return { level: "none", reason: "fewer than 3 repeated story starts", how: "-", starts: [], paras };
  const verdicts = options.map((o) => {
    const labels = [...o.strongLabels, ...o.weakLabels];
    const tag = `${o.blocks.length} blocks via ${o.how}, ${Math.round(o.coverage * 100)}% of the text`;
    let level = "none", reason;
    if (o.sectionish >= 0.5) reason = `${tag}: titles are section names or steps, so they are parts of ONE document`;
    else if (o.distinct < 0.8) reason = `${tag}: titles repeat`;
    else if (o.coverage < 0.55) reason = `${tag}: too little of the document sits inside the blocks`;
    else if ((o.strongLabels.length >= 1 && labels.length >= 2) || o.strongLabels.length >= 2) { level = "strong"; reason = `${tag}; every block has the same labels (${labels.join(", ")})`; }
    else if (o.parens >= 0.6 && o.sectionish === 0) { level = "medium"; reason = `${tag}; titles look like "Name (Industry)" but the blocks share no field labels`; }
    else reason = `${tag}: the blocks do not share labels, so they are different kinds of section`;
    // lines that merely look like "Name (Industry)" are the weakest evidence, so they can only reach "medium"
    if (o.how.startsWith('"Name') && level === "strong") { level = "medium"; reason += " (capped at medium: no numbering or headings back this up)"; }
    return { o, level, reason };
  });
  const rank = { strong: 2, medium: 1, none: 0 };
  verdicts.sort((a, b) => rank[b.level] - rank[a.level] || PRIORITY.indexOf(a.o.how) - PRIORITY.indexOf(b.o.how));
  const v = verdicts[0];
  return { level: v.level, reason: v.reason, how: v.o.how, starts: v.o.starts, paras };
}

/** Is this file a collection of separate stories? -> { level: "strong" | "medium" | "none", reason, how, titles } */
export function detectCompilation(text, html = "") {
  const a = analyse(text, html);
  return { level: a.level, reason: a.reason, how: a.how, titles: a.starts.map((s) => s.title) };
}

const fieldOf = (text, label, nextLabels) => {
  const start = new RegExp(`\\b${label}\\s*[:\\uFF1A]\\s*`, "i").exec(text);
  if (!start) return "";
  const tail = text.slice(start.index + start[0].length);
  const next = new RegExp(`\\b(?:${nextLabels.join("|")})\\s*[:\\uFF1A]`, "i").exec(tail);
  return (next ? tail.slice(0, next.index) : tail).replace(/\s+/g, " ").trim();
};

// The offer shown to the person: null unless the file is clearly a collection AND every story has a "Key Strategy:" field code can read; the text is cut at the story starts, never reworded, so intro + cards joined give the file back.
export function planSplit(text, html = "") {
  const a = analyse(text, html);
  if (a.level !== "strong" || a.starts.length > MAX_CARDS) return null;
  const { paras, starts } = a;
  const cards = starts.map((s, k) => {
    const body = paras.slice(s.index, k + 1 < starts.length ? starts[k + 1].index : paras.length);
    const cardText = body.join("\n\n");
    return {
      n: k + 1, title: s.title, heading: paras[s.index], text: cardText, paras: body,
      records: parseSummaryStrategyCards(cardText),
      problem: fieldOf(cardText, "Problem", ["Key Strategy", "Formula\\s*\\/\\s*Theory", "Result", "Solution", "Key Solution", "Goal"]),
    };
  });
  if (cards.some((c) => !c.records.length)) return null; // a story code cannot read: leave the file to the normal extraction
  return { cards, intro: paras.slice(0, starts[0].index).join("\n\n"), how: a.how, reason: a.reason };
}

const bracketOf = (heading) => (String(heading || "").match(/\(([^()]*(?:\([^()]*\))?[^()]*)\)\s*$/) || [])[1] || "";

/** One small question for ALL cards at once: each story's lever and industry, plus a short title for every strategy sentence (the stories have no title of their own). */
export function buildClassifyPrompt(cards, { leverLines, otherCats, otherCatDefs }) {
  const items = cards.map((c, i) => `${i}. ${c.title} | ${c.records.map((r, k) => `strategy ${k + 1}: ${(r.strategy || "").slice(0, 220)}`).join(" | ")}${c.problem ? ` | problem: ${c.problem.slice(0, 140)}` : ""}`);
  return `You file short business case stories for an advisory knowledge base. For EACH story below return its lever, its industry, and a title for each of its strategy sentences.

LEVERS (pick exactly one id per story, by what the key strategy is mainly about):
${leverLines.join("\n")}
- others: fits none of the above. For "others" also give other_category (one of: ${otherCats.join(", ")}) and related_to (3-8 words).
${otherCatDefs ? `Categories for others:\n${otherCatDefs}\n` : ""}
industry_main = a broad category in English (for example Construction, Healthcare, Trading / Retail, Services, Manufacturing, Technology, F&B / Hospitality, General); industry_sub = a short specific sub-industry in English.
titles = one title per "strategy N" sentence, in the same order: a short label of 3-8 words that says what that strategy IS, in plain words that clearly match the sentence (reuse its key words). The sentence itself is kept in full elsewhere, so do not cut or copy it; never return the whole sentence, a number, or a generic label like "Strategy".

STORIES:
${items.join("\n")}

Return ONLY JSON: {"items":[{"i":0,"lever":"<lever id>","industry_main":"...","industry_sub":"...","other_category":"","related_to":"","titles":["<title for strategy 1>"]}, ...]} with one entry per story.`;
}

/** The model's answer -> one clean classification per card (a bad or missing entry becomes "others / uncategorized"); each title is kept only if it really fits its sentence. */
export function readClassification(raw, cards, { leverIds, otherCats }) {
  const count = cards.length;
  const emptyTitles = (i) => cards[i].records.map(() => "");
  const out = Array.from({ length: count }, (_, i) => ({ lever: "others", other_category: "uncategorized", related_to: "case study strategy", industry_main: "", industry_sub: "", titles: emptyTitles(i), guessed: false }));
  const items = raw && Array.isArray(raw.items) ? raw.items : [];
  for (const it of items) {
    const i = Number(it && it.i);
    if (!Number.isInteger(i) || i < 0 || i >= count) continue;
    const titles = cards[i].records.map((r, k) => usableTitle(Array.isArray(it.titles) ? it.titles[k] : "", r.strategy)); // a title that does not fit its sentence becomes "" (the code's own split is the fallback)
    const lever = String(it.lever || "").trim();
    if (!leverIds.includes(lever)) { out[i] = { ...out[i], titles }; continue; }
    const cat = String(it.other_category || "").trim();
    out[i] = {
      titles,
      lever,
      other_category: lever === "others" ? (otherCats.includes(cat) ? cat : "uncategorized") : "",
      related_to: lever === "others" ? String(it.related_to || "").trim().split(/\s+/).slice(0, 8).join(" ") || "case study strategy" : "",
      industry_main: String(it.industry_main || "").trim().slice(0, 60),
      industry_sub: String(it.industry_sub || "").trim().slice(0, 80),
      guessed: true,
    };
  }
  return out;
}

/** The extraction (same shape as the one the AI extraction returns) for ONE card, so it goes through the normal review and save screens. */
export function buildCardExtraction({ card, total, parentTitle, classification, intro }) {
  const cls = classification || { lever: "others", other_category: "uncategorized", related_to: "case study strategy", industry_main: "", industry_sub: "", titles: [], guessed: false };
  const bracket = bracketOf(card.heading);
  const main = cls.industry_main || "General";
  const sub = cls.industry_sub || (cls.industry_main ? "" : bracket);
  const industry = sub ? `${sub} (${main})` : main;
  const notices = [{ level: "info", text: `Story ${card.n} of ${total} from "${parentTitle}". The text was cut at the story headings and not reworded.` }];
  if (!cls.guessed) notices.push({ level: "warn", text: "The AI could not suggest a lever or industry for this story, so it is filed under Others. Please check both before saving." });
  if (intro && card.n === 1) notices.push({ level: "warn", text: `The file has ${intro.length.toLocaleString("en-US")} characters of introduction before the first story. It is not part of any card.` });
  const levers = card.records.map((r, k) => {
    // an AI title that fits goes with the WHOLE original sentence; with no usable title the sentence is split the old way
    const ai = (cls.titles && cls.titles[k]) || "";
    const claim = ai ? `${ai}: ${r.strategy}` : r.description ? `${r.title}: ${r.description}` : `${r.title}:`;
    const rec = { lever: cls.lever, section: card.title, claim_en: claim, impact: r.impact || "N/A" };
    if (cls.lever === "others") { rec.other_category = cls.other_category; rec.related_to = cls.related_to; }
    return rec;
  });
  return {
    title: card.title, doc_type: "case_study", industry, industry_main: main, industry_sub: sub, language: "en",
    problem_signature: card.problem.slice(0, 240),
    sections: [
      { heading: card.title, summary_en: card.problem.slice(0, 240), summary_zh: "" },
      { heading: "Source", summary_en: `Story ${card.n} of ${total} in the file "${parentTitle}".`, summary_zh: "" },
    ],
    levers, notices,
  };
}
