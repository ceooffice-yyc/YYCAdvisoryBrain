import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { forwardToGroq, loadGroqKeys } from './groqProxy.js';
import { handleDb, dbConfigured } from './db.js';
import { handleAsk } from './ask/handler.js';
import { authenticate } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GROQ_KEYS = loadGroqKeys();
if (!GROQ_KEYS.length) {
  console.error('Missing GROQ_API_KEY. Set it in .env (server-side only, no VITE_ prefix) and restart. Extra keys: GROQ_API_KEY_2, GROQ_API_KEY_3, ...');
  process.exit(1);
}
console.log(`Groq keys loaded: ${GROQ_KEYS.length} (the next one is used automatically when one hits its rate limit)`);

const app = express();
app.use(express.json({ limit: '4mb' }));

// The browser posts the same {model, messages, ...} body it used to send straight
// to Groq. This adds the Authorization header server-side, so the keys never ship in the
// client bundle, and moves on to the next key when one hits its rate limit.
// How many keys are configured: the browser sizes its per-minute budget and its parallel requests from this.
app.get('/api/groq/chat', (req, res) => res.json({ keys: GROQ_KEYS.length }));

app.post('/api/groq/chat', async (req, res) => {
  try {
    if (dbConfigured()) { // with Supabase the site requires sign-in, and so does the AI proxy
      const a = await authenticate(req.headers);
      if (!a.ok) return res.status(a.status).json({ error: a.error });
    }
    const { status, text, retryAfter } = await forwardToGroq(req.body, { keys: GROQ_KEYS });
    if (retryAfter) res.set('retry-after', retryAfter);
    res.status(status).type('application/json').send(text);
  } catch (err) {
    console.error('Groq proxy error:', err);
    res.status(502).json({ error: 'Upstream request to Groq failed' });
  }
});

// Shared database (Supabase). Without SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY the app keeps using each browser's own storage.
console.log(dbConfigured() ? 'Shared database + sign-in: Supabase (library data is stored online; people must sign in)' : 'Shared database: not configured (each browser keeps its own copy; see README → Supabase)');
app.all('/api/db', async (req, res) => {
  const out = await handleDb({ method: req.method, query: req.query, body: req.body, headers: req.headers });
  res.set('Cache-Control', 'no-store');
  res.status(out.status).json(out.body);
});

// Ask the Brain, answered on the server (search + AI + references): see server/ask/handler.js
app.post('/api/ask', async (req, res) => {
  const out = await handleAsk({ method: req.method, body: req.body, headers: req.headers });
  res.set('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(out.headers || {})) res.set(k, v);
  res.status(out.status).json(out.body);
});

// Production: serve the built SPA from the same process/origin as the API,
// so there's no separate static host and no CORS to configure.
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT || 8787;
// Loopback by default: in dev, only Vite (same machine) should reach this unauthenticated
// Groq proxy. Set HOST=0.0.0.0 in .env only when serving the built app to the LAN (npm start).
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error(`Could not start on ${HOST}:${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`YYC Library server listening on ${HOST}:${PORT}`);
});
