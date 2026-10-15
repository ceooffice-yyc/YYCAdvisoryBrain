// Ask the Brain, start to finish. PURE JavaScript: no network, database or browser APIs of its own. Everything it needs comes in as `deps`,
// so the same pipeline runs on the hosted server (server/ask/serverDeps.js), in the browser for the no-database local mode
// (src/askLocal.js), and in tests and the evaluation script with fakes.
//
//   1 understand   server/ask/router.js       intent (list or question), standalone rewrite, keywords        (1 small AI call)
//   2 retrieve     deps.retrieve              the best chunks: keyword + meaning on the server, BM25 in the browser
//   3 context      server/ask/context.js      lever records + chunks -> tagged text within the size budget
//   4 answer       server/ask/prompt.js       the answer, tagged with its sources                           (1 AI call)
//   5 finalize     server/ask/postprocess.js  references, evidence, match %, closest document: all built in code
//   6 verify       server/ask/verify.js       figures in the answer that appear nowhere in the sources
//
// deps = {
//   llm:      { json(prompt, { maxTokens, retries }) -> parsed JSON object },
//   retrieve: async ({ question, standalone, keywords, taggedIds }) -> { chunks:[{doc_id,pos,heading,text,score}], docs:[{id,title,doc_type,industry,sections}], mode },
//   records:  async () -> all lever records,
//   docIndex: async () -> [{ id, title, doc_type, industry }],
//   now?:     () -> ms
// }

import { isSmallTalk, GREETING_REPLY, analyzeQuestion, searchHints } from './router.js';
import { rankRecords, buildContext } from './context.js';
import { buildAnswerPrompt } from './prompt.js';
import { finalizeAnswer } from './postprocess.js';

export class AskError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}

const MAX_QUESTION = 2000;

/* the last few chat messages, shortened, as plain text for the prompts */
export function formatHistory(history) {
  const list = (Array.isArray(history) ? history : []).slice(-4);
  return list
    .map((m, k) => `${m && m.role === 'user' ? 'Q' : 'A'}: ${String((m && m.text) || '').slice(0, k === list.length - 1 ? 900 : 300)}`)
    .join('\n');
}

const empty = { citations: [], evidence: [], closest: null, retrieved: [], unsupportedFigures: [], uncited: false };

export async function runAsk(input, deps) {
  const now = deps.now || Date.now;
  const t0 = now();
  const question = String((input && input.question) || '').trim().slice(0, MAX_QUESTION);
  if (!question) throw new AskError('bad_request', 'Empty question');
  if (isSmallTalk(question)) return { ...empty, kind: 'greeting', answerable: true, text: GREETING_REPLY, notes: {}, trace: {} };

  const history = formatHistory(input.history);
  let records;
  let index;
  try {
    [records, index] = await Promise.all([deps.records(), deps.docIndex()]);
  } catch (e) {
    throw new AskError('retrieval_failed', `Search failed: ${e.message}`);
  }
  const analysis = await analyzeQuestion(question, history, deps.llm, { levers: [...new Set(records.map((r) => r.lever))].filter((l) => l !== 'others') }); // "others" is the catch-all, never a lever the person named
  const t1 = now();
  const hints = searchHints(analysis, question);
  const keywordText = hints.join(' ');

  let retrieval;
  try {
    retrieval = await deps.retrieve({ question, standalone: analysis.standalone, keywords: hints, taggedIds: Array.isArray(input.taggedIds) ? input.taggedIds.slice(0, 5) : [] });
  } catch (e) {
    throw new AskError('retrieval_failed', `Search failed: ${e.message}`);
  }
  const t2 = now();

  const docs = new Map(index.map((d) => [d.id, { ...d, sections: [] }]));
  (retrieval.docs || []).forEach((d) => docs.set(d.id, { ...(docs.get(d.id) || {}), ...d }));
  const chunks = (retrieval.chunks || []).filter((c) => docs.has(c.doc_id));
  const isList = analysis.intent === 'list';
  const ranked = rankRecords({
    question, keywordText, records, titleOf: (id) => docs.get(id) && docs.get(id).title,
    limit: isList ? analysis.count : 6, lever: isList ? analysis.lever : null, diverse: isList,
  });

  const base = {
    notes: { intent: analysis.intent, count: analysis.count, lever: analysis.lever || null, keywords: analysis.keywords, standalone: analysis.standalone, analysis: analysis.source, mode: retrieval.mode, chunks: chunks.length, records: ranked.length },
  };
  // nothing at all was found: say so without spending an AI call
  if (!chunks.length && !ranked.length) return { ...empty, ...base, kind: 'answer', answerable: false, text: '', trace: { ms: { analysis: t1 - t0, retrieve: t2 - t1, answer: 0, total: now() - t0 } } };

  const context = buildContext({ chunks, docs, records: ranked });
  const prompt = buildAnswerPrompt({ question, history, sourcesBlock: context.sourcesBlock, recordsBlock: context.recordsBlock, intent: analysis.intent, count: analysis.count });
  const raw = await deps.llm.json(prompt, { maxTokens: 2000, retries: 1, expectedOutput: 800 });
  const t3 = now();

  const final = finalizeAnswer({ raw, context, question, keywordText, docs, docIds: index.map((d) => d.id), mode: retrieval.mode, allChunks: chunks });
  const seenDocs = new Map();
  [...chunks].sort((a, b) => b.score - a.score).forEach((c) => { if (!seenDocs.has(c.doc_id)) seenDocs.set(c.doc_id, { doc_id: c.doc_id, title: docs.get(c.doc_id).title, score: Number((c.score || 0).toFixed(4)) }); });
  return {
    ...final,
    ...base,
    kind: 'answer',
    retrieved: [...seenDocs.values()],
    trace: {
      chunkRefs: context.usedChunks.map((c) => `${c.doc_id}#${c.pos}`),
      recordRefs: context.usedRecords.map((r) => r.id),
      promptChars: prompt.length,
      ms: { analysis: t1 - t0, retrieve: t2 - t1, answer: t3 - t2, total: now() - t0 },
    },
  };
}
