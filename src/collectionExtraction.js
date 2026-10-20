// Reads a numbered collection / receivables playbook with plain code (no AI), taking section names from the Word headings, else the numbering, and turns each section into ar_days records.

const TOPICS = [
  { re: /collection|receivables?|debt recovery|credit control/i, lever: "ar_days", industry: "Professional Services", industry_main: "Services", industry_sub: "Professional Services", problem_signature: "Collection performance, billing, and debt recovery", fallbackTitle: "AR Collection Framework", docType: "framework" },
];

// Labels that must stay as they were when these records were first saved (so re-reading an older version gives the same labels).
const LABELS = [{ re: /^Management Approach to Collection Performance\b/i, name: "Management Approach to Collection Performance" }];
const INTERNAL_WAR = /^Win the Internal War First\b/i;
// Well-known headings of the YYC playbook: used only when the Word headings are not available (plain-text paste).
const KNOWN_HEADINGS = [
  /^Core Collection Mindset\b/i, /^Management Approach to Collection Performance\b/i, INTERNAL_WAR, /^Current Collection Strategies Identified in YYC\b/i,
  /^Telephone Collection skills\b/i, /^Opening a Collection Call\b/i, /^Dealing with Difficult Customers by Telephone\b/i, /^Collection Persuasion Skills\b/i,
  /^Barriers to Successful Persuasion\b/i, /^Strategies to Reduce Debt\b/i, /^Burning Issues in Debt Recovery\b/i, /^Different Types of Difficult Customers\b/i,
  /^Profiling Debtors\b/i, /^Handling Difficult Customers\b/i, /^Focus on Large Customers\b/i, /^Common Client Objections and Suggested Responses\b/i,
  /^Negotiation Tactics\b/i, /^Debt Planning and Measurement\b/i, /^Action Plan by Function\b/i, /^Recommended YYC Collection Excellence Framework\b/i,
];
const TABLE_HINTS = [/^Profiling Debtors\b/i];

const NESTED_ITEM = /^\s*(\d+(?:\.\d+)+)\s+(.+)$/;
const SIMPLE_ITEM = /^\s*(\d+)[.)]\s+(.+)$/;
const STAGE_LINE = /^(?:Stage|Step|Phase)\s+(\d+)\s*[:：-]\s*(.+)$/i;
const OUTCOME = /One team shared that billing earlier significantly improved collections\./i;

