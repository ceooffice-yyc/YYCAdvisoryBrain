// Vercel serverless function: the production twin of the Express proxy in server/index.js.
// The browser posts the same {model, messages, ...} body to /api/groq/chat; this adds the
// Authorization header server-side so the keys never reach the client bundle, and falls over to the
// next key (GROQ_API_KEY_2, _3, ...) when one hits its rate limit.
//
// Setup on Vercel: Project → Settings → Environment Variables → add GROQ_API_KEY and, optionally,
// GROQ_API_KEY_2, GROQ_API_KEY_3, GROQ_API_KEY_4 (Production + Preview), then redeploy.

import { forwardToGroq, loadGroqKeys } from '../../server/groqProxy.js';

// A long document can take 20-40 s of model time; the default function limit (10 s) would cut it off.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const keys = loadGroqKeys();
  if (!keys.length) {
    return res.status(500).json({
      error: 'GROQ_API_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables and redeploy.',
    });
  }

  try {
    const { status, text, retryAfter } = await forwardToGroq(req.body, { keys });
    if (retryAfter) res.setHeader('retry-after', retryAfter);
    res.status(status).setHeader('Content-Type', 'application/json').send(text);
  } catch (err) {
    console.error('Groq proxy error:', err);
    res.status(502).json({ error: 'Upstream request to Groq failed' });
  }
}
