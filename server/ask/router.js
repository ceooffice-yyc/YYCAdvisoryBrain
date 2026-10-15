// Step 1 of Ask the Brain: understand the question. PURE JavaScript (runs on the server and in the browser).
//
// One small AI call returns: what kind of request this is ("list" = the person wants examples / strategies / levers as a list,
// "question" = everything else), how many items they asked for, a standalone version of the question (follow-ups such as
// "what about 60/40?" resolved from the chat), and search keywords / synonyms. If that call fails or times out, simple rules take over,
// so a failure here only makes the search a little less clever; it never blocks an answer.

export const GREETING_REPLY = 'Hi! How can I help you?';

const SMALL_TALK = /^(hi+|hello+|hey+|yo|good (morning|afternoon|evening)|thanks?( you)?|thank u|tq|bye|goodbye|ok(ay)?|哈啰|你好|您好|早上好|下午好|晚上好|谢谢|多谢|再见|拜拜)[!.?~\s]*$/;
export function isSmallTalk(question) {
  const s = String(question || '').trim().toLowerCase();
  return s.length <= 25 && SMALL_TALK.test(s); // real questions are longer
}

const COUNT_A = /\b(?:top|first|show|give|provide|list)(?:\s+me)?\s+(\d{1,2})\b/i;
const COUNT_B = /\b(\d{1,2})\s+(?:\w+\s+)?(?:examples?|strateg(?:y|ies)|levers?|ideas?|tactics?)\b/i;
const LIST_WORDS = /\b(examples?|strateg(?:y|ies)|levers?|ideas?|tactics?|approaches|ways to)\b/i;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* Words people use for the built-in levers (a lever is a category of strategy: volume, price, ...). Only the rules fallback uses this;
   when the AI is available it picks from the lever ids actually present in the library, so custom levers work too. */
const LEVER_WORDS = [
  ['volume', /\bvolumes?\b/i],
  ['price', /\bpric(?:e|es|ing)\b/i],
  ['cogs', /\b(?:cogs|cost of goods(?: sold)?|direct costs?)\b/i],
  ['overheads', /\boverheads?\b/i],
  ['inventory_days', /\binventory\b/i],
  ['ar_days', /\breceivables?\b/i],
  ['ap_days', /\bpayables?\b/i],
  ['talent_strategy', /\btalent\b/i],
  ['product_differentiation', /\bdifferentiat(?:e|ion|ing)\b/i],
  ['acquisition_expansion_valuation', /\b(?:acquisitions?|m&a)\b/i],
];
export const detectLever = (question) => (LEVER_WORDS.find(([, re]) => re.test(String(question || ''))) || [null])[0];

/* The fallback: rules only. Note that a bare word like "volume" does not make a question a list request;
   it only names the lever once the person is asking for a list. */
export function heuristicAnalysis(question) {
  const q = String(question || '');
  const m = q.match(COUNT_A) || q.match(COUNT_B);
  return {
    intent: m || LIST_WORDS.test(q) ? 'list' : 'question',
    count: m ? clamp(Number(m[1]), 1, 20) : 10,
    lever: detectLever(q),
    standalone: q,
    keywords: [],
    source: 'rules',
  };
}

export function buildAnalysisPrompt(question, history, levers = []) {
  return `You prepare a question for a keyword + semantic search over business case studies (pricing, volume, cost, inventory, talent, ownership, funding, strategy).
Return ONLY JSON: {"intent": "list" | "question", "count": <number or null>, "lever": "<lever id or null>", "standalone": "<the question rewritten to stand alone>", "keywords": ["..."]}
- intent "list": the person asks for examples, strategies, levers, ideas or "top N" of something. Otherwise "question".
- count: how many items they asked for, or null.
- lever: only for a list request about ONE category of strategy: the matching id from this list, otherwise null. Lever ids: ${levers.length ? levers.join(', ') : '(none)'}.
- standalone: if the question depends on the recent conversation (e.g. "what about 60/40?"), rewrite it so it makes sense alone; otherwise repeat it unchanged. Do not answer it.
- keywords: 6-12 short words or phrases: synonyms, alternative wordings, related concepts, numbers in other formats (e.g. "50 50" -> "50:50", "equal shareholding", "deadlock"). Do not repeat words already in the question.
${history ? `RECENT CONVERSATION:\n${history}\n` : ''}QUESTION: ${question}`;
}

/* Accept what the AI returned only where it is valid; anything else comes from the rules. */
export function parseAnalysis(json, question, levers = []) {
  const base = heuristicAnalysis(question);
  if (!json || typeof json !== 'object') return base;
  const keywords = (Array.isArray(json.keywords) ? json.keywords : [])
    .filter((k) => typeof k === 'string' && k.trim().length > 1 && k.length <= 40).slice(0, 12);
  const standalone = typeof json.standalone === 'string' && json.standalone.trim().length >= 3 && json.standalone.length <= 400 ? json.standalone.trim() : base.standalone;
  const explicitCount = COUNT_A.test(question) || COUNT_B.test(question); // a number typed in the question always wins over the AI's reading
  const aiIntent = json.intent === 'list' || json.intent === 'question' ? json.intent : null;
  const aiCount = Number.isFinite(Number(json.count)) && Number(json.count) > 0 ? clamp(Math.round(Number(json.count)), 1, 20) : null;
  const lever = typeof json.lever === 'string' && json.lever !== 'others' && levers.includes(json.lever) ? json.lever : base.lever; // only a real, named lever of the library
  return {
    intent: explicitCount ? 'list' : aiIntent || base.intent,
    count: explicitCount ? base.count : aiCount || base.count,
    lever,
    standalone,
    keywords,
    source: 'ai',
  };
}

/* Extra search words for a question: the AI's keywords, plus its standalone rewrite when that differs (follow-up questions). */
export function searchHints(analysis, question) {
  return [...analysis.keywords, ...(analysis.standalone && analysis.standalone !== question ? [analysis.standalone] : [])];
}

export async function analyzeQuestion(question, history, llm, { timeoutMs = 8000, levers = [] } = {}) {
  try {
    const json = await Promise.race([
      llm.json(buildAnalysisPrompt(question, history, levers), { maxTokens: 350, retries: 0, expectedOutput: 250, waitOnLimit: false, reasoning: 'low' }), // optional step: never wait for it
      new Promise((_, reject) => setTimeout(() => reject(new Error('analysis timeout')), timeoutMs)),
    ]);
    return parseAnalysis(json, question, levers);
  } catch {
    return heuristicAnalysis(question);
  }
}