const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
// a sentence or list line ends with . ! ? or : (possibly followed by a closing quote or bracket); a heading does not
const endsSentence = (s) => /[.!?:][”"’')\]]*$/.test(String(s || "").trim());
const norm = (s) => String(s || "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const decode = (s) => String(s).replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
const plain = (h) => decode(String(h).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function isNumberedItem(para) {
  const nested = para.match(NESTED_ITEM);
  if (nested) return [nested[0], nested[1], nested[2]];
  const simple = para.match(SIMPLE_ITEM);
  const heading = simple && simple[2].length <= 120 && wc(simple[2]) <= 14 && !endsSentence(simple[2]);
  return heading ? [simple[0], `${simple[1]}.`, simple[2]] : null;
}

/** Is this a collection / receivables document written as a numbered outline? (the check that sends it down the code-only path) */
export function detectOutlineDocument(text, title = "") {
  const t = String(text || "");
  if (!TOPICS.some((x) => x.re.test(`${title} ${t.slice(0, 900)}`))) return false;
  if (/Power Cash (Links?|Strategy)|^\s*Analysis\s*$/im.test(t.slice(0, 18000))) return false; // a case study with an Analysis part is read by the AI path
  const items = t.match(/^\s*\d+\.\d+\s+\S/gm) || [];
  return items.length >= 8 && new Set(items.map((s) => s.trim().split(".")[0])).size >= 3;
}

/** Headings and tables from the Word file's html (mammoth). */
function readOutline(html) {
  const headings = new Set();
  const tables = new Map(); // normalised heading -> number of columns
  let current = "";
  for (const m of String(html || "").matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>|<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    if (m[1] !== undefined) {
      current = plain(m[1]);
      if (current && !isNumberedItem(current)) headings.add(norm(current));
    } else if (current) {
      const firstRow = (m[2].match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i) || [])[1] || "";
      const cols = (firstRow.match(/<t[dh]\b/gi) || []).length;
      if (cols) tables.set(norm(current), cols);
    }
  }
  return { headings, tables };
}

/** Without Word headings: the line just before a numbered group's first item is that group's heading. */
function inferHeadingsFromNumbering(paras) {
  const found = new Set();
  const seenGroups = new Set();
  paras.forEach((p, j) => {
    const nested = p.match(NESTED_ITEM);
    if (!nested) return;
    const group = nested[1].split(".")[0];
    if (seenGroups.has(group)) return;
    seenGroups.add(group);
    for (let h = j - 1; h >= Math.max(0, j - 4); h--) {
      const q = paras[h];
      if (isNumberedItem(q) || endsSentence(q) || wc(q) > 14) continue; // an introduction sentence or a list line: keep looking back
      found.add(h);
      break;
    }
  });
  return found;
}

function formatDescription(lines) {
  let inList = false;
  return lines.map((line) => {
    const text = String(line || "").trim();
    if (!text) return "";
    if (/^(?:Client|YYC)\s*[:：]/.test(text)) return text; // a line of dialogue stays a plain line, never a bullet
    if (/:\s*$/.test(text)) { inList = true; return text; }
    if (inList && wc(text) <= 14) return `• ${text.replace(/^[•*-]\s*/, "")}`;
    inList = false;
    return text;
  }).filter(Boolean).join("\n");
}

// A table arrives as one cell per paragraph: a caption (0-2 lines), the column headers, then the rows.
function tableDescription(lines, cols) {
  const all = lines.map((l) => String(l || "").trim()).filter(Boolean);
  const captionLen = all.length % cols;
  const caption = all.slice(0, captionLen).join(" ");
  const cells = all.slice(captionLen);
  if (cols >= 2 && cells.length >= 2 * cols) {
    const row = (i) => { const r = cells.slice(i, i + cols); return `${r.slice(0, -1).join(" — ")} → ${r[r.length - 1]}`; };
    const rows = [];
    for (let i = cols; i < cells.length; i += cols) rows.push(`• ${row(i)}`);
    return [`${caption ? `${caption} ` : ""}(${row(0)}):`, ...rows].join("\n");
  }
  return formatDescription(all);
}

function normalizeHeadingTitle(raw) {
  return String(raw || "")
    .replace(/^\s*\d+(?:\.\d+)*\s*[.)]?\s*/, "")
    .replace(/^[A-Z]{2,5}\s*[—–-]\s*/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

/** Does this stretch of paragraphs start with an introduction that contains a list ("...through:" followed by short lines)? */
function introHasList(lines) {
  const i = lines.findIndex((l) => /:\s*$/.test(String(l).trim()));
  return i >= 0 && lines.slice(i + 1).filter((l) => wc(l) <= 14).length >= 2;
}

// Reads the playbook with plain code: pass the Word html if you have it (real headings and table shapes), and anything that did not become a record comes back as a notice.
export function extractCollectionFrameworkRecords(source, title = "", html = "") {
  const paras = String(source || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const topic = TOPICS.find((x) => x.re.test(`${title} ${String(source || "").slice(0, 900)}`)) || TOPICS[0];
  const outline = readOutline(html);
  const useWordHeadings = outline.headings.size >= 3;

  // ── pass 1: where do the sections start? ──
  const inferred = useWordHeadings ? new Set() : inferHeadingsFromNumbering(paras);
  const starts = [];
  paras.forEach((p, i) => {
    // "5. Telephone skills" is a section heading (not an item) when its own "5.1 ..." items follow it
    const simple = p.match(SIMPLE_ITEM);
    const parentOfItems = !!simple && paras.slice(i + 1, i + 4).some((q) => ((q.match(NESTED_ITEM) || [])[1] || "").startsWith(`${simple[1]}.`));
    if (isNumberedItem(p) && !parentOfItems) return;
    const wordHeading = useWordHeadings && i > 0 && outline.headings.has(norm(p)); // paragraph 0 is the document title, never a section
    if (wordHeading || inferred.has(i) || KNOWN_HEADINGS.some((re) => re.test(p))) starts.push(i);
  });

  const records = [];
  const sectionHeadings = [];
  const consumed = new Set(); // paragraphs that ended up in a record (or are a heading)
  let numberedFound = 0;
  let numberedUsed = 0;

  // ── pass 2: turn each section into records ──
  starts.forEach((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : paras.length;
    const heading = paras[start];
    const label = (LABELS.find((l) => l.re.test(heading)) || {}).name || heading;
    if (!sectionHeadings.includes(label)) sectionHeadings.push(label);
    consumed.add(start);
    const body = paras.slice(start + 1, end).map((text, o) => ({ text, index: start + 1 + o }));
    const hasItems = body.some((b) => isNumberedItem(b.text));
    const kind = INTERNAL_WAR.test(heading) ? "internal"
      : (outline.tables.has(norm(heading)) || TABLE_HINTS.some((re) => re.test(heading))) ? "table"
      : hasItems ? "numbered"
      : body.filter((b) => STAGE_LINE.test(b.text)).length >= 2 ? "stages"
      : "single";

    let current = null;
    const flush = () => {
      if (!current) return;
      let impact = "N/A";
      // Word drops its soft line breaks, so a dialogue arrives as one glued line ("...tight.”YYC: ..."); put each speaker back on their own line
      const lines = current.lines.map((l) => l.text).flatMap((line) => {
        const found = String(line).match(OUTCOME);
        if (found) { impact = found[0]; const rest = String(line).replace(OUTCOME, "").trim(); return rest ? [rest] : []; }
        return [line];
      }).flatMap((line) => String(line).replace(/([.!?”"’])((?:Client|YYC)\s*[:：])/g, "$1\n$2").split("\n"));
      const description = current.table ? tableDescription(lines, outline.tables.get(norm(heading)) || 3)
        : current.bullets ? lines.map((l) => `• ${String(l).trim().replace(/^[•*-]\s*/, "")}`).join("\n")
        : formatDescription(lines);
      if (current.name && description) {
        records.push({ lever: topic.lever, claim_en: `${current.name}: ${description}`, impact, section: label });
        current.lines.forEach((l) => consumed.add(l.index));
        if (current.numbered) numberedUsed++;
      }
      current = null;
    };

    if (kind === "internal") {
      let capture = false;
      current = { name: label, lines: [] };
      for (const b of body) {
        if (/^The internal war is won when:\s*$/i.test(b.text)) { capture = true; current.lines.push(b); }
        else if (capture) current.lines.push(b);
      }
      flush();
      return;
    }
    if (kind === "single") { current = { name: normalizeHeadingTitle(heading), lines: body }; flush(); return; }
    if (kind === "table") { current = { name: normalizeHeadingTitle(heading), lines: body, table: true }; flush(); return; }

    // numbered / stages: walk the section
    const intro = [];
    for (const b of body) {
      const item = isNumberedItem(b.text);
      if (item) {
        numberedFound++;
        if (!current && intro.length && introHasList(intro.map((x) => x.text))) { current = { name: normalizeHeadingTitle(heading), lines: intro.splice(0) }; }
        flush();
        current = { name: normalizeHeadingTitle(`${item[1]} ${item[2]}`), lines: [], numbered: true };
        consumed.add(b.index);
        continue;
      }
      const stage = kind === "stages" ? b.text.match(STAGE_LINE) : null;
      if (stage) { flush(); current = { name: `Stage ${stage[1]} - ${stage[2].trim()}`, lines: [], bullets: true }; consumed.add(b.index); continue; }
      if (current) current.lines.push(b);
      else intro.push(b);
    }
    flush();
  });

  // ── what did NOT become a record ──
  const notices = [];
  if (numberedFound !== numberedUsed) notices.push({ level: "warn", text: `${numberedFound - numberedUsed} numbered item(s) in the document did not become a record because they have no text under them.` });
  const left = paras.map((text, index) => ({ text, index })).filter((p) => p.index >= (starts[0] ?? paras.length) && !consumed.has(p.index) && !starts.includes(p.index));
  if (left.length) {
    const sample = left.slice(0, 4).map((p) => `“${p.text.replace(/\s+/g, " ").slice(0, 70)}${p.text.length > 70 ? "…" : ""}”`).join(", ");
    notices.push({ level: "info", text: `${left.length} paragraph(s) were not turned into records (for example ${sample}). They are introductions or explanations and stay in the saved document, so Ask the Brain can still use them.` });
  }
  if (!starts.length) notices.push({ level: "warn", text: "No sections were recognised in this document." });
  if (!useWordHeadings && starts.length) notices.unshift({ level: "info", text: "No Word heading styles were found (the text was pasted or uploaded without them), so sections were found from the numbering. If a section without numbered items looks merged into the record above it, upload the .docx file instead." });

  return {
    title: title || topic.fallbackTitle,
    doc_type: topic.docType,
    industry: topic.industry,
    industry_main: topic.industry_main,
    industry_sub: topic.industry_sub,
    language: "en",
    problem_signature: topic.problem_signature,
    sections: sectionHeadings.map((heading) => ({ heading, summary_en: "", summary_zh: "" })),
    levers: records,
    notices,
  };
}
