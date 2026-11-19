// Account management for the shared library: asking for access, inviting, roles, disabling, password resets, and the trail of who did what.
// Used by server/db.js (the /api/db operations). Everything takes the Supabase client (service role, server only) so it can be tested with a fake.
//
// How a new person gets in (nobody can self-register into the library):
//   1. they fill in "Request access" on the sign-in screen            -> a row in access_requests (public operation, rate limited)
//   2. an admin approves it in the Users tab, or invites someone directly  -> Supabase sends an invite email
//   3. the person opens the link, sets a password, and is in as a viewer (or admin, if the admin chose that)
//
//   ADMIN_EMAILS            admins set in server settings (cannot be changed in the app)
//   ALLOWED_EMAIL_DOMAINS   optional: only addresses at these domains can ask for access or be invited
//   EMAIL_INVITES           on = invite and reset EMAILS are used (needs company SMTP in Supabase). Anything else (the default) = accounts are
//                           created with a one-time temporary password that the admin hands over, and the person must change it at first sign-in.
//   SITE_URL                the public address of the site (e.g. https://yyc-advisory-brain.vercel.app): where invite and reset links lead.
//                           It must also be listed in Supabase → Authentication → URL Configuration → Redirect URLs.

import { randomInt } from 'node:crypto';

export class AccountError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => new AccountError(status, message);

const list = (v) => String(v || '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
export const normEmail = (v) => String(v || '').trim().toLowerCase();
export const validEmail = (e) => e.length <= 254 && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);
export const domainAllowed = (email, env = process.env) => { const d = list(env.ALLOWED_EMAIL_DOMAINS); return !d.length || d.includes(email.split('@')[1] || ''); };
const ROLES = ['viewer', 'admin'];
export const emailOn = (env = process.env) => String(env.EMAIL_INVITES || '').trim().toLowerCase() === 'on';
const NO_EMAIL = 'Email links are switched off (EMAIL_INVITES is not on). Create the account with a temporary password instead.';
const must = (res, what) => { if (res.error) throw fail(502, `${what} failed: ${res.error.message || res.error}`); return res.data; };
const nowIso = () => new Date().toISOString();

/* where invite and reset links lead: the configured address, else the page the admin is using */
export function siteUrl(env = process.env, headers = {}) {
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const pick = String(env.SITE_URL || '').trim() || String(h.origin || '').trim();
  return /^https?:\/\/[^\s]+$/i.test(pick) ? pick.replace(/\/+$/, '') + '/' : undefined;
}

/* The trail. Best effort: a failure to write it never blocks the action itself. */
export async function logEvent(sb, actor, action, target, detail = {}) {
  try { await sb.from('account_events').insert({ actor, action, target, detail }); } catch (e) { console.error('could not write the account trail:', e.message); }
}

/* ── people ── */
const isBanned = (u, now = Date.now()) => !!u.banned_until && new Date(u.banned_until).getTime() > now;

export async function listUsers(sb, env = process.env, now = Date.now()) {
  const admins = new Set(list(env.ADMIN_EMAILS));
  const users = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw fail(502, `Reading users failed: ${error.message}`);
    const got = (data && data.users) || [];
    users.push(...got);
    if (got.length < 200) break;
  }
  return users.map((u) => {
    const email = normEmail(u.email);
    const fromEnv = admins.has(email);
    return {
      id: u.id, email,
      role: fromEnv || (u.app_metadata && u.app_metadata.role === 'admin') ? 'admin' : 'viewer',
      roleLocked: fromEnv, // set in server settings: cannot be changed here
      disabled: isBanned(u, now),
      accepted: !!(u.email_confirmed_at || u.confirmed_at), // false = invited, link not opened yet
      mustChange: !!(u.app_metadata && u.app_metadata.must_change_password), // has a temporary password and has not chosen their own yet
      invitedAt: u.invited_at || null, lastSignInAt: u.last_sign_in_at || null, createdAt: u.created_at || null,
    };
  }).sort((a, b) => a.email.localeCompare(b.email));
}

async function findUser(sb, id) {
  const { data, error } = await sb.auth.admin.getUserById(String(id || ''));
  if (error || !data || !data.user) throw fail(404, 'That account was not found.');
  return data.user;
}

/* Sends an invite email. role: 'viewer' | 'admin'. */
export async function inviteUser(sb, env, actor, { email, role = 'viewer' }, headers = {}) {
  if (!emailOn(env)) throw fail(400, NO_EMAIL);
  const to = normEmail(email);
  if (!validEmail(to)) throw fail(400, 'Enter a valid email address.');
  if (!ROLES.includes(role)) throw fail(400, 'Choose viewer or admin.');
  if (!domainAllowed(to, env)) throw fail(400, 'That email address is not at a domain allowed to use the library.');
  if ((await listUsers(sb, env)).some((u) => u.email === to)) throw fail(409, 'That person already has an account.');
  const { data, error } = await sb.auth.admin.inviteUserByEmail(to, { redirectTo: siteUrl(env, headers) });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) throw fail(409, 'That person already has an account.');
    if (error.status === 429 || /rate limit/i.test(error.message)) throw fail(429, 'The email service is limited right now. Set up company email (SMTP) in Supabase, or try again later.');
    throw fail(502, `The invite could not be sent: ${error.message}`);
  }
  if (role === 'admin' && data && data.user) must(await sb.auth.admin.updateUserById(data.user.id, { app_metadata: { role: 'admin' } }), 'Setting the role');
  await logEvent(sb, actor.email, 'invite', to, { role });
  return { email: to, role };
}

