/* global process */
// Measures how well Ask the Brain does on the golden questions in eval/golden.json. Run it after every change to search or prompts.
//
//   npm run eval -- --library path/to/backup.json            offline, no network: does SEARCH put the right documents on top?
//   npm run eval -- --library backup.json --live             also runs the whole pipeline with the AI (uses your Groq keys from .env)
//   npm run eval -- --library backup.json --live --hosted   live, but search through your real Supabase index (keyword + meaning) as the website does
//   options:  --only own-1,list-1     run just these ids        --report out.json   where to write the live report
//
// The library file is the JSON from the app's "Export backup" (it holds the documents and lever records). Nothing is sent anywhere
// in offline mode. Exit code 1 means a threshold in golden.json was missed, so this can also run in a build pipeline.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLocalRetriever } from '../server/ask/localRetrieval.js';
import { heuristicAnalysis, searchHints } from '../server/ask/router.js';
import { rankRecords } from '../server/ask/context.js';
import { runAsk } from '../server/ask/pipeline.js';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const live = args.includes('--live');
const libraryPath = opt('--library');
if (!libraryPath) { console.error('Usage: npm run eval -- --library path/to/backup.json [--live] [--only id,id]'); process.exit(2); }

if (!fs.existsSync(libraryPath)) {
  console.error(`Cannot find the library file: ${path.resolve(libraryPath)}\nUse the full path of the backup you exported from the app (Export backup), in quotes, e.g.\n  npm run eval -- --library "C:\\Users\\you\\Downloads\\yyc-brain-backup.json"`);
  process.exit(2);
}
const golden = JSON.parse(fs.readFileSync(new URL('../eval/golden.json', import.meta.url), 'utf8'));
const lib = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
const docs = lib.docs || [];
const records = lib.levers || lib.records || [];
const index = docs.map((d) => ({ id: d.id, title: d.title, doc_type: d.doc_type, industry: d.industry }));
const titleOf = (id) => (index.find((d) => d.id === id) || {}).title;
const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
const questions = golden.questions.filter((q) => !only || only.has(q.id));
const retriever = makeLocalRetriever(async () => docs);

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const pct = (x) => `${Math.round(100 * x)}%`;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/* ── offline: search quality ── */
async function searchRun(q) {
  const a = heuristicAnalysis(q.q);
  const hints = searchHints(a, q.q);
  const r = await retriever.retrieve({ question: q.q, keywords: hints });
  const rankedDocs = [];
  [...r.chunks].sort((x, y) => y.score - x.score).forEach((c) => { const t = titleOf(c.doc_id); if (t && !rankedDocs.includes(t)) rankedDocs.push(t); });
  return { rankedDocs, chunks: [...r.chunks].sort((x, y) => y.score - x.score), a, hints };
}

const results = [];
for (const q of questions) {
  const row = { id: q.id, type: q.type, q: q.q, known: q.known };
  const s = await searchRun(q);
  if (q.type === 'refuse') {
    row.detail = `top: ${s.rankedDocs[0] || '(nothing)'} (judged only with --live)`;
  } else if (q.type === 'list') {
    const ranked = rankRecords({ question: q.q, keywordText: s.hints.join(' '), records, titleOf, limit: q.count || 10, lever: s.a.lever, diverse: true });
    row.leverPrecision = ranked.length ? ranked.filter((r) => r.lever === q.lever).length / ranked.length : 0;
    const distinct = new Set(ranked.map((r) => r.doc_id)).size;
    row.pass = row.leverPrecision >= golden.thresholds.leverPrecision && distinct >= (q.minDocs || 1);
    row.detail = `${ranked.length} records, ${pct(row.leverPrecision)} are '${q.lever}', ${distinct} documents`;
  } else {
    const want = q.docs || [];
    const need = q.minDocs || 1;
    const foundIn = (k) => want.filter((d) => s.rankedDocs.slice(0, k).includes(d)).length >= need;
    const first = want.map((d) => s.rankedDocs.indexOf(d)).filter((i) => i >= 0).sort((x, y) => x - y)[0];
    row.docHitAt3 = foundIn(3);
    row.docHitAt6 = foundIn(6);
    row.rr = first === undefined ? 0 : 1 / (first + 1);
    if (q.sections) {
      const top5 = s.chunks.slice(0, 5);
      row.sectionHit = q.sections.some((sec) => top5.some((c) => want.includes(titleOf(c.doc_id)) && c.heading === sec));
    }
    row.pass = row.docHitAt6;
    row.detail = `found: ${s.rankedDocs.slice(0, 4).join(' | ')}${q.sections ? `  section ${row.sectionHit ? 'ok' : 'MISSING'}` : ''}`;
  }
  results.push(row);
}

console.log(`\nSearch quality (${live ? 'offline part' : 'offline'}), ${docs.length} documents, ${records.length} lever records\n`);
for (const r of results) console.log(`${r.pass === undefined ? ' -  ' : r.pass ? 'PASS' : r.known ? 'KNWN' : 'FAIL'}  ${pad(r.id, 9)} ${pad(r.type, 7)} ${pad(r.q, 58)} ${r.detail}`);

