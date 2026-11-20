// The extraction pipeline: cutting a document into parts, tidying them, asking the AI, and checking and restoring what comes back. Downloaded only when an admin extracts something.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { splitClaim } from "../claim.js";
import { detectOutlineDocument, extractCollectionFrameworkRecords } from "../collectionExtraction.js";
import { saveLimitNotice, withNotices } from "../extractionNotices.js";
import { parseSummaryStrategyCards, restoreSummaryStrategyCards } from "../summaryCardExtraction.js";
import { buildCardExtraction, buildClassifyPrompt, readClassification } from "../compilationSplit.js";
import { KNOWN_HEADING, detectMnaDocument, isHeadingAt, isTitleLike, leverFromHeading, leverHeadingOf, mnaNumberedKinds, mnaSectionKind, mnaTitle, stripItemNumber } from "./headings.js";
import { FIELD_LABEL_SECTION, KEY_STRATEGY_LABEL, normWs, sentencesOf, snapToSource, tokSet, windowStart, wordCount } from "./text.js";
import { CUSTOM_LEVERS, LEVERS, OTHER_CATS, customHeadingWords, extraHeadingNote, leverDefLine, otherCatDefs, sortByLever, stripImpactLabel, summaryCardRealizedImpact } from "../lib/levers.js";
import { AIError, askAI, keysInUse } from "../lib/ai.js";
import { uid } from "../lib/util.js";

function chunkMaterial(text, size = 3800) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = [];
  let curLen = 0;
  let heading = ""; // last lever heading seen so far
  let startHeading = ""; // heading in force when the current chunk began
  let sc = 0; // strategies ("Title: description" paragraphs) in the current chunk — capped so one answer never has to hold a dozen
  let prevP = ""; // previous paragraph (a heading-looking line right after a ":" intro is a list item)
  const isStrat = (q) => TITLE_COLON.test(q) && !/^(actual\s+impacts?|impacts?|power\s+cash\s+link|financial\s+impact|results?|problems?|solutions?)\b/i.test(q);
  const flush = () => {
    // never end a chunk on a heading / strategy title: its description would land in the next chunk without it
    const carry = [];
    while (cur.length > 1 && isTitleLike(cur[cur.length - 1])) carry.unshift(cur.pop());
    const body = cur.join("\n\n");
    chunks.push(chunks.length && startHeading && !KNOWN_HEADING.test(cur[0]) ? `[CONTINUES UNDER HEADING: ${startHeading}]\n\n${body}` : body);
    startHeading = carry.length && KNOWN_HEADING.test(carry[0]) ? "" : heading;
    // heading in force at the carried paragraphs' start
    cur = carry; curLen = carry.join("\n\n").length; sc = 0;
  };
  for (const p of paras) {
    // an "Actual Impact:" / "Power Cash Link:" paragraph belongs to the strategy above it — never start a new chunk on one
    const isLabel = /^(actual\s+impacts?|impacts?|power\s+cash\s+link|financial\s+impact|results?)\b[^:：\n]{0,30}[:：]/i.test(p);
    if (cur.length && !isLabel && (curLen + p.length + 2 > size || (sc >= 6 && isStrat(p)))) flush();
    cur.push(p); curLen += p.length + 2;
    if (isStrat(p)) sc++;
    if (KNOWN_HEADING.test(p) && !/:\s*$/.test(prevP)) heading = leverHeadingOf(p);
    prevP = p;
  }
  if (cur.length) {
    const body = cur.join("\n\n");
    chunks.push(chunks.length && startHeading && !KNOWN_HEADING.test(cur[0]) ? `[CONTINUES UNDER HEADING: ${startHeading}]\n\n${body}` : body);
  }
  // a tiny tail isn't worth its own API call (~1 TPM window); fold it into the previous chunk
  if (chunks.length > 1 && chunks[chunks.length - 1].length < 1200 && chunks[chunks.length - 1].length + chunks[chunks.length - 2].length <= size * 1.15) {
    const tail = chunks.pop();
    chunks[chunks.length - 1] += "\n\n" + tail;
  }
  return chunks;
}

// Split only at existing paragraph/line/sentence boundaries. Slicing retains every
// original character, so retrying a failed JSON response cannot alter source text.
function splitMaterialForRetry(text) {
  const source = String(text || "");
  const midpoint = Math.floor(source.length / 2);
  const boundaryPatterns = [/\n\s*\n/g, /\n/g, /(?<=[.!?])\s+/g];
  for (const pattern of boundaryPatterns) {
    const cuts = [];
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const cut = match.index + match[0].length;
      if (cut > 0 && cut < source.length) {
        const previousPara = source.slice(0, cut).trimEnd().split(/\n\s*\n/).pop() || "";
        const separatesTitleFromEvidence = isTitleLike(previousPara) && !KNOWN_HEADING.test(previousPara);
        if (!separatesTitleFromEvidence) cuts.push(cut);
      }
      if (!match[0].length) pattern.lastIndex++;
    }
    if (!cuts.length) continue;
    const cut = cuts.reduce((best, candidate) => Math.abs(candidate - midpoint) < Math.abs(best - midpoint) ? candidate : best, cuts[0]);
    const left = source.slice(0, cut);
    const right = source.slice(cut);
    if (left.trim() && right.trim()) return [left, right];
  }
  return null;
}

/* Cut the document down to its Key Strategies part in CODE (the model can't be trusted to ignore a timeline
   once it has read it): start at the "Power Cash" analysis, stop at Failed Strategies / timeline headings.
   The narrative before it is kept as a short background-only header for industry/title detection. */
function scopeMaterial(text) {
  const start = text.search(/Power Cash (Links?|Strategy)|^\s*Analysis\s*$/im);
  if (start <= 0) return { context: "", body: text };
  let body = text.slice(start);
  const end = body.search(/^\s*(Failed Strategies|Problems? Encountered|Problems? (and|&) Solutions?|Lessons? Learn|Financial Milestones|Timeline|Key (Dates|Milestones)|Chronology)|^.{0,40}\bwebsite\s*:/im);
  if (end > 0) body = body.slice(0, end);
  return { context: text.slice(0, start).slice(0, 1500), body };
}

// Collection manuals mix operational policies with call scripts, soft skills, and examples.
// Keep only the sections that describe collection management or explicit collection policies.
const COLLECTION_TOP_SECTIONS = [
  [/^Management Approach to Collection Performance\b/i, true],
  [/^Win the Internal War First\b/i, true],
  [/^Current Collection Strategies Identified in YYC\b/i, true],
  [/^Telephone Collection skills\b/i, false],
  [/^Opening a Collection Call\b/i, false],
  [/^Dealing with Difficult Customers by Telephone\b/i, false],
  [/^Collection Persuasion Skills\b/i, false],
  [/^Barriers to Successful Persuasion\b/i, false],
  [/^Strategies to Reduce Debt\b/i, true],
  [/^Burning Issues in Debt Recovery\b/i, false],
  [/^Different Types of Difficult Customers\b/i, false],
  [/^Profiling Debtors\b/i, false],
  [/^Handling Difficult Customers\b/i, false],
  [/^Focus on Large Customers\b/i, false],
  [/^Common Client Objections and Suggested Responses\b/i, false],
  [/^Negotiation Tactics\b/i, false],
  [/^Debt Planning and Measurement\b/i, false],
  [/^Action Plan by Function\b/i, false],
  [/^Recommended YYC Collection Excellence Framework\b/i, false],
];
function detectCollectionFramework(text, title) {
  const head = String(text || "").slice(0, 18000);
  const isCollectionDoc = /collection|receivables?|debt recovery/i.test(`${title || ""} ${head.slice(0, 900)}`);
  const lines = head.split(/\r?\n/).map((line) => line.trim());
  const headingCount = COLLECTION_TOP_SECTIONS.filter(([re]) => lines.some((line) => re.test(line))).length;
  return isCollectionDoc && headingCount >= 3 && !/Power Cash (Links?|Strategy)|^\s*Analysis\s*$/im.test(head);
}
function scopeCollectionFramework(text) {
  const paras = String(text || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const selected = [];
  let active = false;
  let included = 0;
  let internalWarTitle = "";
  let internalWarLines = [];
  let inInternalWarPractices = false;
  const flushInternalWar = () => {
    if (!internalWarTitle) return;
    selected.push(internalWarTitle);
    if (internalWarLines.length) selected.push(internalWarLines.join("\n"));
    internalWarTitle = "";
    internalWarLines = [];
    inInternalWarPractices = false;
  };
  for (const para of paras) {
    const heading = COLLECTION_TOP_SECTIONS.find(([re]) => re.test(para));
    if (heading) {
      flushInternalWar();
      active = heading[1];
      if (active) {
        included++;
        if (/^Win the Internal War First\b/i.test(para)) internalWarTitle = para;
        else selected.push(para);
      }
      continue;
    }
    if (internalWarTitle) {
      if (/^The internal war is won when:\s*$/i.test(para)) {
        internalWarLines.push(para);
        inInternalWarPractices = true;
      } else if (inInternalWarPractices) internalWarLines.push(para);
      continue;
    }
    if (active) selected.push(para);
  }
  flushInternalWar();
  return { context: "", body: included >= 3 ? selected.join("\n\n") : String(text || "") };
}

// M&A extraction is deliberately limited in code to the sections the advisor
// wants classified. Summary/recap sections never reach the model as strategy text.
export function scopeMnaSections(text) {
  const paras = String(text || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const sectionKey = (p) => mnaSectionKind(p);
  const selected = [];
  let active = false;
  let activeSection = "";
  let activeNumber = null;
  let firstHeading = "";
  for (const para of paras) {
    const target = sectionKey(para);
    if (target) {
      active = true;
      activeSection = target;
      activeNumber = Number(para.match(/^\s*(\d+)\s*[.)]/)?.[1]) || null;
      if (!firstHeading) firstHeading = para;
      selected.push(para);
      continue;
    }
    const isSummary = /^(?:summary\b|conclusion\b|key takeaway\b|[^\n]{0,30}?\bm\s*&\s*a\s+model\s+in\s+one\s+line\b)/i.test(para.replace(/^\s*\d+\s*[.)]\s*/, ""));
    if (active && isSummary) { active = false; activeSection = ""; activeNumber = null; continue; }
    const numberedHeading = para.match(/^\s*(\d+)\s*[.)]\s+(.+)$/);
    // Acquisition criteria often contain numbered criteria (1–6); those belong
    // to that section. In the other target sections, a later numbered heading
    // marks the end of the current section unless it is another target above.
    if (active && activeSection !== "criteria" && activeNumber && numberedHeading && Number(numberedHeading[1]) > activeNumber) {
      active = false; activeSection = ""; activeNumber = null;
    }
    if (active) selected.push(para);
  }
  const firstAt = firstHeading ? String(text || "").indexOf(firstHeading) : -1;
  return {
    context: firstAt > 0 ? String(text).slice(0, firstAt).slice(0, 1500) : "",
    body: selected.join("\n\n"),
  };
}