/* ── accounts without email: a one-time temporary password ── */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes (0 O 1 l I)
export function makeTempPassword() {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return [part(), part(), part(), part()].join('-'); // about 90 bits
}

/* Creates the account, already confirmed, with a temporary password. The password is returned ONCE to the admin and is never stored or logged. */
export async function createUser(sb, env, actor, { email, role = 'viewer' }) {
  const to = normEmail(email);
  if (!validEmail(to)) throw fail(400, 'Enter a valid email address.');
  if (!ROLES.includes(role)) throw fail(400, 'Choose viewer or admin.');
  if (!domainAllowed(to, env)) throw fail(400, 'That email address is not at a domain allowed to use the library.');
  if ((await listUsers(sb, env)).some((u) => u.email === to)) throw fail(409, 'That person already has an account.');
  const password = makeTempPassword();
  const { error } = await sb.auth.admin.createUser({ email: to, password, email_confirm: true, app_metadata: { ...(role === 'admin' ? { role: 'admin' } : {}), must_change_password: true } });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) throw fail(409, 'That person already has an account.');
    throw fail(502, `The account could not be created: ${error.message}`);
  }
  await logEvent(sb, actor.email, 'create', to, { role });
  return { email: to, role, password };
}

/* A new temporary password for someone who forgot theirs (or whose password may be known to others). They must choose their own at the next sign-in. */
export async function tempPassword(sb, env, actor, { id }) {
  const target = await findUser(sb, id);
  const email = normEmail(target.email);
  if (target.id === actor.id) throw fail(400, 'You cannot reset your own password here. Use Forgot password, or ask another admin.');
  guardEnvAdmin(env, actor, email);
  const password = makeTempPassword();
  must(await sb.auth.admin.updateUserById(target.id, { password, app_metadata: { ...(target.app_metadata || {}), must_change_password: true } }), 'Setting the password');
  await logEvent(sb, actor.email, 'temp_password', email);
  return { email, password };
}

/* The person chooses their own password (the first sign-in after a temporary one). The server applies it and clears the flag. */
export async function setOwnPassword(sb, user, { password }) {
  const pw = typeof password === 'string' ? password : '';
  if (pw.length < 10) throw fail(400, 'Use at least 10 characters.');
  if (pw.length > 72) throw fail(400, 'Use 72 characters or fewer.');
  if (pw.trim().toLowerCase() === String(user.email || '').toLowerCase()) throw fail(400, 'The password cannot be your email address.');
  const target = await findUser(sb, user.id);
  must(await sb.auth.admin.updateUserById(target.id, { password: pw, app_metadata: { ...(target.app_metadata || {}), must_change_password: false } }), 'Saving the password');
  await logEvent(sb, normEmail(target.email), 'password_changed', normEmail(target.email));
  return {};
}

/* Everyone who is an admin right now (settings or role), by email */
const adminSet = (users) => new Set(users.filter((u) => u.role === 'admin' && !u.disabled).map((u) => u.email));

/* An admin set in the server settings (ADMIN_EMAILS) can only be disabled or have a password set by another such admin. */
function guardEnvAdmin(env, actor, targetEmail) {
  const owners = list(env.ADMIN_EMAILS);
  if (owners.includes(targetEmail) && !owners.includes(normEmail(actor.email))) throw fail(403, 'This admin is managed in the server settings. Only another server-settings admin can do that.');
}

export async function setRole(sb, env, actor, { id, role }) {
  if (!ROLES.includes(role)) throw fail(400, 'Choose viewer or admin.');
  const target = await findUser(sb, id);
  const email = normEmail(target.email);
  if (target.id === actor.id) throw fail(400, 'You cannot change your own role. Ask another admin.');
  if (list(env.ADMIN_EMAILS).includes(email)) throw fail(400, 'This admin is set in the server settings (ADMIN_EMAILS). Change it there.');
  if (role === 'viewer') {
    const left = adminSet(await listUsers(sb, env));
    left.delete(email);
    if (!left.size) throw fail(400, 'There must always be at least one admin.');
  }
  must(await sb.auth.admin.updateUserById(target.id, { app_metadata: { ...(target.app_metadata || {}), role } }), 'Changing the role');
  await logEvent(sb, actor.email, 'role', email, { role });
  return { email, role };
}

