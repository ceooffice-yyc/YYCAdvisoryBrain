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

import { randomInt, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { hit } from './rateLimit.js';

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

const BAN = '876000h'; // "switched off": about 100 years
/* -> a message when the password is not acceptable, else '' */
export function passwordProblem(password, email = '') {
  const pw = typeof password === 'string' ? password : '';
  if (pw.length < 10) return 'Choose a password of at least 10 characters.';
  if (pw.length > 72) return 'Use 72 characters or fewer for the password.';
  if (pw.trim().toLowerCase() === String(email).toLowerCase()) return 'The password cannot be your email address.';
  return '';
}

/* ── people ── */
const isBanned = (u, now = Date.now()) => !!u.banned_until && new Date(u.banned_until).getTime() > now;

async function rawUsers(sb) {
  const users = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw fail(502, `Reading users failed: ${error.message}`);
    const got = (data && data.users) || [];
    users.push(...got);
    if (got.length < 200) break;
  }
  return users;
}

export async function listUsers(sb, env = process.env, now = Date.now()) {
  const admins = new Set(list(env.ADMIN_EMAILS));
  const users = await rawUsers(sb);
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
      pending: !!(u.app_metadata && u.app_metadata.pending), // asked for access with their own password; switched off until an admin approves
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
  guardEnvAdmin(env, actor, to); // an owner's account (and its temporary password) is only ever handed to another owner
  if ((await listUsers(sb, env)).some((u) => u.email === to)) throw fail(409, 'That person already has an account.');
  const password = makeTempPassword();
  const { error } = await sb.auth.admin.createUser({ email: to, password, email_confirm: true, app_metadata: { ...(role === 'admin' ? { role: 'admin' } : {}), must_change_password: true, must_change_since: Date.now() } });
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
  must(await sb.auth.admin.updateUserById(target.id, { password, app_metadata: { ...(target.app_metadata || {}), must_change_password: true, must_change_since: Date.now() } }), 'Setting the password');
  await logEvent(sb, actor.email, 'temp_password', email);
  return { email, password };
}

