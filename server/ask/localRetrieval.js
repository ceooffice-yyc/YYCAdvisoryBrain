// Retrieval that needs no search index: cut the documents into chunks in memory and rank them with BM25 (+ the AI's keywords).
// PURE JavaScript. Used (1) by the browser in the no-database local mode, (2) by the server as the fallback when the Supabase search
// index is not set up or is down, and (3) by the evaluation script. Same output shape as the server's indexed search.

import { chunkDocument } from '../chunking.js';
import { bm25Rank } from './text.js';

const PER_DOC = 3;
const TOTAL = 12;

export const docMeta = (d) => ({
  id: d.id, title: d.title, doc_type: d.doc_type, industry: d.industry,
  sections: (Array.isArray(d.sections) ? d.sections : []).slice(0, 6).map((s) => ({ heading: s.heading, summary_en: String(s.summary_en || '').slice(0, 160) })),
});

/* Pick the best chunks: at most PER_DOC per document, TOTAL overall. */
export function pickChunks(ranked, { perDoc = PER_DOC, total = TOTAL } = {}) {
  const count = new Map();
  const out = [];
  for (const { item, score } of ranked) {
    if (out.length >= total) break;
    const n = count.get(item.doc_id) || 0;
    if (n >= perDoc) continue;
    count.set(item.doc_id, n + 1);
    out.push({ doc_id: item.doc_id, pos: item.pos, heading: item.heading, text: item.text, score });
  }
  return out;
}

/* loadDocuments: async () -> all active documents (with full_text). Documents and their chunks are kept for `ttlMs` between questions. */
export function makeLocalRetriever(loadDocuments, { ttlMs = 30000, now = Date.now } = {}) {
  let cache = null;
  const load = async () => {
    if (cache && now() - cache.at < ttlMs) return cache;
    const docs = await loadDocuments();
    cache = { at: now(), docs, byId: new Map(docs.map((d) => [d.id, d])), chunks: docs.flatMap((d) => chunkDocument(d)) };
    return cache;
  };
  const forget = () => { cache = null; };

  async function retrieve({ question, keywords = [], taggedIds = [] }) {
    const { byId, chunks } = await load();
    const kwText = keywords.join(' ');
    const ranked = bm25Rank(question, chunks, (c) => `${c.title} ${c.industry || ''} ${c.heading} ${c.text}`, kwText);
    const picked = pickChunks(ranked);
    // documents the person tagged with @ come first, represented by their best chunks
    const forced = [];
    for (const id of taggedIds) {
      if (!byId.has(id)) continue;
      const own = bm25Rank(question, chunks.filter((c) => c.doc_id === id), (c) => `${c.heading} ${c.text}`, kwText);
      const top = pickChunks(own.length ? own : chunks.filter((c) => c.doc_id === id).slice(0, PER_DOC).map((item) => ({ item, score: 0 })));
      const best = picked.length ? Math.max(...picked.map((c) => c.score)) : 1;
      forced.push(...top.map((c) => ({ ...c, score: Math.max(c.score, best) })));
    }
    const all = [...forced, ...picked.filter((c) => !forced.some((f) => f.doc_id === c.doc_id && f.pos === c.pos))];
    const docIds = [...new Set(all.map((c) => c.doc_id))];
    return { chunks: all, docs: docIds.map((id) => docMeta(byId.get(id))), mode: 'browser' };
  }
  return { retrieve, forget };
}
