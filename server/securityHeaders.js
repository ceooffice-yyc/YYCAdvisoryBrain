// The security headers sent with every response from the Express server (SEC-04). The hosted site (Vercel) sends the same set from vercel.json:
// keep the two in step.
//
// Content-Security-Policy, in plain words: scripts only from this site (no inline script, no eval); styles from this site and inline (the app
// styles its components inline); pictures from this site and embedded data; network calls only to this site and to Supabase (sign-in);
// nobody may put the site in a frame; forms and <base> cannot point elsewhere.

export function contentSecurityPolicy(env = process.env) {
  let supabase = 'https://*.supabase.co';
  try { const u = new URL(String(env.SUPABASE_URL || '').trim()); if (u.protocol === 'https:') supabase = u.origin; } catch { /* not configured: keep the general rule */ }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function securityHeaders(env = process.env) {
  return {
    'Content-Security-Policy': contentSecurityPolicy(env),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

/* Express middleware */
export function withSecurityHeaders(env = process.env) {
  const headers = securityHeaders(env);
  return (req, res, next) => { for (const [k, v] of Object.entries(headers)) res.setHeader(k, v); next(); };
}