/* The person chooses their own password (the first sign-in after a temporary one). The server applies it and clears the flag. */
/* Is this really the account's current password? Asked of Supabase with the public key (never the service key), in a throwaway client. */
async function checkCurrentPassword(env, email, current) {
  const probe = createClient(String(env.SUPABASE_URL).trim(), String(env.SUPABASE_ANON_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await probe.auth.signInWithPassword({ email, password: current });
  return !error;
}

export async function setOwnPassword(sb, user, { password, current }, env = process.env, opts = {}) {
  // Someone signed in with a temporary password is already proving it. Everyone else must give the current password, so a borrowed
  // open session or a stolen token is not enough to take the account over.
  if (!user.mustChangePassword) {
    if (typeof current !== 'string' || !current) throw fail(400, 'Enter your current password.');
    if (hit('pw-check', user.id, 8, 900_000)) throw fail(429, 'Too many attempts. Please wait a few minutes.');
    if (!(await (opts.checkPassword || checkCurrentPassword)(env, user.email, current))) throw fail(400, 'Your current password is wrong.');
    if (current === password) throw fail(400, 'Choose a password different from the current one.');
  }
  const pw = typeof password === 'string' ? password : '';
  const problem = passwordProblem(pw, user.email || '');
  if (problem) throw fail(400, problem);
  if (user.mustChangePassword) { // "choosing" the temporary password again would change nothing
    if (hit('pw-check', user.id, 8, 900_000)) throw fail(429, 'Too many attempts. Please wait a few minutes.');
    if (await (opts.checkPassword || checkCurrentPassword)(env, user.email, pw)) throw fail(400, 'Choose a password different from the temporary one.');
  }
  const target = await findUser(sb, user.id);
  must(await sb.auth.admin.updateUserById(target.id, { password: pw, app_metadata: { ...(target.app_metadata || {}), must_change_password: false, must_change_since: null } }), 'Saving the password');
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
  if (typeof disabled !== 'boolean') throw fail(400, 'Choose disable or enable.');
  const target = await findUser(sb, id);
  const email = normEmail(target.email);
  if (target.id === actor.id) throw fail(400, 'You cannot disable your own account.');
  guardEnvAdmin(env, actor, email);
  if (disabled) {
    const left = adminSet(await listUsers(sb, env));
    left.delete(email);
    if (!left.size) throw fail(400, 'There must always be at least one active admin.');
  }
  if (target.app_metadata && target.app_metadata.pending) throw fail(400, 'This person is waiting for approval. Approve or reject their request instead.');
  must(await sb.auth.admin.updateUserById(target.id, { ban_duration: disabled ? BAN : 'none' }), disabled ? 'Disabling the account' : 'Enabling the account');
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
const HISTORY_ROWS = 50;
const STALE_DAYS = 30; // a request nobody decided in this time is closed, so old ones cannot fill the list for ever
const NO_COLUMN = /password_hash|schema cache|column/i;
let totalHits = [];
const isOwner = (email, env) => list(env.ADMIN_EMAILS).includes(normEmail(email));

/* Closes requests nobody decided within STALE_DAYS and erases any password hash that is still lying on a decided request. Best effort. */
async function tidyRequests(sb, now = Date.now()) {
  const cutoff = new Date(now - STALE_DAYS * 86_400_000).toISOString();
  try { await sb.from('access_requests').update({ status: 'rejected', decided_by: 'expired', decided_at: new Date(now).toISOString(), password_hash: null }).eq('status', 'pending').lt('requested_at', cutoff); } catch { /* tidying up is best effort */ }
  try { await sb.from('access_requests').update({ password_hash: null }).in('status', ['approved', 'rejected']).not('password_hash', 'is', null); } catch { /* the hash is not shown to anyone either way */ }
}

/* A public operation: no sign-in. It creates NO account: with emails off the person's chosen password is kept only as a bcrypt hash on the request
   (a server-only table) until an admin approves. So the form cannot be used to find out who has an account, to take an address, or to fill the
   sign-in system with junk accounts. */
export async function createRequest(sb, env, { name, email, note, password }, ip = 'unknown', now = Date.now()) {
  const to = normEmail(email);
  const who = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!who || !validEmail(to)) throw fail(400, 'Enter your name and a valid work email.');
  const ownPassword = !emailOn(env); // without email there is no link to set a password later, so the person chooses it now
  if (ownPassword) { const problem = passwordProblem(password, to); if (problem) throw fail(400, problem); }

  if (!domainAllowed(to, env)) { // said plainly: a request that vanished silently looked like a bug. Which addresses HAVE an account is still never revealed.
    const domains = list(env.ALLOWED_EMAIL_DOMAINS);
    throw fail(400, `Please use your work email address${domains.length ? ` (${domains.join(', ')})` : ''}.`);
  }
  const hits = (recentRequests.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (hits.length >= HOURLY_PER_IP) throw fail(429, 'Too many requests. Please try again later.');
  hits.push(now);
  recentRequests.set(ip, hits);
  if (recentRequests.size > 2000) for (const [k, v] of recentRequests) if (!v.some((t) => now - t < 3_600_000)) recentRequests.delete(k);
  // the shared hourly budget is checked BEFORE the slow hashing, so once it is spent a flood costs almost nothing
  totalHits = totalHits.filter((t) => now - t < 3_600_000);
  if (totalHits.length >= HOURLY_TOTAL) throw fail(429, 'Too many requests. Please try again later.');
  totalHits.push(now);

  // A hash is worked out for EVERY request (a throw-away one when there is nothing to keep), so the time taken says nothing about the address.
  // An owner address (ADMIN_EMAILS) still reaches the admins, flagged, but WITHOUT the stranger's password: an owner can only approve it by
  // creating the account with a temporary password they hand to the real person. A public form never sets an owner's password.
  const keep = ownPassword && !isOwner(to, env);
  const hash = await bcrypt.hash(keep ? password : randomBytes(18).toString('hex'), 10);
  const passwordHash = keep ? hash : null;
  const done = { ok: true };

  await tidyRequests(sb, now);
  const pending = must(await sb.from('access_requests').select('id').eq('status', 'pending').limit(MAX_PENDING + 1), 'Reading requests');
  if (pending.length > MAX_PENDING) throw fail(429, 'Too many pending requests. Please contact your administrator.');
  const dup = must(await sb.from('access_requests').select('id').eq('status', 'pending').eq('email', to).limit(1), 'Reading requests');
  if (dup.length) return done; // the first request stands: a second one cannot replace its password
  const saved = await sb.from('access_requests').insert({ email: to, name: who, note: String(note || '').trim().slice(0, 500) || null, password_hash: passwordHash });
  if (saved.error) {
    if (saved.error.code === '23505' || /duplicate key/i.test(saved.error.message || '')) return done; // two requests for one address at the same moment: the first stands
    if (NO_COLUMN.test(saved.error.message || '')) console.error('access_requests has no password_hash column: run the latest supabase/schema.sql in the Supabase SQL Editor.');
    throw fail(502, `Saving the request failed: ${saved.error.message}`);
  }
  await logEvent(sb, to, 'request', to, { name: who });
  return done;
}

/* The password hash never leaves the server: the list only says whether a request carries one. Waiting requests come first and are never crowded
   out by old decided ones. */
export async function listRequests(sb, env = process.env) {
  await tidyRequests(sb);
  const cols = 'id,email,name,note,status,requested_at,decided_by,decided_at';
  let schemaMissing = false;
  const read = async (shape, limit, filter) => {
    let res = await filter(sb.from('access_requests').select(`${cols},password_hash`)).order('requested_at', { ascending: false }).limit(limit);
    if (res.error && NO_COLUMN.test(res.error.message || '')) { // the latest schema.sql has not been run: list what exists and tell the admin
      schemaMissing = true;
      res = await filter(sb.from('access_requests').select(cols)).order('requested_at', { ascending: false }).limit(limit);
    }
    return must(res, shape);
  };
  const waiting = await read('Reading requests', MAX_PENDING + 1, (q) => q.eq('status', 'pending'));
  const decided = await read('Reading requests', HISTORY_ROWS, (q) => q.in('status', ['approved', 'rejected']));
  const requests = [...waiting, ...decided].map(({ password_hash: hash, ...r }) => ({ ...r, hasPassword: r.status === 'pending' && !!hash, isOwner: isOwner(r.email, env) }));
  return { requests, schemaMissing };
}

/* Puts a request back to waiting after a failed approval. A failure of this step is reported in the server log, never swallowed. */
async function reopen(sb, id) {
  try {
    const res = await sb.from('access_requests').update({ status: 'pending', decided_by: null, decided_at: null }).eq('id', id);
    if (res && res.error) console.error(`could not put request ${id} back to waiting: ${res.error.message}`);
  } catch (e) { console.error(`could not put request ${id} back to waiting: ${e.message}`); }
}

export async function decideRequest(sb, env, actor, { id, decision, role = 'viewer', mode }, headers = {}) {
  if (!['approve', 'reject'].includes(decision)) throw fail(400, 'Choose approve or reject.');
  const rows = must(await sb.from('access_requests').select('*').eq('id', String(id || '')).limit(1), 'Reading the request');
  const req = rows[0];
  if (!req) throw fail(404, 'That request was not found.');
  if (req.status !== 'pending') throw fail(409, `That request was already ${req.status}.`);
  const to = normEmail(req.email);
  let password;
  let activated = false;
  let existing = false;
  if (decision === 'approve') {
    if (!ROLES.includes(role)) throw fail(400, 'Choose viewer or admin.');
    guardEnvAdmin(env, actor, to); // only an owner may approve an address that is an owner in the server settings
    // Claim the request first: if two admins press at once (or one approves while the other rejects), only one of them gets past this line.
    const claimed = must(await sb.from('access_requests').update({ status: 'approved', decided_by: actor.email, decided_at: nowIso() }).eq('id', req.id).eq('status', 'pending').select('id'), 'Saving the decision');
    if (!claimed || !claimed.length) throw fail(409, 'That request was already decided.');
    try {
      const how = mode || (emailOn(env) ? 'email' : 'password');
      if (how === 'email') await inviteUser(sb, env, actor, { email: to, role }, headers);
      else if (req.password_hash && !isOwner(to, env)) { // an owner address never takes a password that came from a public form, even from an older request
        // the person chose their password when asking: the account is created now, from the stored hash, and they can sign in at once
        if (!domainAllowed(to, env)) throw fail(400, 'That email address is not at a domain allowed to use the library.');
        const known = (await rawUsers(sb)).find((u) => normEmail(u.email) === to);
        if (known && known.app_metadata && known.app_metadata.pending) { // an account left over from the first design (made when the person asked): switch it on
          must(await sb.auth.admin.updateUserById(known.id, { ban_duration: 'none', app_metadata: { ...(known.app_metadata || {}), pending: false, ...(role === 'admin' ? { role: 'admin' } : {}) } }), 'Switching the account on');
          activated = true;
        } else if (known) throw fail(409, 'That person already has an account.');
        else {
          const { error } = await sb.auth.admin.createUser({ email: to, password_hash: req.password_hash, email_confirm: true, app_metadata: role === 'admin' ? { role: 'admin' } : {} });
          if (error) { if (/already|registered|exists/i.test(error.message)) throw fail(409, 'That person already has an account.'); throw fail(502, `The account could not be created: ${error.message}`); }
          activated = true;
        }
      } else password = (await createUser(sb, env, actor, { email: to, role })).password;
    } catch (e) {
      if (!(e instanceof AccountError && e.status === 409)) { await reopen(sb, req.id); throw e; } // it did not work: put the request back so it can be tried again
      existing = true; // 409 = already has an account: the request is simply closed, and the admin is told the chosen password was not applied
    }
    try {
      const res = await sb.from('access_requests').update({ password_hash: null }).eq('id', req.id);
      if (res && res.error) console.error(`could not erase the password hash of request ${req.id}: ${res.error.message}`); // the next list or request clears it
    } catch { /* the hash is no longer needed */ }
  } else {
    const closed = must(await sb.from('access_requests').update({ status: 'rejected', decided_by: actor.email, decided_at: nowIso(), password_hash: null }).eq('id', req.id).eq('status', 'pending').select('id'), 'Saving the decision');
    if (!closed || !closed.length) throw fail(409, 'That request was already decided.');
    const left = (await rawUsers(sb)).find((u) => normEmail(u.email) === to && u.app_metadata && u.app_metadata.pending); // an account from the first design that was never approved
    if (left) { const del = await sb.auth.admin.deleteUser(left.id); if (del && del.error) console.error(`could not remove the waiting account of ${to}: ${del.error.message}`); }
  }
  await logEvent(sb, actor.email, decision, to, decision === 'approve' ? { role } : {});
  return { email: to, status: decision === 'approve' ? 'approved' : 'rejected', ...(password ? { password } : {}), ...(activated ? { activated: true } : {}), ...(existing ? { existing: true } : {}) };
}

/* Rejects every waiting request at once (for example after someone fills the list with junk). */
export async function rejectAllRequests(sb, actor) {
  const closed = must(await sb.from('access_requests').update({ status: 'rejected', decided_by: actor.email, decided_at: nowIso(), password_hash: null }).eq('status', 'pending').select('id'), 'Rejecting the requests');
  await logEvent(sb, actor.email, 'reject_all', null, { count: closed.length });
  return { rejected: closed.length };
}

/* The trail, newest first. Each row also says WHO acted as a name and an id (looked up from the accounts by the email the trail stores), so the Activity table can show "Name - id".
   If the accounts cannot be read, or the person no longer has an account, the row still comes back with the email only: reading the trail never fails because of the lookup. */
export async function listEvents(sb, limit = 100) {
  const events = must(await sb.from('account_events').select('id,at,actor,action,target,detail').order('at', { ascending: false }).limit(Math.min(Math.max(Number(limit) || 100, 1), 300)), 'Reading the account trail');
  if (!events.length) return events;
  let people = new Map();
  try {
    people = new Map((await rawUsers(sb)).map((u) => {
      const meta = u.user_metadata || {};
      return [normEmail(u.email), { id: u.id, name: String(meta.full_name || meta.name || '').trim().replace(/\s+/g, ' ').slice(0, 120) }];
    }));
  } catch (e) { console.error('could not look up the names for the trail:', e.message); }
  return events.map((e) => {
    const who = people.get(normEmail(e.actor));
    return { ...e, actorName: (who && who.name) || '', actorId: (who && who.id) || '' };
  });
}

export const _test = { recentRequests, resetLimits: () => { recentRequests.clear(); totalHits = []; } };
