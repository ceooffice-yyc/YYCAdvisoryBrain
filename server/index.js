import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  console.error('Missing GROQ_API_KEY. Set it in .env (server-side only, no VITE_ prefix) and restart.');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '2mb' }));

// The browser posts the same {model, messages, ...} body it used to send straight
// to Groq. This just adds the Authorization header server-side, so the key never
// ships in the client bundle.
app.post('/api/groq/chat', async (req, res) => {
  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify(req.body),
    });
    const text = await upstream.text();
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) res.set('retry-after', retryAfter);
    res.status(upstream.status).type('application/json').send(text);
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
