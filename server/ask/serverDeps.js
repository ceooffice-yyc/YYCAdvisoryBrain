// Connects the Ask the Brain pipeline (server/ask/pipeline.js) to the hosted data: Supabase for documents, lever records and the
// search index. Retrieval first asks the index (keyword + meaning). If the index is missing, empty or failing it quietly falls back to
// searching the documents in memory, so Ask the Brain keeps working while the index is being set up or repaired.

import { getLibrarySnapshot, loadDocsForSearch } from '../db.js';
import { searchChunks } from '../indexing.js';
import { makeLocalRetriever } from './localRetrieval.js';

let fallback = null; // documents + chunks kept in memory between questions (a minute)
const fallbackRetriever = (sb) => (fallback ||= makeLocalRetriever(() => loadDocsForSearch(sb), { ttlMs: 60_000 }));

/* sb: the Supabase service client. Returns the `deps` object runAsk() expects. */
export function makeServerDeps(sb, env, llm, { log = console.error } = {}) {
  async function retrieve({ question, keywords, taggedIds }) {
    let found = null;
    try {
      found = await searchChunks(sb, env, question, keywords);
    } catch (e) {
      log('indexed search failed, using the in-memory fallback:', e.message);
    }
    if (!found || !found.chunks.length) return fallbackRetriever(sb).retrieve({ question, keywords, taggedIds });

    if (taggedIds.length) { // documents tagged with @ come first, represented by their best chunks
      const tagged = await makeLocalRetriever(() => loadDocsForSearch(sb, taggedIds), { ttlMs: 0 }).retrieve({ question, keywords, taggedIds });
      const top = found.mode === 'hybrid' ? 2 / 61 : 1 / 61; // the best possible score in this search mode
      const forced = tagged.chunks.filter((c) => taggedIds.includes(c.doc_id)).map((c) => ({ ...c, score: top }));
      const have = new Set(forced.map((c) => `${c.doc_id}#${c.pos}`));
      found = {
        ...found,
        chunks: [...forced, ...found.chunks.filter((c) => !have.has(`${c.doc_id}#${c.pos}`))],
        docs: [...tagged.docs.filter((d) => taggedIds.includes(d.id)), ...found.docs.filter((d) => !taggedIds.includes(d.id))],
      };
    }
    return found;
  }

  return {
    llm,
    retrieve,
    records: async () => (await getLibrarySnapshot(sb)).records,
    docIndex: async () => (await getLibrarySnapshot(sb)).index,
  };
}
