// Builds (or rebuilds) the Ask the Brain search index for the documents already in the library.
//
//   npm run reindex                 every active document
//   npm run reindex -- --missing    only documents with no chunks yet, or chunks that have no embedding
//   npm run reindex -- --only ID    one document
//   npm run reindex -- --check      just test that GEMINI_API_KEY works (embeds one sentence, writes nothing)
//
// Needs the same .env as the server: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and (for meaning-based search) GEMINI_API_KEY.
// Run supabase/schema.sql in Supabase first (it creates the doc_chunks table and the search function). Safe to run again.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { reindexDoc } from '../server/indexing.js';
import { embedTexts, embeddingsConfigured, EMBEDDING_DIMS, EMBEDDING_MODEL } from '../server/embeddings.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (flag('--check')) {
  if (!embeddingsConfigured()) { console.error('GEMINI_API_KEY is not set in .env'); process.exit(1); }
  try {
    const [v] = await embedTexts(['Avoid 50:50 ownership to prevent a deadlock'], { taskType: 'RETRIEVAL_DOCUMENT' });
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    console.log(`OK: ${EMBEDDING_MODEL} returned a ${v.length}-dimension vector (expected ${EMBEDDING_DIMS}), length ${norm.toFixed(4)}.`);
    process.exit(v.length === EMBEDDING_DIMS ? 0 : 1);
  } catch (e) {
    console.error('Embedding test failed:', e.message);
    process.exit(1);
  }
}

const url = String(process.env.SUPABASE_URL || '').trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const withEmbeddings = embeddingsConfigured();
if (!withEmbeddings) console.warn('GEMINI_API_KEY is not set: chunks will be stored for keyword search only (run again later once it is set).');

const PAGE = 1000;
async function selectAll(build, what) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${what} failed: ${error.message}`);
    out.push(...data);
    if (data.length < PAGE) return out;
  }
}

let docs = await selectAll((a, b) => sb.from('documents').select('id,title,industry,sections,full_text').eq('status', 'active').order('created').order('id').range(a, b), 'read documents');
if (only) docs = docs.filter((d) => d.id === only);

if (flag('--missing')) {
  const rows = await selectAll((a, b) => sb.from('doc_chunks').select('doc_id,embedding_model').order('id').range(a, b), 'read chunks');
  const seen = new Set(rows.map((r) => r.doc_id));
  const unembedded = new Set(rows.filter((r) => !r.embedding_model).map((r) => r.doc_id));
  docs = docs.filter((d) => !seen.has(d.id) || (withEmbeddings && unembedded.has(d.id)));
}

console.log(`${docs.length} document(s) to index${withEmbeddings ? ' (with embeddings)' : ' (keyword only)'}.`);
let failed = 0;
let totalChunks = 0;
for (const [i, d] of docs.entries()) {
  try {
    const out = await reindexDoc(sb, process.env, d);
    totalChunks += out.chunks;
    console.log(`[${i + 1}/${docs.length}] ${d.title}: ${out.chunks} chunks, ${out.embedded} embedded${out.embedError ? `  (embedding failed: ${out.embedError})` : ''}`);
    if (out.embedError) failed++;
  } catch (e) {
    failed++;
    console.error(`[${i + 1}/${docs.length}] ${d.title}: FAILED - ${e.message}`);
  }
  if (withEmbeddings && i < docs.length - 1) await sleep(700); // stays under the free-tier 100 requests/minute
}
console.log(`Done: ${docs.length - failed} ok, ${failed} with problems, ${totalChunks} chunks written.`);
process.exit(failed ? 1 : 0);
