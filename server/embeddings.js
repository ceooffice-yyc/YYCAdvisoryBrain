/* global process */
// Text -> vector, using Google's gemini-embedding-001 (Gemini API). Server only: the key never reaches the browser.
//
//   GEMINI_API_KEY   from https://aistudio.google.com/apikey  (use a key with billing enabled for the company library: see README)
//
// Vectors are cut to EMBEDDING_DIMS (768) and normalised here, as Google requires for any size other than the default 3072.
// If you ever change the model or the size: change EMBEDDING_DIMS, the vector(768) columns in supabase/schema.sql, then re-run `npm run reindex`.

export const EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMS = 768;

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const BATCH = 50;      // texts per request
const MAX_TRIES = 4;

export const embeddingsConfigured = (env = process.env) => !!String(env.GEMINI_API_KEY || '').trim();

class EmbeddingError extends Error { constructor(message, status) { super(message); this.status = status; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function normalise(values) {
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0)) || 1;
  return values.map((v) => v / norm);
}

/* POST with retries on rate limits (429) and temporary server errors (5xx). The key goes in a header, never in the URL or the logs. */
async function post(path, body, env, fetchImpl) {
  const key = String(env.GEMINI_API_KEY || '').trim();
  let lastErr;
  for (let i = 0; i < MAX_TRIES; i++) {
    let res;
    try {
      res = await fetchImpl(`${BASE}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
    } catch (e) {
      lastErr = new EmbeddingError(`Gemini request failed: ${e.message}`);
      await sleep(800 * 2 ** i);
      continue;
    }
    if (res.ok) return res.json();
    const text = await res.text().catch(() => '');
    lastErr = new EmbeddingError(`Gemini ${res.status}: ${text.slice(0, 200)}`, res.status);
    if (res.status === 429 || res.status >= 500) {
      const wait = parseFloat(res.headers.get('retry-after')) * 1000 || 1500 * 2 ** i;
      await sleep(Math.min(wait, 20000));
      continue;
    }
    throw lastErr; // 400 / 401 / 403 / 404: retrying the same request cannot help
  }
  throw lastErr;
}

const toVector = (e) => {
  const v = e && (e.values || e.embedding?.values);
  if (!Array.isArray(v) || !v.length) throw new EmbeddingError('Gemini returned an empty embedding');
  if (v.length !== EMBEDDING_DIMS) throw new EmbeddingError(`Gemini returned ${v.length} dimensions, expected ${EMBEDDING_DIMS}`);
  return normalise(v);
};

/* texts -> array of normalised vectors (same order). taskType: 'RETRIEVAL_DOCUMENT' for stored chunks, 'RETRIEVAL_QUERY' for questions. */
export async function embedTexts(texts, { taskType = 'RETRIEVAL_DOCUMENT', env = process.env, fetchImpl = fetch } = {}) {
  if (!embeddingsConfigured(env)) throw new EmbeddingError('GEMINI_API_KEY is not set');
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const part = texts.slice(i, i + BATCH);
    let vectors;
    try {
      const data = await post(`models/${EMBEDDING_MODEL}:batchEmbedContents`, {
        requests: part.map((text) => ({ model: `models/${EMBEDDING_MODEL}`, content: { parts: [{ text }] }, taskType, outputDimensionality: EMBEDDING_DIMS })),
      }, env, fetchImpl);
      vectors = (data.embeddings || []).map(toVector);
      if (vectors.length !== part.length) throw new EmbeddingError('Gemini returned a different number of embeddings than requested');
    } catch (e) {
      if (e.status !== 400 && e.status !== 404 && !(e instanceof EmbeddingError && /different number/.test(e.message))) throw e;
      // the batch endpoint was refused for this model: fall back to one request per text
      vectors = [];
      for (const text of part) {
        const data = await post(`models/${EMBEDDING_MODEL}:embedContent`, { content: { parts: [{ text }] }, taskType, output_dimensionality: EMBEDDING_DIMS }, env, fetchImpl);
        vectors.push(toVector(data.embedding || (data.embeddings || [])[0]));
      }
    }
    out.push(...vectors);
  }
  return out;
}

/* What is embedded for a stored chunk: the title and section heading give a short chunk its context. */
export const chunkEmbeddingText = (c) => `${c.title || ''}${c.heading ? ` - ${c.heading}` : ''}\n${c.text}`;
