// Step 5 of Ask the Brain: turn the AI's tagged answer into what the screen shows. PURE JavaScript (server and browser).
//
// The AI writes the answer and tags each statement with the source it used: [C2] (a passage) or [R3] (a lever record).
// This module, not the AI, builds the references, the "Why this answer" rows, the match %, the closest-document hint for a refusal
// and the warnings, so none of them can be invented.

import { tokenizeQuery, bm25Rank, bestExcerpt } from './text.js';
import { unsupportedFigures } from './verify.js';

const TAG = /\[([CR])(\d{1,2})\]/gi;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/* "Name of the strategy: description" -> a short label for a reference button */
export function claimName(text) {
  const s = String(text || '').trim();
  const i = s.indexOf(': ');
  const name = i > 0 && i <= 120 ? s.slice(0, i) : s.split(/\s+/).slice(0, 7).join(' ');
  return name.length > 52 ? `${name.slice(0, 50)}…` : name;
}

/* Which record does this bullet most likely come from, judging by wording alone? Only a clear winner is accepted. */
function matchByWording(line, records, taken) {
  const words = tokenizeQuery(line);
  if (words.length < 3) return null;
  const scores = records.map((r, i) => {
    const set = new Set(tokenizeQuery(`${r.claim_en || r.claim_zh || ''} ${r.lever || ''}`));
    return { i, hits: taken.has(i) ? 0 : words.filter((w) => set.has(w)).length };
  }).sort((a, b) => b.hits - a.hits);
  const best = scores[0];
  const next = scores[1] ? scores[1].hits : 0;
  return best && best.hits >= 3 && best.hits / words.length >= 0.5 && best.hits >= next + 2 ? records[best.i] : null;
}

/* the chunk text starts with its section heading as a line of its own; the quote shown to the reader should start at the content */
const withoutHeadingLine = (text, heading) => {
  const lines = String(text || '').split('\n');
  return heading && lines.length > 1 && lines[0].trim().toLowerCase() === heading.trim().toLowerCase() ? lines.slice(1).join('\n') : text;
};

const pct = (v) => Math.max(0, Math.min(100, Math.round(v)));

