import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { createServer } from 'vite';
import { forwardToGroq, loadGroqKeys } from '../server/groqProxy.js';
import { splitClaim } from '../src/claim.js';

const folder = path.resolve(process.argv[2] || 'C:/Users/VincentTeoKaiQi/Downloads/case studies');
const onlyName = process.argv[3] || '';
const output = path.resolve(process.argv[4] || 'prompts/case-studies-folder-benchmark.json');
const files = (await fs.readdir(folder, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && !entry.name.startsWith('~$') && /\.docx$/i.test(entry.name))
  .filter((entry) => !onlyName || entry.name.toLowerCase().includes(onlyName.toLowerCase()))
  .map((entry) => path.join(folder, entry.name))
  .sort((a, b) => a.localeCompare(b));

if (!files.length) throw new Error(`No .docx files found in ${folder}`);
if (!loadGroqKeys().length) throw new Error('No server-side Groq keys are configured.');

const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.window = { storage: { authHeader: async () => ({}) } };
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://local.test');
  if (url.pathname === '/api/groq/chat' && (!init.method || init.method === 'GET')) {
    return new Response(JSON.stringify({ keys: loadGroqKeys().length }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.pathname === '/api/groq/chat' && init.method === 'POST') {
    const upstream = await forwardToGroq(JSON.parse(init.body), { fetchImpl: nativeFetch, log: () => {} });
    const headers = { 'content-type': 'application/json' };
    if (upstream.retryAfter) headers['retry-after'] = String(upstream.retryAfter);
    return new Response(upstream.text, { status: upstream.status, headers });
  }
  return nativeFetch(input, init);
};

const vite = await createServer({ configFile: path.resolve('vite.config.js'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { extractDocument } = await vite.ssrLoadModule('/src/App.jsx');
  const results = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const title = path.basename(file, '.docx').replace(/_+/g, ' ');
    process.stdout.write(`[${index + 1}/${files.length}] ${path.basename(file)} ... `);
    try {
      const [raw, rich] = await Promise.all([
        mammoth.extractRawText({ path: file }),
        mammoth.convertToHtml({ path: file }),
      ]);
      const extraction = await extractDocument(raw.value || '', title, [], (rich.value || '').slice(0, 150000));
      const records = (extraction.levers || []).map((record) => ({
        lever: record.lever,
        section: record.section || '',
        title: splitClaim(record.claim_en || '').name,
        description: splitClaim(record.claim_en || '').desc,
        impact: record.impact || 'N/A',
        other_category: record.other_category || '',
        related_to: record.related_to || '',
      }));
      results.push({ title, status: 'ok', doc_type: extraction.doc_type, sections: (extraction.sections || []).map((s) => s.heading), recordCount: records.length, records });
      process.stdout.write(`${records.length} records\n`);
    } catch (error) {
      results.push({ title, status: 'error', error: String(error?.message || error) });
      process.stdout.write(`ERROR: ${String(error?.message || error)}\n`);
    }
    await fs.writeFile(output, JSON.stringify({ testedAt: new Date().toISOString(), folder, totalFiles: files.length, results }, null, 2), 'utf8');
  }
  console.log(`Saved benchmark: ${output}`);
} finally {
  await vite.close();
}
