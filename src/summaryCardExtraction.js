function cleanField(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const MAX_TITLE_WORDS = 10;   // a title longer than this is not a title
const SHORT_SENTENCE_WORDS = 8; // a whole sentence this short is its own title
// a title never ends on one of these ("... acquisition engine funded by" is cut before "funded")
const TRAILING_FILLER = new Set(["a", "an", "the", "of", "to", "and", "or", "for", "with", "by", "on", "in", "at", "as", "that", "which", "per", "from", "into", "than", "but", "so"]);
// words that start the supporting part of a long sentence: the title is what comes before them
const BOUNDARY_WORDS = new Set(["funded", "focused", "per", "so", "that", "which", "by", "with", "while", "using", "for", "because", "where", "when", "until", "like", "and", "but", "across", "between", "within", "into", "toward", "towards", "through", "before", "after", "if"]);

const wordsOf = (s) => String(s || "").split(/\s+/).filter(Boolean);

/** Remove leading separators/punctuation and lines that are only punctuation or quote marks. */
export function tidyDescription(value) {
  return String(value || "")
    .split("\n").filter((line) => /[\p{L}\p{N}]/u.test(line)).join("\n")
    .replace(/^[\s;:,.\u2014\u2013-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tidyTitle(value) {
  let t = String(value || "").trim().replace(/[\s,;:\u2014\u2013-]+$/, "").trim();
  // a trailing sentence period is not part of a title; an unmatched quote left over from a cut is dropped
  t = t.replace(/\.+$/, "");
  if ((t.match(/["\u201c\u201d]/g) || []).length % 2 === 1) t = t.replace(/["\u201c\u201d]+$/, "").trim();
  return t.trim();
}

// Splits one "Key Strategy" sentence into a short title and the rest of its own words (a dash or colon, a short sentence, a comma, a joining word like "funded", else the first 8 words); only the cut punctuation is dropped, so every word stays, in order.
export function splitStrategy(source) {
  const text = cleanField(source);
  if (!text) return { title: "", description: "" };
  const whole = (title) => ({ title: tidyTitle(title), description: "" });

  const sep = /\s*([\u2014\u2013;:])\s+/.exec(text);
  if (sep && sep.index > 0 && wordsOf(text.slice(0, sep.index)).length <= MAX_TITLE_WORDS) {
    return { title: tidyTitle(text.slice(0, sep.index)), description: tidyDescription(text.slice(sep.index + sep[0].length)) };
  }
  const words = wordsOf(text);
  if (words.length <= SHORT_SENTENCE_WORDS) return whole(text);

  const comma = text.indexOf(", ");
  if (comma > 0) {
    const lead = wordsOf(text.slice(0, comma)).length;
    if (lead >= 3 && lead <= SHORT_SENTENCE_WORDS) return { title: tidyTitle(text.slice(0, comma)), description: tidyDescription(text.slice(comma + 1)) };
  }
  for (let i = 3; i <= Math.min(MAX_TITLE_WORDS, words.length - 1); i++) {
    if (BOUNDARY_WORDS.has(words[i].toLowerCase().replace(/[^a-z]/g, ""))) {
      return { title: tidyTitle(words.slice(0, i).join(" ")), description: tidyDescription(words.slice(i).join(" ")) };
    }
  }
  let cut = SHORT_SENTENCE_WORDS;
  while (cut > 3 && TRAILING_FILLER.has(words[cut - 1].toLowerCase().replace(/[^a-z]/g, ""))) cut--;
  return { title: tidyTitle(words.slice(0, cut).join(" ")), description: tidyDescription(words.slice(cut).join(" ")) };
}

const wordKey = (w) => String(w || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5); // "pricing" and "price" share a key, so a label may use another form of the word
const contentWords = (s) => wordsOf(s).map(wordKey).filter((k) => k.length >= 4);

// A title the AI wrote for a strategy that has none: short, not the whole sentence, and clearly about this sentence (it shares at least one real word with it); otherwise "".
export function usableTitle(title, strategy) {
  const t = tidyTitle(cleanField(title).replace(/^(?:key strategy|title)\s*[:-]\s*/i, "").replace(/^["“]+|["”]+$/g, ""));
  const n = wordsOf(t).length;
  if (n < 2 || n > MAX_TITLE_WORDS || t.length > 80) return "";
  if (normalizedText(t) === normalizedText(strategy)) return "";
  const have = new Set(contentWords(strategy));
  return contentWords(t).some((k) => have.has(k)) ? t : "";
}

function normalizedText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Kept for existing callers: title + description of a Key Strategy field. */
function strategyParts(source) {
  return splitStrategy(source);
}

/** Parse repeated Problem / Key Strategy / Formula-Theory / Result cards from source text. */
export function parseSummaryStrategyCards(source) {
  const sourceText = String(source || "");
  const blocks = sourceText.split(/\n{2,}(?=\s*\d+[.)]\s+[^\n]+)/).map((p) => p.trim()).filter(Boolean);
  const cards = [];
  const fieldValue = (block, label, nextLabels) => {
    const start = new RegExp(`\\b${label}\\s*[:\\uFF1A]\\s*`, "i").exec(block);
    if (!start) return "";
    const tail = block.slice(start.index + start[0].length);
    const next = new RegExp(`\\b(?:${nextLabels.join("|")})\\s*[:\\uFF1A]`, "i").exec(tail);
    return cleanField(next ? tail.slice(0, next.index) : tail);
  };
  for (const block of blocks) {
    const heading = (block.match(/^\s*\d+[.)]\s+([^\n]+)/) || [])[1]?.trim() || "";
    const strategy = fieldValue(block, "Key Strategy", ["Problem", "Formula\\s*\\/\\s*Theory", "Result", "Solution", "Key Solution", "Goal"]);
    if (!strategy) continue;
    const result = fieldValue(block, "Result", ["Problem", "Key Strategy", "Formula\\s*\\/\\s*Theory", "Solution", "Key Solution", "Goal"]);
    const parts = strategyParts(strategy);
    cards.push({ heading, strategy, title: parts.title, description: parts.description, impact: result || "N/A" });
  }
  return cards;
}

function normalized(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function tokenOverlap(a, b) {
  const left = new Set(normalized(a).split(" ").filter((x) => x.length > 2));
  const right = new Set(normalized(b).split(" ").filter((x) => x.length > 2));
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common++;
  return common / Math.max(left.size, right.size);
}

/** Restore exact strategy text/results from parsed cards while retaining model-assigned lever metadata. */
export function restoreSummaryStrategyCards(levers, cards) {
  const remaining = (levers || []).map((lever) => ({ lever, used: false }));
  return cards.map((card) => {
    const heading = normalized(card.heading);
    let best = null;
    for (const candidate of remaining) {
      if (candidate.used) continue;
      const sameHeading = normalized(candidate.lever.section) === heading;
      const overlap = tokenOverlap(card.strategy, candidate.lever.claim_en);
      const score = overlap + (sameHeading ? 0.5 : 0);
      if (!best || score > best.score) best = { candidate, score, sameHeading };
    }
    // Keep the match bounded to the same case heading when possible. For duplicate headings,
    // token overlap disambiguates the cards; source order breaks remaining ties.
    if (best && (best.sameHeading || best.score >= 0.2)) best.candidate.used = true;
    else best = null;
    const base = best?.candidate.lever || { lever: "others", other_category: "uncategorized", related_to: "case study strategy" };
    const matchedTitle = best?.candidate.lever.claim_en?.match(/^(.{1,250}?):\s/)?.[1]?.trim();
    // The model's label is used when it fits the sentence: the description is then the WHOLE original sentence (nothing cut), unless the label is just the sentence's own opening words, in which case the rest is the description. With no usable label the code's own split is the fallback.
    const label = usableTitle(matchedTitle, card.strategy);
    const opening = !!label && normalized(card.strategy).startsWith(normalized(label));
    const title = label || card.title;
    const description = !label ? card.description : opening ? tidyDescription(wordsOf(card.strategy).slice(wordsOf(label).length).join(" ")) : card.strategy;
    const claim = description ? `${title}: ${description}` : `${title}:`;
    return { ...base, section: card.heading || base.section || "General", claim_en: claim, impact: card.impact || "N/A" };
  });
}