export function finalizeAnswer({ raw, context, question, keywordText = '', docs, docIds = [], mode = 'browser', allChunks = [] }) {
  const terms = tokenizeQuery(`${question} ${keywordText}`);
  const answerable = !!(raw && raw.answerable === true && String(raw.answer || '').trim());
  const topChunk = [...allChunks].sort((a, b) => b.score - a.score)[0] || null;

  // How strong is a match? The server's search scores are rank-fusion values with a known maximum; browser BM25 scores are relative.
  const maxChunk = Math.max(0, ...allChunks.map((c) => c.score || 0));
  const chunkPct = (c) => (mode === 'hybrid' ? pct((100 * (c.score || 0)) / (2 / 61)) : mode === 'keyword' ? pct((100 * (c.score || 0)) / (1 / 61)) : maxChunk > 0 ? pct((100 * (c.score || 0)) / maxChunk) : 0);
  const recs = context.usedRecords;
  const maxRec = Math.max(0, ...recs.map((r) => r._score || 0));
  const recPct = (r) => (maxRec > 0 ? Math.max(1, pct((100 * (r._score || 0)) / maxRec)) : 0);

  if (!answerable) {
    const closest = topChunk && docs.get(topChunk.doc_id)
      ? { doc_id: topChunk.doc_id, doc_title: docs.get(topChunk.doc_id).title, section: topChunk.heading || '', relevance: null }
      : null;
    return { answerable: false, text: '', citations: [], evidence: [], closest, unsupportedFigures: [], uncited: false };
  }

  // 1. clean the text: literal \n, leaked document ids
  const idAlt = docIds.map((d) => String(d).replace(/[^a-zA-Z0-9_-]/g, '')).filter(Boolean).join('|');
  let text = String(raw.answer).replace(/\\r\\n|\\n/g, '\n');
  if (idAlt) text = text.replace(new RegExp(`\\s*[\\[(](?:doc_id\\s*[=:]\\s*)?(?:${idAlt})[\\])]`, 'g'), '');

  // 2. read the tags line by line; link untagged bullets to a record by wording
  const cited = []; // in order of first appearance: { kind: 'record' | 'passage', item }
  const seen = new Set();
  const take = (kind, tag, item) => { const key = `${kind}:${tag}`; if (!seen.has(key)) { seen.add(key); cited.push({ kind, item }); } };
  const takenRecords = new Set();
  const lines = text.split('\n').map((line) => {
    const found = [...line.matchAll(TAG)].map((m) => ({ kind: m[1].toUpperCase(), tag: `${m[1].toUpperCase()}${m[2]}` }));
    let any = false;
    for (const f of found) {
      if (f.kind === 'R' && context.recordTags.has(f.tag)) { take('record', f.tag, context.recordTags.get(f.tag)); takenRecords.add(recs.indexOf(context.recordTags.get(f.tag))); any = true; }
      else if (f.kind === 'C' && context.chunkTags.has(f.tag)) { take('passage', f.tag, context.chunkTags.get(f.tag)); any = true; }
    }
    const clean = line.replace(TAG, '').replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]+$/g, '');
    if (!any && BULLET.test(line) && recs.length) {
      const r = matchByWording(clean, recs, takenRecords);
      if (r) { const tag = `R${recs.indexOf(r) + 1}`; take('record', tag, r); takenRecords.add(recs.indexOf(r)); }
    }
    return clean;
  });
  text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // 3. references and evidence from the sources that were actually cited
  let uncited = false;
  let sources = cited;
  if (!sources.length && (context.usedChunks.length || recs.length)) {
    // the AI forgot every tag: work out which of the sources it was given match what it WROTE (not just what the search ranked first), and say so
    uncited = true;
    const candidates = [
      ...context.usedChunks.map((item) => ({ kind: 'passage', item, text: `${item.heading} ${item.text}` })),
      ...recs.map((item) => ({ kind: 'record', item, text: `${item.claim_en || item.claim_zh || ''} ${item.lever}` })),
    ];
    const hits = bm25Rank(text, candidates, (c) => c.text);
    const best = hits.length ? hits[0].score : 0;
    sources = hits.filter((h) => h.score >= best * 0.5).slice(0, 3).map((h) => ({ kind: h.item.kind, item: h.item.item }));
    if (!sources.length && allChunks.length) sources = [{ kind: 'passage', item: [...allChunks].sort((a, b) => b.score - a.score)[0] }];
  }
  const citations = [];
  const evidence = [];
  const dedupe = new Set();
  for (const { kind, item } of sources) {
    const meta = docs.get(item.doc_id);
    if (!meta) continue;
    if (kind === 'record') {
      if (dedupe.has(`r:${item.id}`)) continue;
      dedupe.add(`r:${item.id}`);
      citations.push({ doc_id: item.doc_id, doc_title: meta.title, section: item.section || '', record_id: item.id, claim: claimName(item.claim_en || item.claim_zh) });
      evidence.push({ doc_id: item.doc_id, doc_title: meta.title, section: item.section || '', record_id: item.id, passage: bestExcerpt(item.claim_en || item.claim_zh || '', terms, 220), relevance: recPct(item) });
    } else {
      const key = `p:${item.doc_id}:${item.heading}`;
      if (!dedupe.has(key)) { dedupe.add(key); citations.push({ doc_id: item.doc_id, doc_title: meta.title, section: item.heading || '' }); }
      evidence.push({ doc_id: item.doc_id, doc_title: meta.title, section: item.heading || '', passage: bestExcerpt(withoutHeadingLine(item.text, item.heading), terms, 240), relevance: chunkPct(item) });
    }
  }

  // a lever record is a more exact reference than a passage from the same section: do not show both
  const recordSections = new Set(citations.filter((c) => c.record_id).map((c) => `${c.doc_id}:${c.section}`));
  const distinctCitations = citations.filter((c) => c.record_id || !recordSections.has(`${c.doc_id}:${c.section}`));

  // 4. numbers in the answer that appear nowhere in what the AI was given
  const sourceText = `${context.sourcesBlock}\n${context.recordsBlock}`;
  return { answerable: true, text, citations: distinctCitations, evidence: evidence.slice(0, 10), closest: null, unsupportedFigures: unsupportedFigures(text, sourceText, question), uncited };
}