export async function setDisabled(sb, env, actor, { id, disabled }) {
  const target = await findUser(sb, id);
  const email = normEmail(target.email);
  if (target.id === actor.id) throw fail(400, 'You cannot disable your own account.');
  guardEnvAdmin(env, actor, email);
  if (disabled) {
    const left = adminSet(await listUsers(sb, env));
    left.delete(email);
    if (!left.size) throw fail(400, 'There must always be at least one active admin.');
  }
  must(await sb.auth.admin.updateUserById(target.id, { ban_duration: disabled ? '876000h' : 'none' }), disabled ? 'Disabling the account' : 'Enabling the account');
  await logEvent(sb, actor.email, disabled ? 'disable' : 'enable', email);
  return { email, disabled: !!disabled };
}

export async function sendReset(sb, env, actor, { id }, headers = {}) {
  if (!emailOn(env)) throw fail(400, NO_EMAIL);
  const target = await findUser(sb, id);
  const email = normEmail(target.email);
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: siteUrl(env, headers) });
  if (error) {
    if (error.status === 429 || /rate limit/i.test(error.message)) throw fail(429, 'The email service is limited right now. Set up company email (SMTP) in Supabase, or try again later.');
    throw fail(502, `The reset email could not be sent: ${error.message}`);
  }
  await logEvent(sb, actor.email, 'reset', email);
  return { email };
}

/* ── access requests ── */
const recentRequests = new Map(); // ip -> timestamps (per server instance)
const HOURLY_PER_IP = 5;
const HOURLY_TOTAL = 60;
const MAX_PENDING = 300;
let totalHits = [];

/* A public operation: no sign-in. It answers the same whether or not the address could ever be approved, so it cannot be used to find out who has an account. */
export async function createRequest(sb, env, { name, email, note }, ip = 'unknown', now = Date.now()) {
  const to = normEmail(email);
  const who = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!who || !validEmail(to)) throw fail(400, 'Enter your name and a valid work email.');

  const hits = (recentRequests.get(ip) || []).filter((t) => now - t < 3_600_000);
  totalHits = totalHits.filter((t) => now - t < 3_600_000);
  if (hits.length >= HOURLY_PER_IP || totalHits.length >= HOURLY_TOTAL) throw fail(429, 'Too many requests. Please try again later.');
  hits.push(now); totalHits.push(now);
  recentRequests.set(ip, hits);
  if (recentRequests.size > 2000) for (const [k, v] of recentRequests) if (!v.some((t) => now - t < 3_600_000)) recentRequests.delete(k);

  const done = { ok: true };
  if (!domainAllowed(to, env)) return done; // quietly ignored: the page shows the same message
  const pending = must(await sb.from('access_requests').select('id').eq('status', 'pending').limit(MAX_PENDING + 1), 'Reading requests');
  if (pending.length > MAX_PENDING) throw fail(429, 'Too many pending requests. Please contact your administrator.');
  const dup = must(await sb.from('access_requests').select('id').eq('status', 'pending').eq('email', to).limit(1), 'Reading requests');
  if (dup.length) return done;
  must(await sb.from('access_requests').insert({ email: to, name: who, note: String(note || '').trim().slice(0, 500) || null }), 'Saving the request');
  await logEvent(sb, to, 'request', to, { name: who });
  return done;
}

export async function listRequests(sb) {
  const rows = must(await sb.from('access_requests').select('id,email,name,note,status,requested_at,decided_by,decided_at').order('requested_at', { ascending: false }).limit(200), 'Reading requests');
  return rows.sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
}

export async function decideRequest(sb, env, actor, { id, decision, role = 'viewer', mode }, headers = {}) {
  if (!['approve', 'reject'].includes(decision)) throw fail(400, 'Choose approve or reject.');
  const rows = must(await sb.from('access_requests').select('*').eq('id', String(id || '')).limit(1), 'Reading the request');
  const req = rows[0];
  if (!req) throw fail(404, 'That request was not found.');
  if (req.status !== 'pending') throw fail(409, `That request was already ${req.status}.`);
  let password;
  if (decision === 'approve') {
    try {
      if ((mode || (emailOn(env) ? 'email' : 'password')) === 'email') await inviteUser(sb, env, actor, { email: req.email, role }, headers);
      else password = (await createUser(sb, env, actor, { email: req.email, role })).password;
    } catch (e) { if (!(e instanceof AccountError && e.status === 409)) throw e; } // already has an account: the request is simply closed
  }
  must(await sb.from('access_requests').update({ status: decision === 'approve' ? 'approved' : 'rejected', decided_by: actor.email, decided_at: nowIso() }).eq('id', req.id), 'Saving the decision');
  await logEvent(sb, actor.email, decision, req.email, decision === 'approve' ? { role } : {});
  return { email: req.email, status: decision === 'approve' ? 'approved' : 'rejected', ...(password ? { password } : {}) };
}

export async function listEvents(sb, limit = 100) {
  return must(await sb.from('account_events').select('id,at,actor,action,target,detail').order('at', { ascending: false }).limit(Math.min(Math.max(Number(limit) || 100, 1), 300)), 'Reading the account trail');
}

export const _test = { recentRequests, resetLimits: () => { recentRequests.clear(); totalHits = []; } };
