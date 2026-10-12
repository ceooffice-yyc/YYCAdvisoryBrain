import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { forwardToGroq, loadGroqKeys } from './groqProxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GROQ_KEYS = loadGroqKeys();
if (!GROQ_KEYS.length) {
  console.error('Missing GROQ_API_KEY. Set it in .env (server-side only, no VITE_ prefix) and restart. Extra keys: GROQ_API_KEY_2, GROQ_API_KEY_3, ...');
  process.exit(1);
}
console.log(`Groq keys loaded: ${GROQ_KEYS.length} (the next one is used automatically when one hits its rate limit)`);

const app = express();
app.use(express.json({ limit: '2mb' }));

// The browser posts the same {model, messages, ...} body it used to send straight
// to Groq. This adds the Authorization header server-side, so the keys never ship in the
// client bundle, and moves on to the next key when one hits its rate limit.
app.post('/api/groq/chat', async (req, res) => {
  try {
    const { status, text, retryAfter } = await forwardToGroq(req.body, { keys: GROQ_KEYS });
    if (retryAfter) res.set('retry-after', retryAfter);
    res.status(status).type('application/json').send(text);
  } catch (err) {
    console.error('Groq proxy error:', err);
    res.status(502).json({ error: 'Upstream request to Groq failed' });
  }
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
