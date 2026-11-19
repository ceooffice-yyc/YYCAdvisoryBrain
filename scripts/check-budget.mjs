// Size budget (PERF-04). Run after a build:  npm run build && npm run budget
// "First load" = the script the page needs before it can show the Knowledge Base: the entry, everything it loads at once, and the Knowledge Base
// screen (downloaded straight away). Everything else is downloaded when it is used and is checked against its own, looser limit.
// The sizes are what the browser downloads (gzip). Raise a budget only on purpose, and say why in the commit.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST = 'dist';
const BUDGET = { firstLoadKB: 150, screenKB: 40, heavyKB: 140 }; // heavy = Word reader and the other big libraries, only on demand
const gz = (f) => zlib.gzipSync(fs.readFileSync(path.join(DIST, 'assets', f))).length / 1024;
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('No build found. Run "npm run build" first.'); process.exit(2); }

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const assets = fs.readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js'));
const fromHtml = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1].replace('assets/', ''));
const first = new Set(fromHtml);
// the Knowledge Base screen and the small files it shares are fetched at once with the entry (src/main.jsx)
for (const f of assets) if (/^(KnowledgePanel|ClaimView|ai|LeverParts|util|levers|theme|Icon)-/.test(f)) first.add(f);

let failed = false;
// These must stay separate files that are only downloaded when used. If one disappears, it has been folded back into the first page.
const MUST_BE_SPLIT = [[/^lib-/, 'the Word reader'], [/^purify/, 'the HTML cleaner'], [/^extract-/, 'the extraction code'], [/^ChatPanel-/, 'Ask the Brain'], [/^ExplorerPanel-/, 'the Lever Explorer'], [/^UsersPanel-/, 'the Users screen'], [/^GapPanel-/, 'the Gap Log'], [/^PreviewModal-/, 'the document window']];
for (const [re, what] of MUST_BE_SPLIT) { if (!assets.some((f) => re.test(f) && !first.has(f))) { failed = true; console.log(`OVER  ${what} is no longer a separate on-demand file (it is in the first page)`); } }
const row = (name, kb, limit) => { const bad = limit && kb > limit; if (bad) failed = true; console.log(`${bad ? 'OVER ' : 'ok   '} ${name.padEnd(46)} ${kb.toFixed(1).padStart(7)} kB${limit ? `  (limit ${limit})` : ''}`); };

let firstTotal = 0;
for (const f of [...first].sort()) firstTotal += gz(f);
console.log('\nFirst load:');
for (const f of [...first].sort()) row(f, gz(f));
row('FIRST LOAD TOTAL', firstTotal, BUDGET.firstLoadKB);

console.log('\nDownloaded only when used:');
for (const f of assets.filter((x) => !first.has(x)).sort()) {
  const kb = gz(f);
  row(f, kb, /^(lib|purify|dist|mammoth)-/.test(f) ? BUDGET.heavyKB : BUDGET.screenKB);
}
if (failed) { console.error('\nA size budget is exceeded. Find what grew (npm run build, then compare), or raise the limit on purpose in scripts/check-budget.mjs.'); process.exit(1); }
console.log('\nAll sizes are within budget.');
