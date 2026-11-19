// Vercel serverless function: the production twin of /api/groq/chat in server/index.js. All the rules (admins only, allowed model, size
// caps, rate limit, refusing to run without sign-in on a hosted site) live in server/groqHandler.js and are shared by both.
//
// Setup on Vercel: Project → Settings → Environment Variables → add GROQ_API_KEY and, optionally,
// GROQ_API_KEY_2, GROQ_API_KEY_3, GROQ_API_KEY_4 (Production + Preview), then redeploy.

import { handleGroq } from '../../server/groqHandler.js';

// A long document can take 20-40 s of model time; the default function limit (10 s) would cut it off.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const out = await handleGroq({ method: req.method, body: req.body, headers: req.headers || {} });
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  if (out.text !== undefined) return res.status(out.status).send(out.text);
  return res.status(out.status).json(out.body);
}