const scored = results.filter((r) => r.docHitAt6 !== undefined && !r.known); // known gaps are shown but do not count against the thresholds
const summary = {
  questions: scored.length,
  docHitAt3: mean(scored.map((r) => (r.docHitAt3 ? 1 : 0))),
  docHitAt6: mean(scored.map((r) => (r.docHitAt6 ? 1 : 0))),
  mrr: mean(scored.map((r) => r.rr)),
  leverPrecision: mean(results.filter((r) => r.leverPrecision !== undefined).map((r) => r.leverPrecision)),
};
console.log(`\ndoc hit@3 ${pct(summary.docHitAt3)}   doc hit@6 ${pct(summary.docHitAt6)} (needs ${pct(golden.thresholds.docHitAt6)})   MRR ${summary.mrr.toFixed(2)} (needs ${golden.thresholds.mrr})   lever precision ${summary.leverPrecision === null ? 'n/a' : pct(summary.leverPrecision)} (needs ${pct(golden.thresholds.leverPrecision)})`);
let failed = summary.docHitAt6 < golden.thresholds.docHitAt6 || summary.mrr < golden.thresholds.mrr || (summary.leverPrecision !== null && summary.leverPrecision < golden.thresholds.leverPrecision);

/* ── live: the whole pipeline with the AI ── */
if (live) {
  const { makeLlm } = await import('../server/ask/llm.js');
  const { loadGroqKeys } = await import('../server/groqProxy.js');
  if (!loadGroqKeys().length) { console.error('\n--live needs GROQ_API_KEY in .env'); process.exit(2); }
  const llm = makeLlm({});
  let deps = { llm, retrieve: retriever.retrieve, records: async () => records, docIndex: async () => index };
  if (args.includes('--hosted')) { // the website's own search: needs SUPABASE_* and (for meaning-based search) GEMINI_API_KEY in .env; reads your real library
    const { getClient } = await import('../server/db.js');
    const { makeServerDeps } = await import('../server/ask/serverDeps.js');
    deps = makeServerDeps(getClient(process.env), process.env, llm);
    console.log('\nSearch: hosted index (the same as the website).');
  } else console.log('\nSearch: in-memory keyword search over the backup file (add --hosted to use the website\'s keyword + meaning search).');
  console.log(`\nLive run: ${questions.length} questions, about ${questions.length * 2} AI calls (roughly ${Math.round(questions.length * 4.5)}k tokens). This takes a few minutes.\n`);
  const live1 = [];
  for (const q of questions) {
    const t0 = Date.now();
    const checks = [];
    let out = null;
    try {
      out = await runAsk({ question: q.q, history: [] }, deps);
    } catch (e) {
      checks.push(`error: ${e.message}`);
    }
    if (out) {
      const shouldAnswer = q.type !== 'refuse';
      if (out.answerable !== shouldAnswer) checks.push(shouldAnswer ? 'refused but the library covers it' : 'answered something the library does not cover');
      if (shouldAnswer && out.answerable) {
        const cited = new Set(out.citations.map((c) => c.doc_title));
        const need = q.minDocs || 1;
        if (q.docs && q.docs.filter((d) => cited.has(d)).length < need) checks.push(`cites ${[...cited].join(', ') || 'nothing'}; expected ${q.docs.join(' / ')}`);
        if (q.type === 'list') {
          const bullets = out.text.split('\n').filter((l) => /^\s*[-*•]/.test(l)).length;
          if (bullets < Math.ceil((q.count || 10) * 0.7)) checks.push(`only ${bullets} bullets for ${q.count}`);
          if (out.citations.filter((c) => c.record_id).length < Math.ceil((q.count || 10) * 0.5)) checks.push('fewer than half the bullets are linked to a lever record');
        }
        if (out.unsupportedFigures.length) checks.push(`figures not in sources: ${out.unsupportedFigures.join(', ')}`);
        if (/\[[CR]\d+\]|doc_id|\bmv[0-9a-z]{9,}\b/.test(out.text)) checks.push('internal tags or ids leaked into the text');
        if (out.uncited) checks.push('answer cited no source');
      }
    }
    const ms = Date.now() - t0;
    live1.push({ id: q.id, type: q.type, q: q.q, pass: checks.length === 0, known: q.known, checks, ms, answerable: out ? out.answerable : null, citations: out ? out.citations.map((c) => `${c.doc_title}${c.section ? ' · ' + c.section : ''}`) : [], text: out ? out.text : '', notes: out ? out.notes : null });
    console.log(`${checks.length ? (q.known ? 'KNWN' : 'FAIL') : 'PASS'}  ${pad(q.id, 9)} ${pad(q.q, 52)} ${(ms / 1000).toFixed(1)}s${checks.length ? '  <- ' + checks.join('; ') : ''}`);
  }
  const ok = live1.filter((r) => r.pass).length;
  const knownFails = live1.filter((r) => !r.pass && r.known).length;
  const asked = live1.filter((r) => r.type !== 'refuse');
  const refused = live1.filter((r) => r.type === 'refuse');
  console.log(`\nLive: ${ok}/${live1.length} passed${knownFails ? ` (+${knownFails} known gap${knownFails > 1 ? 's' : ''}, see eval/golden.json)` : ''}.  Covered questions answered: ${asked.filter((r) => r.answerable).length}/${asked.length}.  Out-of-library questions refused: ${refused.filter((r) => r.answerable === false).length}/${refused.length}.  Median ${(live1.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(live1.length / 2)] / 1000).toFixed(1)}s`);
  const dir = fileURLToPath(new URL('../eval/reports/', import.meta.url)); // (fileURLToPath decodes %20 in the path: a hand-made path created a stray folder)
  fs.mkdirSync(dir, { recursive: true });
  const file = opt('--report') || path.join(dir, `live-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), summary, results: live1 }, null, 2));
  console.log(`Report written to ${file}`);
  if (live1.some((r) => !r.pass && !r.known)) failed = true;
}
process.exit(failed ? 1 : 0);
