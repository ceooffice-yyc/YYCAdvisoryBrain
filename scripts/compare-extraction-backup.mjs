import fs from 'node:fs/promises';
import path from 'node:path';
import { splitClaim } from '../src/claim.js';

const baselinePath = path.resolve(process.argv[2] || 'C:/Users/VincentTeoKaiQi/Downloads/yyc-brain-backup-2026-10-19.json');
const currentPath = path.resolve(process.argv[3] || 'prompts/case-studies-folder-benchmark.json');
const reportPath = path.resolve(process.argv[4] || 'prompts/case-studies-baseline-vs-current.md');
const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
const current = JSON.parse(await fs.readFile(currentPath, 'utf8'));
const norm = (value) => String(value || '').toLowerCase()
  .replace(/\.docx$/i, '').replace(/^\s*\d+[.)_-]?\s*/, '').replace(/\s*-d\s*$/i, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const words = (value) => new Set(norm(value).split(' ').filter((x) => x.length > 1));
const overlap = (a, b) => {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const token of A) if (B.has(token)) common++;
  return common / (A.size + B.size - common);
};
const active = (record) => record.status !== 'deleted';
const currentByTitle = new Map(current.results.map((x) => [norm(x.title), x]));
const baselineDocs = baseline.docs.filter(active);
const rows = [];

for (const doc of baselineDocs) {
  const now = currentByTitle.get(norm(doc.title)) || current.results.find((x) => overlap(doc.title, x.title) >= 0.8);
  if (!now) {
    rows.push({ title: doc.title, missingRun: true, baselineCount: baseline.levers.filter((x) => active(x) && x.doc_id === doc.id).length });
    continue;
  }
  const oldRecords = baseline.levers.filter((x) => active(x) && x.doc_id === doc.id).map((x) => ({
    title: splitClaim(x.claim_en).name,
    text: x.claim_en,
    lever: x.lever,
    impact: x.impact || 'N/A',
  }));
  const newRecords = (now.records || []).map((x) => ({ ...x, title: x.title || '', text: `${x.title || ''}: ${x.description || ''}` }));
  const used = new Set();
  const matches = [];
  const oldOnly = [];
  for (const old of oldRecords) {
    let bestIndex = -1, bestScore = 0;
    newRecords.forEach((fresh, i) => {
      if (used.has(i)) return;
      const titleScore = overlap(old.title, fresh.title);
      const score = (norm(old.title) === norm(fresh.title) ? 2 : titleScore) + (old.lever === fresh.lever ? 0.15 : 0);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    });
    if (bestIndex >= 0 && bestScore >= 0.75) {
      used.add(bestIndex);
      const fresh = newRecords[bestIndex];
      matches.push({ old, fresh, exactTitle: norm(old.title) === norm(fresh.title), sameLever: old.lever === fresh.lever });
    } else oldOnly.push(old);
  }
  const newOnly = newRecords.filter((_, i) => !used.has(i));
  rows.push({
    title: doc.title,
    baselineCount: oldRecords.length,
    extractedCount: newRecords.length,
    exactTitleMatches: matches.filter((x) => x.exactTitle).length,
    similarTitleMatches: matches.filter((x) => !x.exactTitle).length,
    leverChanges: matches.filter((x) => !x.sameLever).map((x) => `${x.old.title || '(untitled)'}: ${x.old.lever} → ${x.fresh.lever}`),
    blankTitles: newRecords.filter((x) => !x.title.trim()).length,
    errors: now.status === 'error' ? [now.error] : [],
    baselineOnlyTitles: oldOnly.map((x) => x.title || '(untitled)'),
    extractedOnlyTitles: newOnly.map((x) => x.title || '(untitled)'),
  });
}

const totalOld = rows.reduce((n, x) => n + (x.baselineCount || 0), 0);
const totalNew = current.results.reduce((n, x) => n + (x.recordCount || 0), 0);
const totalExact = rows.reduce((n, x) => n + (x.exactTitleMatches || 0), 0);
const totalSimilar = rows.reduce((n, x) => n + (x.similarTitleMatches || 0), 0);
const lines = [
  '# Baseline vs current case study extraction',
  '',
  `Baseline: ${path.basename(baselinePath)} (${new Date(baseline.exported_at).toISOString()})`,
  `Current run: ${new Date(current.testedAtFinal || current.testedAt).toISOString()} (${current.results.length} case studies)`,
  '',
  `- Baseline active records: **${totalOld}**`,
  `- Current extracted records: **${totalNew}**`,
  `- Exact title matches: **${totalExact}**`,
  `- Similar title matches (Jaccard ≥ 0.60): **${totalSimilar}**`,
  '- Title matches are approximate record correspondence, not a hand-labeled accuracy score.',
  '',
  '| Case study | Baseline | Current | Exact titles | Similar titles | Blank titles |',
  '|---|---:|---:|---:|---:|---:|',
];
for (const row of rows) lines.push(`| ${row.title} | ${row.baselineCount ?? '—'} | ${row.extractedCount ?? (row.missingRun ? 'no run' : '—')} | ${row.exactTitleMatches ?? '—'} | ${row.similarTitleMatches ?? '—'} | ${row.blankTitles ?? '—'} |`);
lines.push('', '## Differences by case study', '');
for (const row of rows) {
  lines.push(`### ${row.title}`, '');
  if (row.errors?.length) lines.push(`- Extraction error: ${row.errors.join('; ')}`);
  if (row.baselineOnlyTitles?.length) lines.push(`- Baseline titles not matched: ${row.baselineOnlyTitles.map((x) => `\`${x}\``).join(', ')}`);
  if (row.extractedOnlyTitles?.length) lines.push(`- Current titles not matched: ${row.extractedOnlyTitles.map((x) => `\`${x}\``).join(', ')}`);
  if (row.leverChanges?.length) lines.push(`- Lever changes on matched titles: ${row.leverChanges.map((x) => `\`${x}\``).join(', ')}`);
  if (row.blankTitles) lines.push(`- Current records with no parsed title: ${row.blankTitles}`);
  if (!row.errors?.length && !row.baselineOnlyTitles?.length && !row.extractedOnlyTitles?.length && !row.leverChanges?.length && !row.blankTitles) lines.push('- No title or lever differences detected.');
  lines.push('');
}
await fs.writeFile(reportPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Compared ${rows.length} baseline documents; saved ${reportPath}`);
console.log(`Baseline ${totalOld} records → current ${totalNew}; exact title matches ${totalExact}; similar ${totalSimilar}.`);
