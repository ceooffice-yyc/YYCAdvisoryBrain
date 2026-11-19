// A small sliding-window rate limiter kept in this server's memory (SEC-05).
// It stops bursts from one person or one address. On serverless hosting each running instance keeps its own counts, so treat the
// numbers as "per instance": it slows abuse down, it is not an exact global quota.

const buckets = new Map(); // "name|key" -> timestamps (ms)
const MAX_KEYS = 5000;

/* -> 0 when allowed, else the seconds to wait. `max` hits per `windowMs` for this name + key. */
export function hit(name, key, max, windowMs = 60_000, now = Date.now()) {
  const id = `${name}|${key}`;
  const recent = (buckets.get(id) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { buckets.set(id, recent); return Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)); }
  recent.push(now);
  buckets.set(id, recent);
  if (buckets.size > MAX_KEYS) for (const [k, v] of buckets) if (!v.some((t) => now - t < 3_600_000)) buckets.delete(k);
  return 0;
}

/* The caller's address as the hosting platform reports it (first entry of x-forwarded-for), for limits on requests with no sign-in. */
export function clientIp(headers = {}) {
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return String(h['x-forwarded-for'] || h['x-real-ip'] || 'unknown').split(',')[0].trim() || 'unknown';
}

export const limitFrom = (env, name, fallback) => (Number(env[name]) > 0 ? Number(env[name]) : fallback);

export const _test = { buckets, reset: () => buckets.clear() };
