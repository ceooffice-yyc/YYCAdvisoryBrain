// Step 6 of Ask the Brain: cheap checks on the finished answer. PURE JavaScript (server and browser).
//
// A business-advice answer is only as good as its numbers. This finds every significant figure in the answer (amounts, percentages,
// decimals, years, anything of 3+ digits) and checks that it also appears in the text the AI was given. It cannot prove an answer is
// right, but a figure that appears nowhere in the sources is a strong warning that something was invented or mis-copied.

const FIGURE = /(US\$|RM|[$£€])?\s?(\d[\d,]*(?:\.\d+)?)\s?(%|percent|million|billion|thousand|k\b|x\b)?/gi;

function figuresIn(text) {
  const out = [];
  const clean = String(text || '').replace(/^\s*\d+[.)]\s+/gm, ''); // "1. " list numbering is not a figure
  for (const m of clean.matchAll(FIGURE)) {
    const digits = m[2].replace(/,/g, '').replace(/\.$/, '');
    const whole = digits.split('.')[0];
    const significant = whole.length >= 3 || digits.includes('.') || !!m[1] || !!m[3];
    if (significant) out.push({ digits, shown: m[0].trim() });
  }
  return out;
}

const contains = (haystack, digits) => new RegExp(`(?<![\\d.])${digits.replace(/\./g, '\\.')}(?![\\d])`).test(haystack);

/* -> the figures (as written in the answer) that appear in neither the sources nor the question. */
export function unsupportedFigures(answerText, sourceText, questionText = '') {
  const haystack = String(sourceText || '').replace(/,/g, '');
  const asked = String(questionText || '').replace(/,/g, '');
  const bad = [];
  for (const f of figuresIn(answerText)) {
    if (contains(haystack, f.digits) || contains(asked, f.digits)) continue;
    if (!bad.includes(f.shown)) bad.push(f.shown);
  }
  return bad.slice(0, 5);
}
