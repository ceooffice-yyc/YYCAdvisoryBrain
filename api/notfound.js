// Vercel serverless function: any /api address that is not a real endpoint lands here (see the rewrite in vercel.json) and gets a JSON 404,
// the same answer the Express server gives.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(404).json({ error: 'Not found' });
}
