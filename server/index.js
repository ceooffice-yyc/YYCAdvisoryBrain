import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadGroqKeys } from './groqProxy.js';
import { handleGroq } from './groqHandler.js';
import { handleDb, dbConfigured } from './db.js';
import { handleAsk } from './ask/handler.js';
import { withSecurityHeaders } from './securityHeaders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GROQ_KEYS = loadGroqKeys();
if (!GROQ_KEYS.length) {
  console.error('Missing GROQ_API_KEY. Set it in .env (server-side only, no VITE_ prefix) and restart. Extra keys: GROQ_API_KEY_2, GROQ_API_KEY_3, ...');
  process.exit(1);
}
console.log(`Groq keys loaded: ${GROQ_KEYS.length} (the next one is used automatically when one hits its rate limit)`);

const app = express();
app.disable('x-powered-by');
{ // behind a reverse proxy: so rate limits see the visitor's address. "1" = one proxy in front, "true" = trust all, or a list of addresses
  const tp = String(process.env.TRUST_PROXY || '').trim();
  if (tp) { try { app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? true : tp === 'false' ? false : tp); } catch (e) { console.error(`TRUST_PROXY="${tp}" is not valid and was ignored: ${e.message}`); } }
}
app.use(withSecurityHeaders());
app.use(express.json({ limit: '4mb' }));

const send = (res, out) => {
  for (const [k, v] of Object.entries(out.headers || {})) res.set(k, v);
  if (out.text !== undefined) return res.status(out.status).send(out.text);
  return res.status(out.status).json(out.body);
};

// The AI proxy used for document extraction: admins only, the app's model only, capped sizes (see server/groqHandler.js).
app.all('/api/groq/chat', async (req, res) => send(res, await handleGroq({ method: req.method, body: req.body, headers: req.headers, ip: req.ip }, { keys: GROQ_KEYS })));

// Shared database (Supabase). Without SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY the app keeps using each browser's own storage.
console.log(dbConfigured() ? 'Shared database + sign-in: Supabase (library data is stored online; people must sign in)' : 'Shared database: not configured (each browser keeps its own copy; see README → Supabase)');
app.all('/api/db', async (req, res) => {
  const out = await handleDb({ method: req.method, query: req.query, body: req.body, headers: req.headers, ip: req.ip });
  res.set('Cache-Control', 'no-store');
  send(res, out);
});

// Ask the Brain, answered on the server (search + AI + references): see server/ask/handler.js
app.all('/api/ask', async (req, res) => {
  const out = await handleAsk({ method: req.method, body: req.body, headers: req.headers, ip: req.ip });
  res.set('Cache-Control', 'no-store');
  send(res, out);
});

// Any other /api address does not exist: say so as JSON, never as a page.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Production: serve the built app from the same process/origin as the API, so there's no separate static host and no CORS to configure.
// Files with a content hash in their name never change, so browsers may keep them for a year; the page itself is always re-checked.
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath, {
  index: 'index.html',
  setHeaders: (res, file) => res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache'),
}));
// The app is one page at "/". Any other address is a real "not found": the 404 page, with a 404 status.
app.use((req, res) => {
  res.status(404).set('Cache-Control', 'no-store').sendFile(path.join(distPath, '404.html'), (err) => { if (err && !res.headersSent) res.type('text/plain').send('Page not found'); });
});

// A request body that is not valid JSON, or is too large: a clear JSON answer instead of a stack trace.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars -- Express recognises an error handler by its four arguments
  const status = err && (err.status || err.statusCode);
  if (status === 413) return res.status(413).json({ error: 'That request is too large.' });
  if (status >= 400 && status < 500) return res.status(400).json({ error: 'Bad request' });
  console.error('server error:', err && err.message);
  return res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 8787;
// Loopback by default: in dev, only Vite (same machine) should reach this server. Set HOST=0.0.0.0 in .env only when serving the built
// app to the LAN (npm start); without Supabase sign-in the AI proxy is then open to that network.
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error(`Could not start on ${HOST}:${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`YYC Library server listening on ${HOST}:${PORT}`);
});
