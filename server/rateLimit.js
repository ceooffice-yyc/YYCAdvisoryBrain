// A small sliding-window rate limiter kept in this server's memory (SEC-05).
// It stops bursts from one person or one address. On serverless hosting each running instance keeps its own counts, so treat the
// numbers as "per instance": it slows abuse down, it is not an exact global quota.

const buckets = new Map(); // "name|key" -> timestamps (ms)
const MAX_KEYS = 5000;
let sweptAt = 0;

/* -> 0 when allowed, else the seconds to wait. `max` hits per `windowMs` for this name + key. */
export function hit(name, key, max, windowMs = 60_000, now = Date.now()) {
  const id = `${name}|${key}`;
  const recent = (buckets.get(id) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { buckets.set(id, recent); return Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)); }
  recent.push(now);
  buckets.set(id, recent);
  sweep(now);
  return 0;
}

/* Would this caller be refused right now? Checks without counting a hit: used to turn an abuser away before doing any expensive work. */
export function waitFor(name, key, max, windowMs = 60_000, now = Date.now()) {
  const recent = (buckets.get(`${name}|${key}`) || []).filter((t) => now - t < windowMs);
  return recent.length >= max ? Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) : 0;
}

/* Forgets idle keys, at most once a minute, and never lets the table grow without limit: past the cap the oldest keys go first. */
function sweep(now) {
  if (buckets.size <= MAX_KEYS || now - sweptAt < 60_000) return;
  sweptAt = now;
  for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] >= 3_600_000) buckets.delete(k);
  if (buckets.size > MAX_KEYS * 2) { let extra = buckets.size - MAX_KEYS; for (const k of buckets.keys()) { if (extra-- <= 0) break; buckets.delete(k); } }
}

/* One person can own a whole IPv6 /64 (billions of addresses), so for limits an IPv6 address counts as its /64; an IPv4-mapped one as its IPv4. */
export function limitKey(ip) {
  const raw = String(ip || '').trim().replace(/%.*$/, '');
  if (!raw.includes(':')) return raw || 'unknown';
  const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  const [head, tail] = raw.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(8 - h.length - t.length, 0)).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => (g.toLowerCase().replace(/^0+(?=.)/, '') || '0')).join(':')}::/64`;
}

/* The caller's address as the hosting platform reports it (first entry of x-forwarded-for), for limits on requests with no sign-in. */
export function clientIp(headers = {}) {
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return limitKey(String(h['x-forwarded-for'] || h['x-real-ip'] || 'unknown').split(',')[0].trim() || 'unknown');
}

export const limitFrom = (env, name, fallback) => (Number(env[name]) > 0 ? Number(env[name]) : fallback);

export const _test = { buckets, reset: () => { buckets.clear(); sweptAt = 0; } };
