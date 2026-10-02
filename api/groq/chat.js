// Vercel serverless function: the production twin of the Express proxy in server/index.js.
// The browser posts the same {model, messages, ...} body to /api/groq/chat; this adds the
// Authorization header server-side so GROQ_API_KEY never reaches the client bundle.
//
// Setup on Vercel: Project → Settings → Environment Variables → add GROQ_API_KEY
// (Production + Preview), then redeploy.

// A long document can take 20-40 s of model time; the default function limit (10 s) would cut it off.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'GROQ_API_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables and redeploy.',
    });
  }

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      // Vercel parses JSON bodies for us; fall back to the raw string if it did not
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
    });
    const text = await upstream.text();
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) res.setHeader('retry-after', retryAfter);
    res.status(upstream.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (err) {
    console.error('Groq proxy error:', err);
    res.status(502).json({ error: 'Upstream request to Groq failed' });
  }
}