/* Every "Strategy title: description" paragraph in the strategy part, with the lever heading it sits under and the
   Actual Impact / Power Cash Link paragraphs that follow it. Used to verify the model did not skip anything. */
const LABEL_PARA = /^(actual\s+impacts?|impacts?|power\s+cash\s+link|financial\s+impact|results?|problems?|solutions?|notes?|source|key\s+strategy|formula)\b/i;
export function findStrategyParas(body) {
  const paras = String(body || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let heading = "";
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (isHeadingAt(paras, i)) { heading = leverHeadingOf(p); continue; }
    const m = p.match(/^([A-Za-z0-9"“‘'][^:\n]{2,299}?):\s+\S/);
    // "Buy-and-Build" is a title; a one-word "Roy:" bullet is not, except a one-word label ("Packaging") that heads a block of lines under Product Differentiation
    // A table of "Differentiation | What <brand> did" rows arrives as single lines, "Fit: Moved away from boxy scrubs...", "Style/Fashion: ...":
    // under Product Differentiation a short label (up to 6 words) followed by a real description (8+ words) is a strategy even when the label is one word.
    const inPD = leverFromHeading(heading) === "product_differentiation";
    const labelBlock = inPD && (/\n/.test(p) || (!!m && wordCount(m[1]) <= 6 && wordCount(p.slice(m[1].length + 1)) >= 8));
    if (!m || LABEL_PARA.test(p) || wordCount(m[1]) > 45 || (m[1].split(/[\s-]+/).filter(Boolean).length < 2 && !labelBlock)) continue;
    let full = p;
    for (let j = i + 1; j < paras.length && LABEL_PARA.test(paras[j]); j++) full += "\n\n" + paras[j];
    out.push({ title: m[1].trim(), heading, text: full });
  }
  return out;
}

const TITLE_COLON = /^[A-Za-z0-9"“‘'][^:\n]{2,299}?:\s+\S/;

/* Tidy the strategy part before the model sees it:
   - drops leftover table-template cells ("What Sweetwater Did") that look like titles;
   - rewrites the table layout  [title line] + [description paragraph]  as  "Title: description",
     so every strategy has ONE shape and the model never has to guess where a strategy starts. */
// the paragraphs of a body, plus whether the document left an extra empty paragraph in front of each one (it marks a new group of lines)
function readParas(body) {
  const pieces = String(body || "").split(/(\n\s*\n)/);
  const raw = [], bigGap = [];
  for (let k = 0; k < pieces.length; k += 2) {
    const t = pieces[k].trim();
    if (!t) continue;
    raw.push(t);
    bigGap.push(k > 0 && (pieces[k - 1].match(/\n/g) || []).length >= 3);
  }
  return { raw, bigGap };
}

/* A numbered strategy ("1. Lean into Strengths"), its intro sentence ending in ":" and the "Label: point" lines under it are ONE strategy; the points only support it. */
function supportGroupAt(raw, i) {
  const p = raw[i], intro = raw[i + 1];
  if (!p || !intro || !/^\d+\s*[.)]\s*\S/.test(p) || /^\d+\.\d/.test(p) || /\n/.test(p) || p.length > 140 || /[.!?:]$/.test(p) || wordCount(p) > 20) return null;
  if (!/:$/.test(intro) || wordCount(intro) < 6 || TITLE_COLON.test(intro) || LABEL_PARA.test(intro)) return null;
  const children = [];
  for (let j = i + 2; j < raw.length; j++) {
    const q = raw[j];
    if (!TITLE_COLON.test(q) || LABEL_PARA.test(q) || isHeadingAt(raw, j) || /^\d+\s*[.)]\s*\S/.test(q)) break;
    children.push(q);
  }
  if (!children.length) return null;
  const title = stripItemNumber(p).trim();
  return { title, intro, children, text: `${title}: ${intro}\n${children.join("\n")}`, end: i + 1 + children.length };
}
export function findSupportGroups(body) {
  const { raw } = readParas(body);
  const groups = [];
  for (let i = 0; i < raw.length; i++) { const g = supportGroupAt(raw, i); if (g) { groups.push(g); i = g.end; } }
  return groups;
}
// If the model still made a record of each supporting point, fold them back into the one numbered strategy they belong to.
export function foldSupportGroups(levers, groups) {
  let out = levers.slice();
  for (const g of groups) {
    const kidNames = new Set(g.children.map((c) => normWs(c.split(/:\s/)[0])));
    const isKid = (l) => kidNames.has(normWs(splitClaim(l.claim_en).name));
    const kids = out.filter(isKid);
    if (!kids.length) continue;
    const hasParent = out.some((l) => normWs(splitClaim(l.claim_en).name).startsWith(normWs(g.title).slice(0, 25)));
    const best = kids.find((l) => l.impact && l.impact !== "N/A");
    if (hasParent) { out = out.filter((l) => !isKid(l)); continue; }
    const first = kids[0];
    out = out.filter((l) => l === first || !isKid(l)).map((l) => (l === first ? { ...l, claim_en: `${g.title}: ${g.intro}`, impact: (best && best.impact) || l.impact || "N/A" } : l));
  }
  return out;
}

export function normalizeParas(body) {
  const { raw, bigGap } = readParas(body);
  const out = [];
  let curLever = null; // lever of the heading we are currently under
  const shortPlain = (q) => q.length <= 80 && !/\n/.test(q) && !/[.!?:]$/.test(q);
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i], next = raw[i + 1];
    if (isHeadingAt(raw, i)) curLever = leverFromHeading(leverHeadingOf(p));
    if (/^what\b.{0,40}\bdid$/i.test(p)) continue; // leftover table-template cell
    if (/^differentiation$/i.test(p) && i > 0 && leverFromHeading(leverHeadingOf(raw[i - 1])) === "product_differentiation") continue; // the table's own header cell under "Unique Product Differentiation"
    // a numbered strategy + its intro sentence + labelled supporting points = ONE strategy
    const support = supportGroupAt(raw, i);
    if (support) { out.push(support.text); i = support.end; continue; }
    // Product Differentiation often lists plain lines instead of title + paragraph: a short label (3 words or fewer, like "Packaging") keeps the lines under it as one strategy, anything else becomes one strategy per line, and the document's own empty paragraph ends a group.
    if (curLever === "product_differentiation" && !leverHeadingOf(p) && !/[.!?:]$/.test(p) && !/\n/.test(p) && wordCount(p) <= 45 && !TITLE_COLON.test(p) && !LABEL_PARA.test(p)
        && next && wordCount(next) <= 12 && !bigGap[i + 1] && !isHeadingAt(raw, i + 1) && !TITLE_COLON.test(next) && !LABEL_PARA.test(next) && !(out.length && /:$/.test(out[out.length - 1]))) {
      const run = [p];
      for (let j = i + 1; j < raw.length; j++) {
        const q = raw[j];
        if (bigGap[j] || isHeadingAt(raw, j) || TITLE_COLON.test(q) || LABEL_PARA.test(q) || /:$/.test(q) || /\n/.test(q) || wordCount(q) > 45) break;
        run.push(q);
      }
      if (wordCount(p) <= 3) out.push(`${p}: ${run.slice(1).join("\n")}`);
      else run.forEach((line) => { const m = line.match(/^(.{3,80}?)\s*\((.{3,})\)\s*\.?$/); out.push(m ? `${m[1].trim()}: ${m[2].trim()}` : `${line}: ${line}`); });
      i += run.length - 1;
      continue;
    }
    // numbered GROUP heading ("1.Understand the Business Well") directly above "Title: description" paragraphs: not a strategy
    if (out.length && /^\d+\s*[.)]\s*\S/.test(p) && !TITLE_COLON.test(p) && next && TITLE_COLON.test(next) && !/^problem\b/i.test(next)) continue;
    // a description may itself contain a colon ("…three needs at once: parents wanted…"), so a colon in `next` does not disqualify it
    // (a description may lack a final full stop; a paragraph ending in ":" is the intro of a list, not a description)
    const nextIsProse = next && wordCount(next) >= 12 && !/:$/.test(next) && !LABEL_PARA.test(next);
    const shortMnaEvidence = curLever === "acquisition_expansion_valuation" && next && wordCount(next) >= 5 && /[.!?]$/.test(next) && !/:$/.test(next) && !LABEL_PARA.test(next);
    // a real title line has no colon of its own and is at least 2 words ("No discounts", "Timeless designs"); the other guards
    // (heading, label, bullet-run) keep headings and outline bullets out
    const nW = wordCount(p);
    const enoughWords = nW >= 2 || (curLever === "product_differentiation" && nW === 1);
    const titleLine = p.length <= 140 && !/\n/.test(p) && !/[.!?:]$/.test(p) && !TITLE_COLON.test(p) && !LABEL_PARA.test(p) && enoughWords;
    // two short lines in a row are outline bullets (e.g. YETI "Roy 50.5% / Ryan 49.5%" then "Equity was not given for free…"), not title + description
    const prev = out[out.length - 1];
    const afterBullet = prev && ((shortPlain(prev) && !leverHeadingOf(prev)) || /:$/.test(prev)); // also: the line after a list intro ("They settled on:") is a list item
    if (titleLine && (nextIsProse || shortMnaEvidence) && !afterBullet && !leverHeadingOf(p) && !/^(analysis|power cash)/i.test(p)) {
      out.push(`${stripItemNumber(p)}: ${next}`);
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}

/* Where does this record's strategy sit in the document? Matches on the strategy TITLE (robust even if the model
   condensed the description). If the same title appears under two headings, prefer the occurrence under the heading
   that matches the record's lever. Returns -1 when not found. */
function locateClaim(nBody, claim, heads, modelLever, paraStarts) {
  const nm = normWs(splitClaim(claim).name || claim).slice(0, 80);
  if (!nm) return -1;
  // a strategy title sits at the START of a paragraph; a mention inside another description (e.g. "...a Find-A-Bear
  // identification system…" under Pricing) must not count
  let all = (paraStarts || []).filter((x) => x.n.startsWith(nm)).map((x) => x.pos);
  if (!all.length) for (let i = nBody.indexOf(nm); i >= 0; i = nBody.indexOf(nm, i + 1)) all.push(i);
  if (!all.length) return -1;
  if (all.length === 1) return all[0];
  const headOf = (p) => [...heads].reverse().find((x) => x.pos <= p);
  return all.find((p) => { const h = headOf(p); return h && leverFromHeading(h.text) === modelLever; }) ?? all[0];
}

/* Give the M&A material one shape before the model sees it: every strategy / criterion becomes ONE paragraph
   "Title: <all of its text>" (sentences, quote lines, list items and bullet fragments stay inside it, one per line), so the model
   never has to guess where a strategy starts and a quote or bullet can never become a record of its own.
   Titles are detected structurally:
   - "Title: text" paragraphs;
   - numbered criteria ("5. Synergy with Existing Platform");
   - a short Title-Case line followed by a prose paragraph ("Buy-and-Build"), or by a long list-intro sentence ("Highly Selective"
     then "The interview describes … approximately:"). Role labels ("Operating Companies" then "Continue to manage:") and list
     items ("Valuation", "People / Culture Fit") are NOT titles.
   A block with no title (e.g. the whole "Post-Acquisition Strategy" section) stays an untitled paragraph for the model to name. */
const MNA_SMALL_WORDS = new Set(["a", "an", "and", "or", "of", "on", "in", "to", "for", "with", "the", "at", "by", "from", "vs", "as", "into", "over"]);
const mnaIsShort = (p) => { const t = String(p || "").trim(); return !!t && !/\n/.test(t) && t.length <= 90 && wordCount(t) <= 12 && !/[.!?;:,]["”’']?$/.test(t); };
const mnaIsIntro = (p) => /:\s*$/.test(String(p || "").trim());
// prose = a real paragraph, not a list item: 8+ words, not a list intro, and either ends like a sentence, contains a sentence break, or is long
const mnaIsProse = (p) => { const t = String(p || "").trim(); return wordCount(t) >= 8 && !/[:;]$/.test(t) && (/[.!?]["”’']?$/.test(t) || /[.!?]\s+[A-Z“"]/.test(t) || wordCount(t) >= 14); };
const mnaTitleCase = (p) => {
  const sig = stripItemNumber(p).split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  return sig.length > 0 && sig.every((w) => w.split("-").every((part) => !part || MNA_SMALL_WORDS.has(part.toLowerCase()) || /^[A-Z0-9“"(]/.test(part)));
};
function mnaIsTitleAt(paras, i) {
  const p = paras[i], prev = paras[i - 1], next = paras[i + 1];
  if (!next || !mnaIsShort(p)) return false;
  if (stripItemNumber(p) !== p.trim()) return true; // numbered criterion ("5. Title", "3.2 Title")
  if (!mnaTitleCase(p)) return false;
  if (mnaIsProse(next) && !(prev && mnaIsIntro(prev))) return true;
  if (mnaIsIntro(next) && wordCount(next) >= 6 && !(prev && mnaIsIntro(prev))) return true;
  return false;
}
export function structureMnaParas(body) {
  const paras = String(body || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    if (cur.raw) out.push([cur.raw, ...cur.lines].join("\n"));
    else if (cur.title) { if (cur.lines.length) out.push(`${cur.title}: ${cur.lines.join("\n")}`); } // a title with no text under it is not a strategy
    else if (cur.lines.length) out.push(cur.lines.join("\n"));
    cur = null;
  };
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (isHeadingAt(paras, i)) { flush(); out.push(p); continue; }
    // a short "Label: value" line inside a numbered item ("Target acquisition multiple: approximately 8× EBITDA") is part of that item
    if (cur && cur.numbered && TITLE_COLON.test(p) && wordCount(p) <= 12 && !LABEL_PARA.test(p)) { cur.lines.push(p); continue; }
    if (TITLE_COLON.test(p) && !LABEL_PARA.test(p)) { flush(); cur = { raw: p, lines: [] }; continue; }
    if (mnaIsTitleAt(paras, i)) { flush(); cur = { title: stripItemNumber(p).trim(), numbered: stripItemNumber(p) !== p.trim(), lines: [] }; continue; }
    if (!cur) cur = { title: "", lines: [] };
    cur.lines.push(p);
  }
  flush();
  return out;
}

/* "Others" records need a category (legal / business model / financing / operations / partnerships / governance). Picking it inside the big
   extraction prompt is unreliable, and a record the code moves to Others (because it sits under an "Other…" heading) arrives with none at all.
   So one small dedicated call files every Others record into exactly ONE category. If that call fails, the category the model gave is kept. */
async function classifyOthers(levers) {
  const at = levers.map((l, i) => (l.lever === "others" ? i : -1)).filter((i) => i >= 0);
  if (!at.length) return levers;
  const items = at.map((i, n) => { const { name, desc } = splitClaim(levers[i].claim_en); return `${n}. ${name || "(untitled)"} — ${String(desc).replace(/\s+/g, " ").slice(0, 380)}`; });
  const prompt = `You classify business strategies for an advisory knowledge base. File EACH strategy below into exactly ONE category, judged by what the strategy is really about.

CATEGORIES:
${otherCatDefs()}

Guidance: money coming in or being kept (debt, investors, equity sold, reinvested profit, cash reserves, conservative profit targets) = financing_capital. Contracts, leases, trademarks, IP, regulation = legal_regulatory_ip. How owners split ownership or roles (avoid 50:50, divide roles clearly) = shareholder_governance. A sales model, positioning, focus or the choice to keep the model going = business_model_execution. Written procedures and how work is organised = operations_process. Use uncategorized only when truly nothing fits.

STRATEGIES:
${items.join("\n")}

Return ONLY JSON: {"items":[{"i":0,"category":"<one category id>"}, ...]} with one entry per strategy.`;
  let res;
  try { res = await askAI(prompt, 300 + 40 * at.length); } catch { return levers; }
  const out = levers.slice();
  (res && Array.isArray(res.items) ? res.items : []).forEach((it) => {
    const i = at[Number(it && it.i)];
    const c = String((it && it.category) || "").trim();
    if (i !== undefined && OTHER_CATS.includes(c)) out[i] = { ...out[i], other_category: c };
  });
  return out;
}

/* Bullet lists. Plain-text extraction loses the list markers, but the .docx HTML still has the real <li> items. A description
   keeps its words untouched; the document's own list items are only moved onto their own "• item" lines. */
const htmlText = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
function listItemsOf(html) {
  const out = [];
  const re = /<li\b[^>]*>((?:(?!<\/?(?:li|ul|ol)\b)[\s\S])*)/gi; // an item's own text, up to a nested list or its end
  let m;
  while ((m = re.exec(String(html || "")))) { const t = htmlText(m[1]); if (t && t.length <= 600) out.push(t); }
  return out;
}
function withBullets(desc, items) {
  const s = String(desc || "").replace(/\s+/g, " ").trim();
  if (!s || !items || !items.length) return desc;
  const marks = [];
  let cursor = 0;
  for (const it of items) {
    const at = s.indexOf(it, cursor);
    if (at < 0) continue;
    const endAt = at + it.length;
    if ((at > 0 && s[at - 1] !== " ") || (endAt < s.length && s[endAt] !== " ")) continue;
    const prev = marks[marks.length - 1];
    const continuesRun = prev && at === prev.end + 1;
    const before = s.slice(0, at).trimEnd();
    // the first item of a list follows its intro ("...are:") or the start; a short word elsewhere is just prose
    if (!continuesRun && at > 0 && !(/:$/.test(before) || (wordCount(it) >= 4 && /[.!?;]$/.test(before)))) continue;
    marks.push({ start: at, end: endAt });
    cursor = endAt;
  }
  if (!marks.length) return desc;
  let res = "", pos = 0, lastBullet = false;
  marks.forEach((m) => {
    const gap = s.slice(pos, m.start).trim();
    if (gap) res += (res ? (lastBullet ? "\n" : " ") : "") + gap;
    res += (res ? "\n" : "") + "• " + s.slice(m.start, m.end);
    pos = m.end; lastBullet = true;
  });
  const rest = s.slice(pos).trim();
  return rest ? `${res}\n${rest}` : res;
}

export async function extractDocument(text, title, customLevers = [], html = "", opts = {}) {
  const listItems = listItemsOf(html);
  const isMnaDocument = typeof opts.mna === "boolean" ? opts.mna : detectMnaDocument(text, title); // the person's M&A tick wins; otherwise by section headings, never by the word "acquisition" appearing somewhere in the text
  // a collection / receivables playbook written as a numbered outline is read by code (no AI): by its Word headings, or its numbering
  const isCollectionFramework = !isMnaDocument && (detectOutlineDocument(text, title) || detectCollectionFramework(text, title));
  if (isCollectionFramework) return withNotices(extractCollectionFrameworkRecords(text, title, html), saveLimitNotice(text));
  const isSummaryCardDocument = !isMnaDocument && !isCollectionFramework && (String(text || "").match(/^\s*Key Strategy\s*[:：]/gim) || []).length >= 2;
  const mnaScoped = isMnaDocument ? scopeMnaSections(text) : null;
  const scoped = mnaScoped ? (mnaScoped.body.trim() ? mnaScoped : { context: "", body: text }) : isCollectionFramework ? scopeCollectionFramework(text) : scopeMaterial(text); // ticked as M&A by hand but no M&A headings: read the whole text
  const { context, body: rawBody } = scoped;
  const mnaTitledSupport = isMnaDocument && mnaNumberedKinds(rawBody).has("company_support"); // "6.1 …", "6.2 …": one record each, not one for the whole section
    const bodyParas = isMnaDocument ? structureMnaParas(rawBody) : normalizeParas(rawBody);
  const body = bodyParas.join("\n\n");
  // Keep the full in-scope source. A fixed character cap silently removed later strategies
  // from long documents before chunking could preserve them.
  const chunks = chunkMaterial(body);
  if (context) chunks[0] = `[BACKGROUND ONLY — use just to identify title/industry; extract NOTHING from this block]
${context}
[END BACKGROUND]

` + chunks[0];
  // normalized text of every "Power Cash Link:" paragraph in the document, used to reject a PCL passed off as an impact
  const pclTexts = bodyParas.filter((p) => /^power\s+cash\s+link\s*[:：]/i.test(p)).map((p) => normWs(p.replace(/^power\s+cash\s+link\s*[:：]\s*/i, ""))).filter((t) => t.length > 12);
  let merged = null;
  const seenSec = new Set();
  const seenLev = new Set();
  const ingest = (j) => {
    if (!merged) { merged = { ...j, sections: [], levers: [] }; delete merged.strategy_titles; }
    for (const s of j.sections || []) {
      const key = normWs(s.heading);
      if (!key || seenSec.has(key)) continue;
      seenSec.add(key); merged.sections.push(s);
    }
    for (let l of (Array.isArray(j.levers) ? j.levers : [])) {
      // Some model responses serialize an individual lever object as a JSON string inside the levers array.
      // Recover that object instead of aborting the entire document extraction.
      if (typeof l === "string") { try { l = JSON.parse(l); } catch { continue; } }
      if (!l || typeof l !== "object" || Array.isArray(l)) continue;
      // model returns name + description separately; store them as ONE claim ("Name: description") so search/chat/edit keep working
      // the model likes to swap "-" for a non-breaking hyphen (U+2011) and use odd spaces: restore plain characters so text matches the document exactly
      const plain = (x) => String(x || "").split(String.fromCharCode(0x2011)).join("-").split(String.fromCharCode(0xA0)).join(" ").split(String.fromCharCode(0x202F)).join(" ");
      l.strategy_name = plain(l.strategy_name).trim().replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, "");
      l.description = plain(l.description); l.impact = plain(l.impact);
      if (isSummaryCardDocument) l.impact = summaryCardRealizedImpact(l.impact);
      // table/template cells ("What Sweetwater Did", "Differentiation", a lever heading) are never strategies
      {
        const nm0 = String(l.strategy_name || "").trim(), ds0 = String(l.description || "").trim();
        if (/^what\b.{0,40}\bdid$/i.test(nm0) || leverHeadingOf(nm0) || (nm0 && normWs(nm0) === normWs(l.section || "")) || (nm0 && !ds0 && wordCount(nm0) < 5)) continue;
      }
      if (l.strategy_name) {
        const nm = String(l.strategy_name).trim().replace(/[:：]\s*$/, "");
        let ds = String(l.description || "").trim();
        // Remove only a repeated exact title prefix; source matching below restores the original description.
        const escapedName = nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        ds = ds.replace(new RegExp(`^${escapedName}\\s*[:\\uFF1A]\\s*`, "i"), "");
        if (normWs(ds) === normWs(nm)) ds = "";
        l.claim_en = ds ? `${nm}: ${ds}` : nm; // title and description were the same text: keep it once, no dangling colon
        delete l.strategy_name; delete l.description;
      } else if (String(l.description || "").trim() && !String(l.claim_en || "").trim()) {
        // no title returned (untitled strategy or summary card): keep the original-wording text as the claim instead of losing the record
        l.claim_en = String(l.description).trim();
        delete l.strategy_name; delete l.description;
      }
      // no actual impact in the doc → exactly "N/A" (never blank, never a Power Cash Link substitute)
      // a Power Cash Link is never the impact: drop it if the model copied one (with or without the label)
      const pclHit = (x) => { const n = normWs(stripImpactLabel(x)); return !!n && (/^\s*power\s+cash\s+link/i.test(x) || pclTexts.some((t) => t === n || t.includes(n) || n.includes(t))); };
      const imp = pclHit(l.impact) ? "" : stripImpactLabel(l.impact);
      const isNone = (x) => !x || /^(n\/?a|none|nil|not (available|stated|specified)|-+|—)\.?$/i.test(x);
      const snapped = isNone(imp) ? "" : imp; // snapped to the document's own sentences in the final stage
      l.impact = isNone(snapped) ? "N/A" : snapped;
      const key =`${l.lever}|${normWs(l.claim_en).slice(0, 40)}`;
      if (seenLev.has(key)) continue;
      seenLev.add(key); merged.levers.push(l);
    }
  };
  // the model's answers for one piece of material, in order (a piece whose answer is not valid JSON is halved and retried)
  const extractResults = async (material, part, totalParts = chunks.length, depth = 0) => {
    try {
      return [await askAI(buildExtractionPrompt(material, title, part, totalParts, customLevers, isMnaDocument, isCollectionFramework), 3000)];
    } catch (error) {
      if (!(error instanceof AIError) || error.kind !== "json_output") throw error;
      const halves = depth < 7 ? splitMaterialForRetry(material) : null;
      if (!halves) throw new Error("AI could not return valid JSON for this source text. No text was shortened or discarded; split this material into smaller complete paragraphs and try again.", { cause: error });
      return [...(await extractResults(halves[0], part, totalParts, depth + 1)), ...(await extractResults(halves[1], part, totalParts, depth + 1))];
    }
  };
  const extractAndIngest = async (material, part, totalParts = chunks.length) => { for (const r of await extractResults(material, part, totalParts)) ingest(r); };
  const parallel = Math.max(1, Math.min(await keysInUse(), 4, chunks.length));
  if (parallel <= 1) {
    for (let k = 0; k < chunks.length; k++) await extractAndIngest(chunks[k], k + 1, chunks.length);
  } else {
    // several chunks at once (one per key, at most 4); the answers are merged in document order afterwards, exactly as if done one by one
    const answers = new Array(chunks.length);
    let next = 0, failed = false;
    await Promise.all(Array.from({ length: parallel }, async () => {
      while (!failed && next < chunks.length) {
        const k = next++;
        try { answers[k] = await extractResults(chunks[k], k + 1, chunks.length); } catch (e) { failed = true; throw e; }
      }
    }));
    answers.forEach((rs) => rs.forEach(ingest));
  }

  /* COVERAGE GUARANTEE — the model sometimes quietly skips a strategy (esp. ones with only a Power Cash Link and no
     Actual Impact). Find every "Title: description" paragraph in the strategy part of the document; any title without a
     record gets re-sent, alone with its own paragraphs, in ONE recovery call. */
  if (!isMnaDocument && !isCollectionFramework) merged.levers = foldSupportGroups(merged.levers, findSupportGroups(rawBody)); // "1. Strategy" + labelled points = one record
  const have = () => merged.levers.map((l) => normWs(l.claim_en));
  const missing = (isCollectionFramework ? [] : findStrategyParas(body)).filter((p) => {
    const probe = normWs(p.title).slice(0, 25);
    return !have().some((c) => c.includes(probe));
  }).slice(0, 12);
  if (missing.length) {
    const byHeading = new Map();
    missing.forEach((p) => { const h = p.heading || ""; byHeading.set(h, [...(byHeading.get(h) || []), p.text]); });
    const recText = [...byHeading].map(([h, ps]) => `${h ? h + "\n\n" : ""}${ps.join("\n\n")}`).join("\n\n");
    const recoveryPart = chunks.length + 1;
    await extractAndIngest(recText, recoveryPart, recoveryPart);
  }
  const src = normWs(text);
  // "Key Strategy" is the field that HOLDS the strategy, so a record filed under it is valid — it just needs a real
  // section name (the case/company heading). Only Result/Formula/Problem/KPI/failed/timeline sections are dropped.
  const firstLine = (text.split(/\r?\n/).find((x) => x.trim()) || "").replace(/^\s*\d+[.)]\s*/, "").trim();
  const caseHeading = firstLine.length <= 120 ? firstLine : (merged.title || title || "");
  const relabel = (h) => (KEY_STRATEGY_LABEL.test(h || "") && caseHeading ? caseHeading : h);
  merged.sections = merged.sections
    .filter((s) => !FIELD_LABEL_SECTION.test(s.heading || ""))
    .map((s) => ({ ...s, heading: relabel(s.heading) }));
  if (merged.levers.some((l) => KEY_STRATEGY_LABEL.test(l.section || "")) && !merged.sections.some((s) => s.heading === caseHeading) && caseHeading) {
    merged.sections.unshift({ heading: caseHeading, summary_en: merged.problem_signature || "", summary_zh: "" });
  }
  const nBody = normWs(body);
  // exact start of every paragraph: search from the END of the previous paragraph, so the word "volume" inside an earlier
  // description can never be mistaken for the "Volume" heading
  const paraStarts = (() => { const out = []; let cur = 0; for (const p of bodyParas) { const n = normWs(p); const i = nBody.indexOf(n, cur); if (i >= 0) { out.push({ pos: i, n, p }); cur = i + n.length; } } return out; })();
  const plainParas = paraStarts.map((x) => x.p);
  const heads = paraStarts.map((x, i) => ({ pos: x.pos, text: isHeadingAt(plainParas, i) ? leverHeadingOf(x.p) : null })).filter((x) => x.text);
  // where is this record's strategy in the document? (M&A: an untitled block falls back to the opening words of its description)
  const posOf = (l) => {
    const pos = locateClaim(nBody, l.claim_en, heads, l.lever, paraStarts);
    if (pos >= 0 || !isMnaDocument) return pos;
    const dk = normWs(splitClaim(l.claim_en).desc).slice(0, 60);
    if (dk.length >= 20) { const ix = nBody.indexOf(dk); if (ix >= 0) return ix; }
    // a paraphrased description: the (non-heading) paragraph that contains most of its words
    const want = tokSet(splitClaim(l.claim_en).desc);
    if (want.size < 5) return -1;
    let best = -1, bestScore = 0;
    paraStarts.forEach((x, i) => {
      if (isHeadingAt(plainParas, i)) return;
      const have = tokSet(x.p);
      let hit = 0; want.forEach((w) => { if (have.has(w)) hit++; });
      const score = hit / want.size;
      if (score > bestScore) { bestScore = score; best = x.pos; }
    });
    return bestScore >= 0.6 ? best : -1;
  };
  const paraIndexAt = (pos) => { let k = -1; for (let q = 0; q < paraStarts.length; q++) { if (paraStarts[q].pos <= pos) k = q; else break; } return k; };
  const regionIndex = (l) => { const pos = posOf(l); if (pos < 0) return -1; return isMnaDocument ? paraIndexAt(pos) : paraStarts.findIndex((x) => x.pos === pos); };
  // the strategy's own paragraph + the label / follow-up paragraphs under it, up to the next strategy or heading
  const regionAt = (k) => {
    if (k < 0) return null;
    const paras = [paraStarts[k].p];
    for (let q = k + 1; q < paraStarts.length; q++) {
      const pq = paraStarts[q].p;
      if (isHeadingAt(plainParas, q) || (TITLE_COLON.test(pq) && !LABEL_PARA.test(pq))) break;
      paras.push(pq);
    }
    return paras;
  };
  // how many records point at the same block: an untitled block the model split into several records must not be copied whole into each
  const regionUse = new Map();
  // an M&A list intro ("Acquisition opportunities may come from:") is dropped later: it must not take a share of its strategy's block
  const isListIntro = (l) => isMnaDocument && /^acquisition opportunities may come from\b/i.test(splitClaim(l.claim_en).name || l.claim_en || "");
  merged.levers.forEach((l) => { if (isListIntro(l)) return; const k = regionIndex(l); if (k >= 0) regionUse.set(k, (regionUse.get(k) || 0) + 1); });
  const descSentsOf = (paras) => {
    const first = paras[0].replace(TITLE_COLON.test(paras[0]) ? /^[^:\n]{2,299}?:\s+/ : /^$/, "");
    return [first, ...paras.slice(1).filter((q) => !LABEL_PARA.test(q) && !/^power\s+cash\s+link/i.test(q))].flatMap((q) => sentencesOf(q));
  };
  // records that share one block: divide the block's sentences between them in document order, so every original sentence
  // belongs to exactly one record (the first record also keeps the block's opening lines)
  const sharedSlices = new Map(); // claim text -> its sentences
  regionUse.forEach((count, k) => {
    if (count < 2) return;
    const sents = descSentsOf(regionAt(k));
    const recs = merged.levers.filter((l) => regionIndex(l) === k && !isListIntro(l)).map((l) => ({ l, st: windowStart(splitClaim(l.claim_en).desc, sents) }));
    if (recs.some((r) => r.st < 0)) return;
    recs.sort((a, b) => a.st - b.st);
    if (new Set(recs.map((r) => r.st)).size !== recs.length) return;
    recs.forEach((r, i) => sharedSlices.set(r.l.claim_en, sents.slice(i === 0 ? 0 : r.st, i + 1 < recs.length ? recs[i + 1].st : sents.length)));
  });
  merged.levers = merged.levers
    .filter((l) => !FIELD_LABEL_SECTION.test(l.section || ""))
    .map((l) => ({ ...l, section: relabel(l.section) }))
    // section + lever from the strategy's real position under its heading (overrides the model's guess)
    .map((l) => {
      const pos = posOf(l);
      const h = pos < 0 ? null : [...heads].reverse().find((x) => x.pos <= pos);
      return h ? { ...l, section: h.text } : l;
    })
    // Collection framework records all describe receivables or collection control. Their section names are not lever headings,
    // so the generic heading mapper returns "others"; force the domain-specific AR lever and discard Others-only metadata.
    .map((l) => {
      if (isCollectionFramework) {
        const record = { ...l };
        delete record.other_category;
        delete record.related_to;
        return { ...record, lever: "ar_days" };
      }
      const fixed = leverFromHeading(l.section);
      if (isMnaDocument && fixed === "others" && l.lever === "acquisition_expansion_valuation") return l;
      return fixed && fixed !== l.lever ? { ...l, lever: fixed } : l;
    })
    // description + impact = the document's ORIGINAL sentences (no length limit), whatever the model made of them
    .map((l) => {
      const k = regionIndex(l);
      const paras = regionAt(k);
      if (!paras) return l;
      const shared = (regionUse.get(k) || 0) > 1 && !isListIntro(l);
      const parsed = splitClaim(l.claim_en);
      let name = parsed.name;
      const desc = parsed.desc;
      const firstDescription = paras[0].replace(TITLE_COLON.test(paras[0]) ? /^[^:\n]{2,299}?:\s+/ : /^$/, "");
      const descriptionSource = [firstDescription, ...paras.slice(1).filter((q) => !LABEL_PARA.test(q) && !/^power\s+cash\s+link/i.test(q))];
      let descSents = descriptionSource.flatMap((q) => sentencesOf(q));
      const impSents = [...descSents, ...paras.slice(1).filter((q) => !/^power\s+cash\s+link/i.test(q)).flatMap((q) => sentencesOf(stripImpactLabel(q)))];
      const labelled = paras.slice(1).filter((q) => /^(actual\s+impacts?|impacts?|financial\s+impact|results?)\b[^:：\n]{0,30}[:：]/i.test(q));
      // M&A "What <Company> Brings…" section = ONE record: the block's own introductory phrase as the title, the whole block (every list item) as the description
      if (isMnaDocument && !mnaTitledSupport && mnaSectionKind(l.section) === "company_support") {
        const introTitle = TITLE_COLON.test(paras[0]) ? paras[0].match(/^([^:\n]{2,299}?):/)[1].trim() : name;
        const whole = descSents.join(" ");
        return { ...l, claim_en: introTitle ? `${introTitle}: ${whole}` : whole, impact: "N/A" };
      }
      if (shared && sharedSlices.get(l.claim_en)?.length) {
        let nm = name, sl = sharedSlices.get(l.claim_en);
        // M&A: a label the model made up is replaced by the slice's own opening sentence
        if (isMnaDocument && nm && !nBody.includes(normWs(nm)) && sl.length > 1) {
          const lead = sl[0].replace(/[.:;,\s]+$/, "");
          if (wordCount(lead) <= 12) { nm = lead; sl = sl.slice(1); }
        }
        const imp2 = l.impact && l.impact !== "N/A" ? stripImpactLabel(snapToSource(l.impact, impSents)) : "N/A";
        const imp2N = imp2 !== "N/A" ? normWs(imp2) : "";
        const kept = sl.filter((sn) => !imp2N || !imp2N.includes(normWs(sn)));
        let dsc = (kept.length ? kept : sl).join(" ");
        // M&A: the title is shown in bold, so it must not be repeated at the start of the description
        if (isMnaDocument && nm) dsc = dsc.replace(new RegExp("^" + nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s,;:.\\u2013-]*", "i"), "") || dsc;
        return { ...l, claim_en: nm ? `${mnaTitle(nm)}: ${dsc}` : dsc, impact: imp2 || "N/A" };
      }
      if (shared) {
        // several records came from this one block: snap each to the original sentences it matches instead of copying the whole block into each
        const d2 = snapToSource(desc, descSents);
        const i2 = l.impact && l.impact !== "N/A" ? stripImpactLabel(snapToSource(l.impact, impSents)) : "N/A";
        return { ...l, claim_en: name ? `${name}: ${d2}` : d2, impact: i2 || "N/A" };
      }
      // M&A: a label the model made up (found nowhere in the document) is replaced by the block's own opening sentence
      if (isMnaDocument && name && !nBody.includes(normWs(name)) && descSents.length) {
        const lead = descSents[0].replace(/[.:;,\s]+$/, "");
        if (wordCount(lead) <= 12) { name = lead; if (descSents.length > 1) descSents = descSents.slice(1); }
      }
      // the document's own labelled impact paragraph ("Actual Impact:", "Impact:", "Financial Impact:", "Result:") is used whole and unchanged;
      // only when there is none do we fall back to matching the model's impact to the nearest original sentence(s)
      const impact = labelled.length
        ? labelled.map((q) => stripImpactLabel(q)).join(" ")
        : (l.impact && l.impact !== "N/A" ? stripImpactLabel(snapToSource(l.impact, impSents)) : l.impact);
      // description = the WHOLE original paragraph, minus the sentence(s) that went into the impact box — never shortened
      const impN = impact && impact !== "N/A" ? normWs(impact) : "";
      const descFull = descSents.filter((sn) => !impN || !impN.includes(normWs(sn)));
      // a one-sentence strategy whose "impact" swallowed the entire description is just a description: keep the full original sentence, impact = N/A
      const swallowed = !descFull.length && descSents.length && !labelled.length;
      let newDesc = name ? (swallowed ? descSents.join(" ") : descFull.length ? descFull.join(" ") : snapToSource(desc, descSents, true)) : l.claim_en;
      // M&A: the title is shown in bold, so it must not be repeated at the start of the description
      if (isMnaDocument && name) newDesc = newDesc.replace(new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s,;:.\\u2013-]*", "i"), "") || newDesc;
      if (isMnaDocument && name && !/[A-Za-z0-9]/.test(newDesc)) return { ...l, claim_en: descSents.join(" ") || name, impact: swallowed ? "N/A" : (impact || "N/A") }; // title was the whole sentence: show it once
      return { ...l, claim_en: name ? `${isMnaDocument ? mnaTitle(name) : name}: ${newDesc}` : newDesc, impact: swallowed ? "N/A" : (impact || "N/A") };
    })
    // the document's own bullet lists stay bullet lists in the description
    .map((l) => {
      if (!listItems.length) return l;
      const { name, desc } = splitClaim(l.claim_en);
      const d2 = withBullets(desc, listItems);
      return d2 === desc ? l : { ...l, claim_en: name ? `${name}: ${d2}` : d2 };
    })
    // M&A documents: a list intro and the concluding recap are not strategies, and a "what the company brings" section yields at most ONE record
    .filter((l) => {
      if (!isMnaDocument) return true;
      const strategyName = splitClaim(l.claim_en).name || l.claim_en || "";
      if (/^acquisition opportunities may come from\b/i.test(strategyName)) return false;
      if (/model\s+in\s+one\s+line|^\s*summary\b/i.test(l.section || "")) return false;
      return true;
    })
    .filter((l, i, arr) => !isMnaDocument || mnaTitledSupport || mnaSectionKind(l.section) !== "company_support" || arr.findIndex((x) => mnaSectionKind(x.section) === "company_support") === i)
    // enforce the "verbatim" rule: drop a quote the model paraphrased or invented
    .map((l) => (l.quote && !src.includes(normWs(l.quote)) ? { ...l, quote: "" } : l))
    // keep the document's own order (recovered strategies are appended last by the coverage check)
    .map((l, i) => { const p = posOf(l); return { l, k: p < 0 ? Infinity : p, i }; })
    .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k - b.k))
    .map((x) => x.l)
    .slice(0, 60);
  // This section is explicitly one coordinated practice. The model sometimes promotes each checklist bullet
  // to a separate record; rebuild it from the selected source paragraphs as one verbatim record.
  if (isCollectionFramework) {
    const winHeadingIndex = bodyParas.findIndex((p) => /^Win the Internal War First\s*:?$/i.test(p));
    if (winHeadingIndex >= 0) {
      let end = bodyParas.length;
      for (let i = winHeadingIndex + 1; i < bodyParas.length; i++) {
        if (COLLECTION_TOP_SECTIONS.some(([re]) => re.test(bodyParas[i]))) { end = i; break; }
      }
      const detail = bodyParas.slice(winHeadingIndex + 1, end).filter((p) => !/^Win the Internal War First\s*:?$/i.test(p));
      if (detail.length) {
        merged.levers = merged.levers.filter((l) => normWs(l.section) !== normWs("Win the Internal War First"));
        const description = detail.map((p) => /^The internal war is won when:/i.test(p) ? p : `• ${p.replace(/^•\s*/, "")}`).join("\n");
        merged.levers.push({ lever: "ar_days", section: "Win the Internal War First", claim_en: `Win the Internal War First: ${description}`, impact: "N/A" });
      }
    }
  }
  // Restore exact strategy text and results from explicitly labeled summary cards after model classification.
  if (isSummaryCardDocument) {
    const cards = parseSummaryStrategyCards(text);
    if (cards.length) merged.levers = restoreSummaryStrategyCards(merged.levers, cards);
  }
  // every section a record points to must exist in the sections list (headings detected in code may be new to the model's list)
  const haveSec = new Set(merged.sections.map((s) => normWs(s.heading)));
  merged.levers.forEach((l) => {
    const k = normWs(l.section);
    if (k && !haveSec.has(k)) { haveSec.add(k); merged.sections.push({ heading: l.section, summary_en: "", summary_zh: "" }); }
  });
  merged.levers = await classifyOthers(merged.levers); // one small call: every Others record gets exactly one category
  merged.levers = sortByLever(merged.levers); // then group by lever, in the fixed lever order (document order kept inside each lever)
  return withNotices(merged, saveLimitNotice(text)); // tell the person when part of a very long document will not be saved
}

// One small AI call for the whole collection: which lever and which industry each story has. If it fails the cards just land under Others with a warning.
async function classifyCompilationCards(cards) {
  const leverIds = [...LEVERS, ...CUSTOM_LEVERS.map((l) => l.id)];
  const leverLines = [...LEVERS.filter((id) => id !== "others").map((id) => leverDefLine(id)), ...CUSTOM_LEVERS.map((l) => `- ${l.id}: ${l.description}`)];
  const prompt = buildClassifyPrompt(cards, { leverLines, otherCats: OTHER_CATS, otherCatDefs: otherCatDefs() });
  try { return readClassification(await askAI(prompt, 600 + 100 * cards.length), cards, { leverIds, otherCats: OTHER_CATS }); } catch { return null; }
}

// Turns an accepted split offer into list items, one per story, each with its extraction already built (so it goes through the normal review and save screens).
export async function buildCompilationItems(offer, parentTitle) {
  const classes = await classifyCompilationCards(offer.cards);
  return offer.cards.map((card, i) => ({
    id: uid(), name: `${parentTitle} (${card.n}/${offer.cards.length})`, title: card.title, text: card.text, html: "", status: "done", error: "", elapsed: 0, parent: parentTitle,
    extraction: buildCardExtraction({ card, total: offer.cards.length, parentTitle, classification: classes ? classes[i] : null, intro: offer.intro }),
  }));
}

function buildExtractionPrompt(capped, title, part = 1, parts = 1, customLevers = [], forceMna = false, forceCollectionFramework = false) {
  const customs = customLevers.length ? customLevers : CUSTOM_LEVERS; // custom levers come from the lever definitions, exactly like the built-in ones
  const customBlock = customs.length ? `
CUSTOM LEVERS (added by the administrator in Admin settings; they are as real as the levers above and take precedence over "others"):
${customs.map((l) => `- ${l.id} ("${l.name}"): ${l.description}${l.example ? ` Example: ${l.example}` : ""}${customHeadingWords(l).length ? ` Document headings for it: ${customHeadingWords(l).join(", ")}.` : ""}`).join("\n")}
When a strategy clearly matches a custom lever's definition, or sits under one of its headings, set lever to that custom id (never "others"). Keep a built-in lever when it fits better.
` : "";
  const isMnaDoc = !!forceMna; // decided in code from the document's section headings, not by keywords in the chunk
  const isCollectionDoc = !!forceCollectionFramework;
  const mnaRules = isMnaDoc ? `
M&A DOCUMENT MODE. The material was prefiltered in code to these sections only: "M&A Appetite" (the heading may continue, e.g. "M&A Appetite & Capital Allocation"), "Acquisition Criteria", "Post-Acquisition Strategy" and "What [Company] Brings/Provides to Acquired Companies" (headings may be numbered). Extract NOTHING from the background block or from anything outside those sections. No "Key Strategies" heading is needed: in an M&A document a strategy is an explicit acquisition action, policy, target-selection criterion, deal structure or operating approach.

HOW THE MATERIAL IS LAID OUT (already structured for you by code):
- A strategy or criterion is ONE paragraph that starts with "Title: text". Every further line inside that paragraph (sentences, quote lines, list items, bullet fragments) belongs to THAT SAME strategy — it is its description.
- A paragraph with no "Title:" prefix is an untitled block under a section heading.
- A line that is just a section heading is never a strategy.

RULES:
1. One record per "Title: text" paragraph — every numbered criterion and every appetite point gets its own record; do not skip any. Never create a record from a quote line, a list item or a bullet that sits inside a paragraph (for example a quoted remark, "Valuation" / "People / Culture Fit" in a list of reasons, or "Catcha HQ;" in a list of sourcing channels). A list that only introduces sources ("Acquisition opportunities may come from:") is part of its strategy's description, not a separate record.
2. strategy_name = the title text without its outline numbering (for example "10.2 Long-Term Ownership" becomes "Long-Term Ownership"). Copy the remaining title text faithfully into strategy_name; never include the number or repeat the title at the start of description. Document section headings are labels only, not strategies: do not create a lever record from a main heading such as "Acquisition Criteria" or "Post-Acquisition Strategy". Use the exact section heading (without its number) as "section"; never substitute a lever word such as "Valuation" for a heading.
3. Untitled block: extract the explicit approach or policy it states. strategy_name must be a short phrase copied word for word from that block (for example its opening words) — never an invented label such as "Decentralized Operating Model" unless those exact words appear. Role labels ("Operating Companies", "[Company] HQ") and bullets under them are parts of ONE operating model: create ONE record for a coordinated approach (a decentralized model with its role split; a support offering with its list of capabilities). Only a separate, explicit learning or policy in the same block (for example "not every acquisition needs to be fully integrated") may be its own record. Under a "What [Company] Brings…" (or "Provides…") heading whose material is an UNTITLED list, create at most ONE record, titled with the block's introductory phrase, with the full list and every sentence kept together; if that heading holds numbered, titled items (6.1, 6.2 …), each titled item is its own record (rule 1).
4. description = the complete original text of the paragraph, exact words and order (this includes list items and quoted remarks inside it), minus only the sentence(s) that report a realised result.
5. impact = a sentence that reports a result that actually happened (for example revenue that was multiplied after an acquisition). Counts or ratios that merely support a policy ("1 company out of every 100 reviewed") stay in the description. If no realised result is stated, impact = "N/A". Never use theory or Power Cash Link text as impact.
6. Do not make a strategy from company size, revenue/EBITDA figures, sector descriptions, deal counts, aspirations or capabilities. Ignore a concluding one-line summary that only repeats strategies already stated.
7. lever = acquisition_expansion_valuation for all M&A records. All exact-copy, impact and no-invention rules below still apply.
` : "";
  const collectionRules = isCollectionDoc ? `
COLLECTION FRAMEWORK MODE. The source is a reusable collection/debt-recovery framework, not a single-company case-study narrative. Code has selected explicit management, internal-alignment, current-practice, and debt-reduction sections. Do not extract generic mindset material, call scripts, etiquette, persuasion examples, debtor scenarios, objections, negotiation techniques, formulas, or KPIs.

RULES:
1. Set doc_type to "framework". Label advice as a recommendation; describe an existing YYC practice as current only when the source explicitly says it is already used.
2. COVERAGE IS REQUIRED: extract every named practice and every numbered strategy/subheading in the selected sections, from the first through the last. In particular, create separate records for each 4.1–4.4 strategy under "Current Collection Strategies Identified in YYC" and each 10.1–10.6 strategy under "Strategies to Reduce Debt" when present. Do not omit earlier entries, stop after one section, or combine separate titled strategies into one record. In "Win the Internal War First", make at most one record for the coordinated approach in that section.
3. Keep examples and supporting bullet points with their parent policy. They are not separate records.
4. Remove outline numbering from strategy_name (for example "10.2 Review credit assessment" becomes "Review credit assessment"). Do not create a record from a main section heading; it belongs in "section" only. Use the remaining policy or practice title faithfully, and copy the supporting source wording exactly into description. Do not turn a heading fragment, example, metric, or client scenario into a strategy.
5. Use ar_days for policies that directly affect receivables, payment terms, billing, credit control, monitoring, collection escalation, or continuation of work. Use another lever only when the described action clearly fits it better.
6. Set impact to "N/A" unless this material states a realized result tied to that specific policy. Targets, formulas, planned actions, and general benefits are not impacts.
` : "";
  // Only the document formats this material can contain are sent (fewer tokens per call, fewer irrelevant rules)
  const hasKeyStrategyCard = /key\s+strateg(?:y|ies)\s*[:\uFF1A]/i.test(capped);
  const formatA = `FORMAT A — LONG CASE STUDY. Narrative part, then an "Analysis" / "Power Cash Links" part organised as:
  <Lever heading>            e.g. "Pricing", "Volume", "Inventory", "Talent Strategy"
    <Named strategy>         a short title line, e.g. "No discounts"
    <description paragraph>
    "Actual Impact:" <result>                        ← evidence only
    "Power Cash Link:" <why it moves profit/cash>    ← IGNORE (not the impact; never copy it)
    ...then the NEXT named strategy under the same lever heading...
  Create ONE record PER NAMED STRATEGY — never one per lever heading. If Pricing lists 4 named strategies, output 4 price records; compressing them into one is an extraction failure. Keep the strategy name in the claim.

  Titles appear in THREE layouts — treat all of them as strategy titles, each starting a new record:
    (i)   "Title (optional hint): description on the same line"        e.g. "Sell Experience, Not Just Products (reduce price sensitivity): Because customers…"
    (ii)  Title alone on one line, description on the NEXT line/paragraph (table-like)   e.g. "Combine Multiple Needs in One Offering" then its description
    (iii) Short noun-phrase titles, e.g. "Find-A-Bear identification system" then its description
  Every such title inside an in-scope heading (Pricing … Talent Strategy, Other Strategies) is a strategy — even short ones and ones that repeat a title used under another lever.
    (iv)  OUTLINE: a short title line (no colon) followed by several short lines or bullets — e.g. "Avoid 50:50 ownership" then lines about the ownership split; "Divide roles clearly" then "Roy: …" / "Ryan: …". The title is ONE strategy; the lines under it are that strategy's description (copy their own words, in order — do not summarise). Do NOT make a separate record from each bullet ("Roy: …", "Ryan: …", "Equity was not given for free…").
    (v)   PRODUCT DIFFERENTIATION LISTS: under "Product Differentiation" the document often only lists what makes the product different, as plain lines with no action verb and no "Actual Impact" — e.g. a label "Packaging" with lines "Colourful, fun, bright, playful" / "Some have transparent packaging…", then lines such as "Selling high quality and fresh products", "Fast delivery (within 1-2 days)", "Good & personalised shopping experience (…)". These ARE the strategies of that heading; never skip them for lacking a decision verb. One record per label (its lines are the description) and one record per remaining line that names a separate differentiator (a parenthesis after it stays with it). strategy_name = the label or the line's own opening words, copied exactly; impact "N/A" unless an Actual Impact is attached. Never merge different differentiators into one record.
    (vi)  NUMBERED STRATEGY WITH SUPPORTING POINTS: one paragraph "Title: intro sentence ending in a colon" followed by lines of the form "Label: point" (e.g. "Lean into Strengths (…): Jeff recognized … :" then "Recognizing Personal Strengths: …" and "Stepping Down as CEO: …"). The FIRST title is the ONE strategy; the labelled lines are its supporting points and belong in its description. Never make a separate record from a supporting point's label.
  The SAME title under TWO different lever headings (e.g. "Simplify the Manufacturing Experience" under Cost of Goods Sold AND under Overhead) is NOT a duplicate: the descriptions explain different lever effects, so output one record under EACH heading.`;
  const formatB = `FORMAT B — SUMMARY CARD with labelled fields:
  <Company> (<Industry> / <Person>)
  Problem: ...   Key Strategy: ...   Formula/Theory: ...   Result: ...
  ONLY the "Key Strategy" field is a strategy. One Key Strategy sentence = ONE record, even if it has several clauses. Problem and Formula/Theory are context only. Return one record for every Key Strategy field in source order. The Key Strategy has no title of its own, so YOU write one: strategy_name = a SHORT label of 3-8 words saying what the strategy IS, in plain words that clearly match the sentence (reuse its key words); never the whole sentence, never blank, never ending in punctuation. description = the Key Strategy sentence copied in full, exactly as written (do not cut it, do not drop its opening words). Set impact to the matching Result field, or "N/A" if absent. "section" is the company/case heading — never a field label like "Key Strategy" or "Result".`;
  const formatC = "FORMAT C — M&A narrative/criteria: apply M&A DOCUMENT MODE above even without strategy headings. Extract only explicitly stated approaches or criteria; never infer a strategy from a capability, benefit, aspiration, or scale fact.";
  const formatD = `FORMAT D — COLLECTION FRAMEWORK. This is a reusable collection operating framework rather than one company's case-study narrative. Use COLLECTION FRAMEWORK MODE above. A numbered policy heading starts one record; examples and bullets remain with that policy. Ignore action-plan-by-function tables and staged framework checklists outside the selected policy sections.`;
  const formatSection = isMnaDoc ? `═══ 4. DOCUMENT FORMAT ═══\n${formatC}` : isCollectionDoc ? `═══ 4. DOCUMENT FORMAT ═══\n${formatD}` : `═══ 4. DOCUMENT FORMATS (learn them before extracting) ═══\n${formatA}${hasKeyStrategyCard ? `\n\n${formatB}` : ""}`;
  return `You are the ingestion engine of YYC's internal advisory knowledge base (Malaysian accounting & advisory firm). Analyse the material below and return ONLY a JSON object, no markdown fences, no commentary.


═══ 1. OUTPUT SHAPE ═══
{
 "strategy_titles": ["<FIRST list the exact title of EVERY key strategy found in this material, in document order — one short string each. This is your checklist: levers below must cover every entry.>"],
 "title": "<use provided title, or better one if empty>",
 "doc_type": "case_study" | "playbook" | "framework" | "notes",
 "industry": "<full descriptive industry, e.g. 'Furniture (trading/retail)'>",
 "industry_main": "<broad category in English, e.g. 'Trading / Retail', 'Services', 'Manufacturing', 'Construction', 'Healthcare', 'Technology', 'Education', 'F&B / Hospitality', 'General'>",
 "industry_sub": "<specific sub-industry in English, e.g. 'Furniture', 'Musical Instruments', 'Skin Cancer Clinics'>",
 "language": "en"${/* [ZH disabled for now] was: | "zh" | "mixed" */ ""},
 "problem_signature": "<one line: the business problem pattern this addresses, in English>",
 "sections": [ { "heading": "<section heading>", "summary_en": "<1-2 sentence English summary>" } ],
 "levers": [ { "lever": "price"|"volume"|"cogs"|"overheads"|"ar_days"|"inventory_days"|"ap_days"|"talent_strategy"|"product_differentiation"|"acquisition_expansion_valuation"${customs.map((l) => `|"${l.id}"`).join("")}|"others", "strategy_name": "<the strategy's title EXACTLY as written in the document; for an untitled but explicit strategy, use a short contiguous phrase copied from its evidence>", "description": "<what the business did or the explicit acquisition criterion, copied EXACTLY from the document — see WORDING RULE>", "impact": "<the actual impact of this strategy, copied EXACTLY from the document — see WORDING RULE; the string "N/A" if the document states no actual impact>", "section": "<EXACT heading from the sections array above that this lever came from>", "other_category": "<ONLY when lever is others: legal_regulatory_ip|business_model_execution|financing_capital|operations_process|partnerships_alliances|shareholder_governance|uncategorized>", "related_to": "<ONLY when lever is others: 3-8 English words naming what it specifically relates to>" } ]
}

═══ 2. SCOPE — WHAT TO EXTRACT AND WHAT TO IGNORE ═══
Extract ONLY the KEY STRATEGIES part of the document. A key strategy is an action or decision the business took (or should take) to grow, protect or fund itself.
IN SCOPE: the strategy sections — lever headings (Pricing, Volume, COGS, Overheads, Inventory, Receivables, Payables, Talent Strategy, Product Differentiation${customs.length ? ", " + customs.map((l) => l.name).join(", ") : ""}…), "Other Strategies Used to Grow the Business", or the "Key Strategy" field of a summary card.
OUT OF SCOPE — never create a record from these, and never list them as strategies:
  • Failed strategies / "Failed Strategies, Problems Encountered & Solutions" / lessons-from-failure sections — EXCLUDE them entirely, even if they contain a "Solution".
  • Background narrative, biography, timeline / chronology, company history, website links, references.
  • Table headers, column labels and template leftovers (e.g. "Differentiation", "What Sweetwater Did", "Strategy", "Actual Impact") — these are NOT strategies; a strategy always has a real title AND a description.
  • Problem statements, formulas/theories, KPIs, metrics, targets, multiples and outcomes standing on their own (see section 3).
Do not add out-of-scope headings to the sections array either.
${mnaRules}${collectionRules}

═══ 3. EVIDENCE = THE DESCRIPTION BENEATH EACH STRATEGY; RESULTS ARE NEVER STRATEGIES ═══
The supporting points for a strategy are its own source text plus any actual-impact statement explicitly attached to it. "Power Cash Link:" explains theory, not impact; never copy it. Do not use evidence from unrelated sections. ${isMnaDoc ? "In M&A mode, the exact supporting sentence(s) may appear anywhere in this material part; copy them verbatim and attach them only to the explicit action/criterion they support." : ""}
A result (an "Actual Impact:", "Power Cash Link:", "Result:", KPI, percentage, ratio, count, valuation, or "financial impact" line) exists only to SUPPORT a key strategy stated above it. It belongs in that strategy's "impact" field, but it can NEVER become a lever record of its own.
Test before writing each record: "Is this something the business DID or DECIDED?" If it is only something that HAPPENED or was MEASURED (e.g. "utilization 98%", "NPS 90%", "21 acquisitions in 3 years", "sales of US$2 million"), it is a result — fold it into the strategy it supports, or drop it. A result with no key strategy to attach to is dropped, not promoted.

═══ 3b. WORDING RULE — strategy_name, description, impact ═══
Each record is shown as **strategy_name**: description, followed by an impact box.
- strategy_name: copy the exact source title, including hints (the one exception is a FORMAT B summary card, which has no title and uses the short title described there). If M&A mode has no title, use only a short contiguous phrase copied from the supporting source text; do not invent a label.
- description: copy the complete original action/criterion wording exactly, excluding only sentences that describe actual results (those belong in impact). Preserve every original word, number, order, and punctuation. Never summarize, paraphrase, shorten, or merge strategies.
- impact: copy only the complete original sentence(s) reporting a realized result. Remove labels such as "Actual Impact:" or "Result:". Never use "Power Cash Link" or theoretical/speculative claims as impact. If no actual outcome is stated, use exactly "N/A". Keep the outcome sentence's subject and original wording.
- Never add facts, combine evidence from different strategies, or change the source wording. Description and impact may be of any length — never shorten them.

${formatSection}

═══ 5. LEVER DEFINITIONS AND HEADING SYNONYMS ═══
Heading → lever: Pricing/Price → price · Sales/Customers/Demand → volume · COGS/Cost of Goods Sold/Margin → cogs · Overhead(s)/Fixed costs → overheads · Receivables/Accounts Receivable/Collections/AR/Credit control/Receivable Days → ar_days · Inventory/Stock → inventory_days · Payables/Accounts Payable/AP/Supplier terms/Payable Days → ap_days · Talent/People/Hiring/Culture → talent_strategy · Product/Brand/Design/Differentiation → product_differentiation · M&A/Acquisition/Expansion/Valuation/Post-Acquisition headings and explicit acquisition strategy or screening criteria → acquisition_expansion_valuation · "Other Strategies (Used to Grow the Business)" or any other key strategy (e.g. Additional Strategies) → others${extraHeadingNote()}

CASH LEVERS (Alan Miltz framework — when the text discusses cash-flow mechanics):
${leverDefLine("price")}
${leverDefLine("volume")}
${leverDefLine("cogs")}
${leverDefLine("overheads")}
${leverDefLine("ar_days")}
${leverDefLine("inventory_days")}
${leverDefLine("ap_days")}

NON-CASH STRATEGIC LEVERS (do NOT force these into cash levers):
${leverDefLine("talent_strategy")}
${leverDefLine("product_differentiation")}
${leverDefLine("acquisition_expansion_valuation")}
- others: any key strategy that fits none of the above — e.g. legal/trademark enforcement, exclusive lease clauses, regulatory response, competitive moats, brand partnerships. A strategy whose clause mentions KPIs it focuses on (rebooking, utilization) stays ONE others record; do not split it into volume records.
  For EVERY "others" record you MUST also set other_category and related_to. Pick the ONE category that fits best:
${otherCatDefs()}
  related_to = 3-8 English words naming what the strategy specifically relates to.
${customBlock}For M&A records, use acquisition_expansion_valuation for acquisition strategy and criteria. Use others only when the strategy is not itself an acquisition/valuation/ownership policy and another category clearly fits (e.g. a standalone shareholder governance or financing policy). Do not duplicate one strategy across lever categories.

═══ 6. EXTRACTION RULES ═══
1. Only extract what the text supports. Do NOT invent. A document may cover zero levers.
2. One record per NAMED key strategy per lever heading. Only a repeat under the SAME heading is a duplicate; the same title under two different lever headings gets a record under each.
3. COVERAGE — walk the in-scope material top to bottom and do not stop early. Every named key strategy under every in-scope heading needs its record, including the LAST in-scope headings (Talent Strategy, Other Strategies). Before answering, compare your levers against strategy_titles: every title must have at least one record, and every in-scope title in the material must be in strategy_titles.
4. Prefer specificity: "Increase price by 5% in FY22" beats "pricing matters".
5. "section" is the HEADING the strategy sits under (e.g. "Overhead", "Talent Strategy", "Other Strategies Used to Grow the Business") — NEVER the strategy's own title — and must exactly match a heading in your sections array. The lever follows that heading STRICTLY (Overhead → overheads, Volume → volume, Pricing → price…), whatever the strategy sounds like: a unique-selling-point, brand-value or community strategy listed under "Pricing" is a price record, not product_differentiation; an influencer or e-commerce strategy under "Volume" is a volume record. Do not re-file a strategy to "others" just because you find it interesting. Use "others" only under Other Strategies or when no lever heading fits.${isMnaDoc ? `
   Exception (M&A mode): use acquisition_expansion_valuation for explicit acquisition strategy and criteria regardless of heading; do not duplicate records.` : ""}
6. Apply the WORDING RULE (section 3b) to every record.
7. strategy_name and description are ALWAYS present.
8. Maximum: 12 sections, 30 lever records for this part (strategy_titles: as many as the material has). Keep section summaries to 1-2 sentences, but NEVER drop or merge named strategies to save space — completeness of records matters more than brevity.${parts > 1 ? `
9. This material is PART ${part} of ${parts} of one document. Extract only what appears in this part; do not invent or repeat content from other parts. Title/industry fields: best reading from this part.` : ""}


PROVIDED TITLE: ${title || "(none)"}

MATERIAL:
${capped}`;
}