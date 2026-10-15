// Vercel serverless function: the production twin of POST /api/ask in server/index.js (Ask the Brain, answered on the server).
// Uses the same environment variables as the rest of the app (SUPABASE_*, GROQ_API_KEY*, optional GEMINI_API_KEY, ASK_RATE_PER_MIN, ASK_LOG).

import { handleAsk } from '../server/ask/handler.js';

// retrieving + two AI calls normally take 3-10 s, but a queue for the shared per-minute AI budget can add more
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const out = await handleAsk({ method: req.method, body: req.body, headers: req.headers || {} });
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.status(out.status).json(out.body);
}
