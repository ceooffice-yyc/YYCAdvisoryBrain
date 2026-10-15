// The "Ask the Brain" search index: documents cut into chunks (server/chunking.js), embedded (server/embeddings.js) and stored in
// public.doc_chunks (supabase/schema.sql). Used when a document is saved, by `npm run reindex`, and by the `search` operation.
//
// Embeddings are optional: without GEMINI_API_KEY, or if Gemini is unreachable, chunks are still stored and searched by keyword.

import { chunkDocument } from './chunking.js';
import { embedTexts, embeddingsConfigured, chunkEmbeddingText, EMBEDDING_MODEL } from './embeddings.js';

const INSERT_BATCH = 100;
const must = (res, what) => { if (res.error) throw new Error(`Supabase ${what} failed: ${res.error.message || res.error}`); return res.data; };

/* Rebuild one document's chunks. `doc` needs id, title, industry, sections and full_text. The new chunks are prepared (and embedded)
   BEFORE the old ones are removed, so a failure while embedding never leaves a document without an index. */
export async function reindexDoc(sb, env, doc) {
  const parts = chunkDocument(doc);
  let vectors = [];
  let embedError = null;
  if (parts.length && embeddingsConfigured(env)) {
    try {
      vectors = await embedTexts(parts.map(chunkEmbeddingText), { taskType: 'RETRIEVAL_DOCUMENT', env });
    } catch (e) {
      embedError = e.message;
      vectors = [];
    }
  }
  must(await sb.from('doc_chunks').delete().eq('doc_id', doc.id), 'clear chunks');
  const rows = parts.map((p, i) => ({
    doc_id: doc.id, pos: p.pos, heading: p.heading || '', content: p.text,
    embedding: vectors[i] ? JSON.stringify(vectors[i]) : null,
    embedding_model: vectors[i] ? EMBEDDING_MODEL : null,
  }));
  for (let i = 0; i < rows.length; i += INSERT_BATCH) must(await sb.from('doc_chunks').insert(rows.slice(i, i + INSERT_BATCH)), 'write chunks');
  return { chunks: rows.length, embedded: vectors.length, embedError };
}

export async function deleteDocChunks(sb, docId) {
  must(await sb.from('doc_chunks').delete().eq('doc_id', docId), 'clear chunks');
}

/* Saving a document must never fail because its search index could not be built: log it and carry on.
   `npm run reindex` repairs anything that was missed. */
export async function reindexDocSafe(sb, env, doc) {
  try {
    const out = await reindexDoc(sb, env, doc);
    if (out.embedError) console.error(`indexing ${doc.id}: chunks stored without embeddings (${out.embedError})`);
    return out;
  } catch (e) {
    console.error(`indexing ${doc.id} failed:`, e.message);
    return { chunks: 0, embedded: 0, embedError: e.message, failed: true };
  }
}

/* Words for the keyword half of the search. The database joins them with OR, so a chunk needs only some of them. */
export function keywordQuery(question, keywords) {
  const words = `${question} ${(keywords || []).join(' ')}`.toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  return [...new Set(words)].slice(0, 40).join(' or ');
}

/* Best chunks for a question: keyword + meaning when embeddings work, keyword only otherwise. */
export async function searchChunks(sb, env, question, keywords, { count = 12, perDoc = 3 } = {}) {
  let vector = null;
  if (embeddingsConfigured(env)) {
    try { [vector] = await embedTexts([question], { taskType: 'RETRIEVAL_QUERY', env }); }
    catch (e) { console.error('query embedding failed, using keyword search only:', e.message); }
  }
  const rows = must(await sb.rpc('search_chunks', {
    query_text: keywordQuery(question, keywords),
    query_embedding: vector ? JSON.stringify(vector) : null,
    match_count: count,
    per_doc: perDoc,
  }), 'search chunks');
  const chunks = (rows || []).map((r) => ({ doc_id: r.doc_id, pos: r.pos, heading: r.heading || '', text: r.content, score: Number(r.score) || 0 }));
  const ids = [...new Set(chunks.map((c) => c.doc_id))];
  const docs = ids.length
    ? must(await sb.from('documents').select('id,title,doc_type,industry,sections').in('id', ids).eq('status', 'active'), 'read documents')
        .map((d) => ({ ...d, sections: (Array.isArray(d.sections) ? d.sections : []).slice(0, 6).map((s) => ({ heading: s.heading, summary_en: String(s.summary_en || '').slice(0, 160) })) }))
    : [];
  return { chunks, docs, mode: vector ? 'hybrid' : 'keyword' };
}
