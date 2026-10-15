// Text helpers for Ask the Brain. PURE JavaScript: this file is imported by the server (hosted mode) AND by the browser (local mode),
// so it must not use Node-only APIs.

/* Words used for searching. Latin words of 3+ letters/digits and 2-digit numbers ("50" in 50/50); "m&a" -> "mna"; light stemming so
   "reinvesting" matches "reinvest"; Chinese text as single characters and character pairs. */
export function tokenizeQuery(qstr) {
  const lowered = (qstr || '').toLowerCase().replace(/\b([a-z])&([a-z])\b/g, '$1n$2');
  const stem = (w) => (w.length > 5 ? w.replace(/ies$/, 'y').replace(/(ing|ed|es|s)$/, '') : w);
  const latin = (lowered.match(/[a-z0-9]{3,}|\b\d{2}\b/g) || []).map(stem);
  const runs = (qstr || '').match(/[一-鿿]+/g) || [];
  const cjk = [];
  runs.forEach((run) => {
    if (run.length === 1) cjk.push(run);
    for (let k = 0; k + 1 < run.length; k++) cjk.push(run.slice(k, k + 2));
  });
  return [...new Set([...latin, ...cjk])];
}

/* BM25 (Okapi) ranking. `extraQuery` = AI-suggested synonyms: they widen the search but count for less than the user's own words. */
export function bm25Rank(query, documents, textOf, extraQuery = '', extraWeight = 0.5) {
  const weight = new Map(tokenizeQuery(query).map((tk) => [tk, 1]));
  tokenizeQuery(extraQuery).forEach((tk) => { if (!weight.has(tk)) weight.set(tk, extraWeight); });
  const terms = [...weight.keys()];
  if (!terms.length || !documents.length) return [];
  const tokenized = documents.map((item) => tokenizeQuery(textOf(item)));
  const avgLength = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / tokenized.length || 1;
  const documentFrequency = new Map();
  tokenized.forEach((tokens) => new Set(tokens).forEach((token) => documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1)));
  const k1 = 1.2;
  const b = 0.75;
  const scored = documents.map((item, i) => {
    const tokens = tokenized[i];
    const frequencies = new Map();
    tokens.forEach((token) => frequencies.set(token, (frequencies.get(token) || 0) + 1));
    let score = 0;
    terms.forEach((term) => {
      const tf = frequencies.get(term) || 0;
      if (!tf) return;
      const df = documentFrequency.get(term) || 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      score += weight.get(term) * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * tokens.length / avgLength)));
    });
    return { item, score };
  });
  return scored.sort((a, b) => b.score - a.score).filter((x) => x.score > 0);
}

/* lower-case, collapse whitespace: for "is this quote really in that text" checks */
export const squash = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/* The sentence(s) of `text` that best match `terms` (already tokenized), at most `max` characters: a short, real excerpt to show as evidence. */
export function bestExcerpt(text, terms, max = 240) {
  const lines = String(text || '').split(/\n+/).map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  const clean = lines.join(' ');
  if (clean.length <= max) return clean;
  const sentences = lines.flatMap((l) => l.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean);
  const want = new Set(terms);
  let best = 0;
  let bestScore = -1;
  sentences.forEach((s, i) => {
    const hits = tokenizeQuery(s).filter((t) => want.has(t)).length;
    if (hits > bestScore) { bestScore = hits; best = i; }
  });
  let out = sentences[best];
  for (let j = best + 1; j < sentences.length && out.length + sentences[j].length + 1 <= max; j++) out += ' ' + sentences[j];
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}
