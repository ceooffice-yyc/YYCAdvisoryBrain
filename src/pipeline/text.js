// Text helpers the extraction rules share: normalising, counting words, matching a sentence back to its source.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.

export const KEY_STRATEGY_LABEL = /^\s*key strateg/i;
export const FIELD_LABEL_SECTION = /^\s*(problem|formula|theory|result|results|outcome|kpis?|fail|lesson|timeline|history|background|chronolog)/i;
export const normWs = (s) => String(s || "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

/* The description and the impact must be the document's ORIGINAL words, of any length. The model sometimes condenses or
   rewords them anyway, so after extraction the text is replaced with the run of consecutive source sentences it matches
   best (Jaccard word overlap >= 0.5). No word limit: a 120-word paragraph is kept whole.
   `prefixOnly` = descriptions, which always start at the first sentence of the strategy's paragraph. */
export const wordCount = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
export const sentencesOf = (s) => String(s || "").split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 1);
export const tokSet = (s) => new Set(normWs(s).replace(/[^\p{L}\p{N}%$.\s-]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
export function snapToSource(modelText, sents, prefixOnly = false) {
  const want = tokSet(modelText);
  if (!want.size || !sents.length) return modelText;
  // a fragment that sits inside one original sentence ("brought both cash and a strong operator") → that whole sentence
  const mn = normWs(modelText);
  const whole = sents.find((x) => normWs(x).includes(mn));
  if (whole) return whole;
  let best = null, bestScore = 0;
  for (let i = 0; i < sents.length; i++) {
    if (prefixOnly && i > 0) break;
    let run = "";
    for (let j = i; j < sents.length && j < i + 14; j++) {
      run = run ? `${run} ${sents[j]}` : sents[j];
      const have = tokSet(run);
      let hit = 0; want.forEach((w) => { if (have.has(w)) hit++; });
      const score = hit / (want.size + have.size - hit); // Jaccard
      if (score > bestScore) { bestScore = score; best = run; }
    }
  }
  return best && bestScore >= 0.5 ? best : modelText;
}
// index of the first original sentence of the run that best matches `modelText` (-1 when nothing matches well)
export function windowStart(modelText, sents) {
  const want = tokSet(modelText);
  if (!want.size || !sents.length) return -1;
  const mn = normWs(modelText);
  const whole = sents.findIndex((x) => normWs(x).includes(mn));
  if (whole >= 0) return whole;
  let best = -1, bestScore = 0;
  for (let i = 0; i < sents.length; i++) {
    let run = "";
    for (let j = i; j < sents.length && j < i + 14; j++) {
      run = run ? `${run} ${sents[j]}` : sents[j];
      const have = tokSet(run);
      let hit = 0; want.forEach((w) => { if (have.has(w)) hit++; });
      const score = hit / (want.size + have.size - hit);
      if (score > bestScore) { bestScore = score; best = i; }
    }
  }
  return bestScore >= 0.4 ? best : -1;
}