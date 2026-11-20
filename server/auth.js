// Sign-in check shared by /api/db and /api/groq/chat (Express server and Vercel functions).
//
// People sign in with Supabase Auth (email + password, accounts created by an admin in the Supabase dashboard) and the browser sends
// the session's access token as `Authorization: Bearer <token>`. This module asks Supabase who the token belongs to, so a forged,
// expired or revoked token is refused. Results are cached for a minute to avoid one extra round trip per request.
//
//   ADMIN_EMAILS            comma / space separated list of emails that are admins (and/or set app_metadata.role = "admin" in Supabase)
//   ALLOWED_EMAIL_DOMAINS   optional, e.g. yycadvisors.com : only addresses at these domains may use the app

import { createClient } from '@supabase/supabase-js';

const list = (v) => String(v || '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
const CACHE_MS = 60_000;
const cache = new Map(); // token -> { at, user }
let client = null;

export const authConfigured = (env = process.env) =>
  !!(String(env.SUPABASE_URL || '').trim() && String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim() && String(env.SUPABASE_ANON_KEY || '').trim());

const getClient = (env) => (client ||= createClient(String(env.SUPABASE_URL).trim(), String(env.SUPABASE_SERVICE_ROLE_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } }));

/* -> { ok: true, user: { id, email, isAdmin } } | { ok: false, status: 401 | 403, error } */
export async function authenticate(headers = {}, env = process.env, now = Date.now(), opts = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const m = /^Bearer\s+(.+)$/i.exec(String(h.authorization || ''));
  if (!m) return { ok: false, status: 401, error: 'Sign in required' };
  const token = m[1].trim();

  let user;
  const hit = opts.fresh ? null : cache.get(token); // opts.fresh: ask Supabase again (admin actions, "who am I" after a 403)
  if (hit && now - hit.at < CACHE_MS) user = hit.user;
  else {
    let res;
    try { res = await getClient(env).auth.getUser(token); } catch { return { ok: false, status: 401, error: 'Sign in required' }; }
    if (res.error || !res.data || !res.data.user) return { ok: false, status: 401, error: 'Your session has expired. Please sign in again.' };
    user = res.data.user;
    if (!(user.app_metadata && user.app_metadata.must_change_password)) cache.set(token, { at: now, user }); // a temporary password is checked afresh every time, so choosing a new one takes effect at once
    if (cache.size > 500) for (const [k, v] of cache) if (now - v.at >= CACHE_MS) cache.delete(k);
  }

  if (user.banned_until && new Date(user.banned_until).getTime() > now) return { ok: false, status: 403, error: 'This account has been disabled. Please contact your administrator.' }; // an admin disabled it in the Users tab
  if (user.app_metadata && user.app_metadata.pending) return { ok: false, status: 403, error: 'Your request is waiting for an administrator to approve it.' }; // asked for access, not approved yet
  if (!(user.email_confirmed_at || user.confirmed_at)) return { ok: false, status: 403, error: 'This email address has not been confirmed yet.' }; // an unverified address proves nothing about who this is
  const email = String(user.email || '').toLowerCase();
  const domains = list(env.ALLOWED_EMAIL_DOMAINS);
  if (domains.length && !domains.includes(email.split('@')[1] || '')) return { ok: false, status: 403, error: 'This account is not allowed to use the library.' };
  const isAdmin = list(env.ADMIN_EMAILS).includes(email) || (user.app_metadata && user.app_metadata.role === 'admin');
  const mustChange = !!(user.app_metadata && user.app_metadata.must_change_password);
  // A temporary password ends every session that existed before it was set: those tokens cannot be used to choose a new password for the person.
  const since = Number(user.app_metadata && user.app_metadata.must_change_since) || 0;
  if (mustChange && since && tokenIssuedAt(token) < since) return { ok: false, status: 401, error: 'Your session has ended. Please sign in again.' }; // signed in with a temporary password: only "choose a new password" is allowed until then
  if (mustChange && !opts.allowMustChange) return { ok: false, status: 403, error: 'Please choose a new password first.', code: 'must_change_password' };
  return { ok: true, user: { id: user.id, email, isAdmin: !!isAdmin, mustChangePassword: mustChange } };
}

/* When the session token was issued, in ms (the token was already verified by Supabase; an unreadable one counts as very old). */
function tokenIssuedAt(token) {
  try { const payload = JSON.parse(Buffer.from(String(token).split('.')[1] || '', 'base64url').toString('utf8')); return Number(payload.iat) * 1000 || 0; } catch { return 0; }
}

export const clearAuthCache = () => cache.clear(); // after an admin disables someone, so the next request sees it at once

export const _test = { cache, setClient: (c) => { client = c; } };
