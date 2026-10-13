// Vercel serverless function: the shared-database endpoint (production twin of the /api/kv route in server/index.js).
// Setup on Vercel: Project → Settings → Environment Variables → add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// (Production + Preview), optionally ADMIN_PASSWORD, then redeploy. The service-role key stays on the server.

import { handleKv } from '../server/kvStore.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const out = await handleKv({ method: req.method, query: req.query || {}, body: req.body, headers: req.headers || {} });
  res.setHeader('Cache-Control', 'no-store');
  res.status(out.status).json(out.body);
}
