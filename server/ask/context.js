// Step 3 of Ask the Brain: turn what was retrieved into the text the AI reads, and remember which tag ([C1], [R2]...) means which
// source, so the answer's citations can be built in code instead of trusting the AI to quote its sources correctly.
// PURE JavaScript (server and browser).

import { bm25Rank } from './text.js';

export const CONTEXT_BUDGET = 11000;  // characters of sources + records sent with a question (the AI's per-minute token limit is the reason)
const RECORDS_BUDGET = 4500;          // of which at most this much for lever records
const trimTo = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s || ''));

/* Lever records most related to the question. They are short, curated claims, so a few of them carry a lot of signal. */
export function rankRecords({ question, keywordText, records, titleOf, limit, lever = null, diverse = false }) {
  let pool = (records || []).filter((r) => titleOf(r.doc_id));
  // "10 volume strategies" asks for records of ONE lever: only those, even if some do not use the word in their text
  const inLever = lever ? pool.filter((r) => r.lever === lever) : [];
  if (inLever.length) pool = inLever;
  let ranked = bm25Rank(question, pool, (r) => [r.lever, r.other_category, r.claim_en, r.claim_zh, r.quote, r.impact, r.section, titleOf(r.doc_id)].filter(Boolean).join(' '), keywordText);
  if (inLever.length) { // top up with the rest of the lever so a request for N can reach N
    const have = new Set(ranked.map((x) => x.item.id));
    ranked = [...ranked, ...pool.filter((r) => !have.has(r.id)).map((item) => ({ item, score: 0.0001 }))];
  }
  if (diverse) { // a list should show different companies: at most 2 per document first, then fill up
    const perDoc = new Map();
    const first = [];
    const rest = [];
    for (const x of ranked) {
      const n = perDoc.get(x.item.doc_id) || 0;
      if (n < 2) { perDoc.set(x.item.doc_id, n + 1); first.push(x); } else rest.push(x);
    }
    ranked = [...first, ...rest];
  }
  return ranked.slice(0, limit).map(({ item, score }) => ({ ...item, _score: score }));
}

const impactText = (r) => {
  const t = String(r.impact || r.quote || '').replace(/^\s*(actual\s+impacts?|impact|results?)\s*[:：-]\s*/i, '').trim();
  return t && t.toUpperCase() !== 'N/A' ? t : '';
};

/* chunks: [{doc_id,pos,heading,text,score}] best first.  docs: Map id -> {title,doc_type,industry,sections}.  records: ranked lever records.
   -> { sourcesBlock, recordsBlock, chunkTags: Map('C1' -> chunk), recordTags: Map('R1' -> record), usedChunks, usedRecords } */
export function buildContext({ chunks, docs, records, budget = CONTEXT_BUDGET }) {
  const recordTags = new Map();
  let recordsBlock = '';
  for (const r of records || []) {
    const meta = docs.get(r.doc_id);
    const tag = `R${recordTags.size + 1}`;
    const impact = impactText(r);
    const line = `[${tag}] (source: ${meta ? meta.title : r.doc_title || 'Unknown'}; lever: ${r.lever}${r.other_category ? `/${r.other_category}` : ''}) ${trimTo(r.claim_en || r.claim_zh || r.quote, 700)}${impact ? ` (Actual impact: ${trimTo(impact, 250)})` : ''}`;
    if (recordsBlock.length + line.length + 1 > RECORDS_BUDGET) break;
    recordsBlock += (recordsBlock ? '\n' : '') + line;
    recordTags.set(tag, r);
  }

  // documents in the order of their best chunk; inside a document the chunks read in document order
  const byDoc = new Map();
  for (const c of chunks || []) byDoc.set(c.doc_id, [...(byDoc.get(c.doc_id) || []), c]);
  let room = budget - recordsBlock.length;
  const chunkTags = new Map();
  const blocks = [];
  for (const [docId, list] of byDoc) {
    const meta = docs.get(docId);
    if (!meta) continue;
    const sections = (meta.sections || []).slice(0, 6).map((s) => `  - ${s.heading}: ${trimTo(s.summary_en, 160)}`).join('\n');
    const header = `### SOURCE: ${meta.title} (${meta.doc_type || 'document'}${meta.industry ? `, ${meta.industry}` : ''})${sections ? `\nSections:\n${sections}` : ''}`;
    const lines = [];
    let cost = header.length + 8;
    for (const c of [...list].sort((a, b) => a.pos - b.pos)) {
      const tag = `C${chunkTags.size + lines.length + 1}`;
      const line = `[${tag}] (section: ${c.heading || 'n/a'}) ${c.text}`;
      if (cost + line.length + 1 > room) break;
      lines.push({ tag, line, chunk: c });
      cost += line.length + 1;
    }
    if (!lines.length) continue;
    lines.forEach((l) => chunkTags.set(l.tag, l.chunk));
    room -= cost;
    blocks.push(`${header}\n${lines.map((l) => l.line).join('\n')}`);
  }
  return { sourcesBlock: blocks.join('\n\n'), recordsBlock, chunkTags, recordTags, usedChunks: [...chunkTags.values()], usedRecords: [...recordTags.values()] };
}
