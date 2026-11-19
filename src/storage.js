// window.storage: this browser's localStorage (used for personal things such as UI hints, and for the whole library when no shared
// database is configured), plus, when the server reports a shared database (Supabase), the SIGN-IN: Supabase Auth sessions, guest mode,
// and the authenticated call to the server's /api/db. The library itself is read and written through src/db.js (window.db).
//
//   • no shared database  -> localStorage only, no sign-in (the original behaviour);
//   • shared database     -> people sign in with Supabase Auth (or continue as a guest, read-only); every call carries their session
//                            token and the SERVER decides what they may do (see server/db.js).

import { installDb } from "./db.js";

const makeLocal = () => ({
  remote: false,
  async get(key) { const v = localStorage.getItem(key); if (v === null) throw new Error("not found"); return { key, value: v }; },
  async set(key, value) { localStorage.setItem(key, value); return { key, value }; },
  async delete(key) { localStorage.removeItem(key); return { key, deleted: true }; },
  async list(prefix) { return { keys: Object.keys(localStorage).filter((k) => !prefix || k.startsWith(prefix)) }; },
});

async function makeRemote(local, cfg, sdk) {
  const { createClient } = sdk || (await import("@supabase/supabase-js")); // only loaded when sign-in is in use
  // A link that signs the browser in by itself is only honoured when the site sends such links (EMAIL_INVITES=on). Otherwise a crafted link
  // could quietly sign a person into someone else's account.
  const auth = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: !!cfg.emailInvites } });
  const token = async () => { try { return (await auth.auth.getSession()).data.session?.access_token || ""; } catch { return ""; } };
  const authHeader = async () => { const t = await token(); return t ? { Authorization: `Bearer ${t}` } : {}; };
  const GUEST_KEY = "yyc:guest"; // "continue as guest" lasts for this browser tab only
  const isGuest = () => { try { return sessionStorage.getItem(GUEST_KEY) === "1"; } catch { return false; } };
  const setGuest = (on) => { try { on ? sessionStorage.setItem(GUEST_KEY, "1") : sessionStorage.removeItem(GUEST_KEY); } catch { /* private mode */ } };

  const storage = {
    // personal, per-browser data (UI hints, ...) stays in this browser
    get: local.get, set: local.set, delete: local.delete, list: local.list,
    remote: true,
    user: null, // { id, email, isAdmin }, filled in by loadMe() after sign-in
    hooks: { signedIn() {}, signedOut() {} }, // set by src/db.js: start / drop its caches
    authHeader,
    isGuest,
    setGuest,
    /* One call to the server. -> { res, data }. `quiet` = do not treat a 401 as "your session ended" (background prefetch). */
    async api(method, { query = "", body, quiet = false } = {}) {
      const res = await fetch(`/api/db${query}`, {
        method,
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = null;
      try { data = await res.json(); } catch { /* empty body */ }
      if (res.status === 401 && !quiet && !isGuest()) window.dispatchEvent(new Event("yyc-auth-expired")); // session ended: back to the sign-in screen
      return { res, data };
    },

    // ── sign-in ──
    async hasSession() { return !!(await token()); },
    async loadMe() { // who am I, according to the server (also enforces ALLOWED_EMAIL_DOMAINS)
      const { res, data } = await storage.api("GET", { query: "?action=me" });
      if (!res.ok) { storage.user = null; throw new Error((data && data.error) || `Shared database error (${res.status})`); }
      storage.user = data;
      return data;
    },
    async signIn(email, password) {
      const { error } = await auth.auth.signInWithPassword({ email: String(email).trim(), password });
      if (error) throw new Error(/invalid login/i.test(error.message) ? "Wrong email or password." : /banned/i.test(error.message) ? "This account is not active. If you asked for access, an administrator still has to approve it; otherwise contact your administrator." : error.message);
      storage.hooks.signedIn(); // start loading the library while the server confirms who this is
      try { const me = await storage.loadMe(); setGuest(false); return me; } catch (e) { storage.hooks.signedOut(); await auth.auth.signOut(); throw e; }
    },
    // "Forgot password?": always the same answer, so it cannot be used to find out who has an account
    async sendReset(email) {
      const { error } = await auth.auth.resetPasswordForEmail(String(email).trim(), { redirectTo: window.location.origin + "/" });
      if (error && /rate limit|too many/i.test(error.message)) throw new Error("Too many emails were sent just now. Please try again in a few minutes.");
    },
    // the invite / reset link signs the person in for a moment; this sets the password they will use from now on
    async setPassword(password) {
      const { error } = await auth.auth.updateUser({ password });
      if (error) throw new Error(/same|different/i.test(error.message) ? "Choose a password you have not used before." : error.message);
    },
    // an invite / reset link with a token: exchange it for a session (this is the step that uses the link up)
    async verifyEmailLink(tokenHash, type) {
      const { error } = await auth.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) throw new Error(error.message || "The link could not be used.");
    },
    // the first sign-in with a temporary password: the server applies the new password and lifts the restriction
    async changePassword(password, current) {
      const email = storage.user && storage.user.email;
      const { res, data } = await storage.api("POST", { body: { op: "set_password", password, ...(current ? { current } : {}) }, quiet: true });
      if (!res.ok) throw new Error((data && data.error) || "Could not save the password.");
      // changing a password can end the sessions that were open; sign in again with the new one so the person simply carries on
      if (email) { try { await auth.auth.signInWithPassword({ email, password }); } catch { /* the next request will ask them to sign in */ } }
    },
    // Profile → Change password: the current password is checked first, so a borrowed open session cannot change it
    async changeOwnPassword(current, next) {
      if (!(storage.user && storage.user.email)) throw new Error("You are not signed in.");
      await storage.changePassword(next, current); // the SERVER checks the current password
    },
    // "Request access": a public call, no sign-in
    async requestAccess(fields) {
      const { res, data } = await storage.api("POST", { body: { op: "access_request", ...fields }, quiet: true });
      if (!res.ok) throw new Error((data && data.error) || "The request could not be sent. Please try again.");
    },
    async signOut() { storage.user = null; storage.hooks.signedOut(); try { await auth.auth.signOut(); } catch { /* already signed out */ } },
    onSignedOut(cb) { const { data } = auth.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") { storage.hooks.signedOut(); cb(); } }); return () => data.subscription.unsubscribe(); },
  };
  return storage;
}

/* -> { mode: "local" | "supabase" | "error", guest?, error? }. Sets window.storage and window.db. */
/* The invite and password-reset emails lead back here with #access_token=…&type=invite|recovery. Read what kind of link it was before the
   sign-in library removes it from the address, so the app can ask for a new password instead of opening the library. */
function readEmailLink() {
  try {
    const h = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
    const type = h.get("type");
    // the newer, safer link: ?token_hash=…&type=invite|recovery. Nothing is used up until the person presses Continue, so a mail scanner that opens the link first cannot spend it.
    const q = new URLSearchParams(window.location.search);
    const qType = q.get("type");
    const tokenHash = (qType === "invite" || qType === "recovery") && /^[A-Za-z0-9_-]{16,200}$/.test(q.get("token_hash") || "") ? q.get("token_hash") : null;
    return { link: type === "invite" || type === "recovery" ? type : null, linkError: h.get("error_description") || h.get("error") || "", tokenHash, tokenType: tokenHash ? qType : null };
  } catch { return { link: null, linkError: "", tokenHash: null, tokenType: null }; }
}

export async function initStorage() {
  const { link, linkError, tokenHash, tokenType } = readEmailLink();
  if (window.storage) { installDb(); return { mode: window.storage.remote ? "supabase" : "local" }; }
  const local = makeLocal();
  // a returning visitor (a saved sign-in exists): start loading the sign-in library code at the same time as the status check
  let hint = false;
  try { hint = Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)); } catch { /* ignore */ }
  const sdkPromise = hint ? import("@supabase/supabase-js").catch(() => null) : null;
  let status = null;
  for (let attempt = 0; attempt < 2 && !status; attempt++) {
    try {
      const res = await fetch("/api/db?action=status");
      if (res.ok) status = await res.json();
      else if (res.status === 404 || res.status === 405) break; // no /api/db here (e.g. a static host): local storage
    } catch { /* server not reachable yet: try once more */ }
  }
  if (status && status.mode === "supabase") {
    const remote = await makeRemote(local, status, sdkPromise ? await sdkPromise : null);
    window.storage = remote;
    installDb();
    // start loading the library NOW, while the sign-in screen is showing: a returning user has a session; a guest needs none
    remote.hasSession().then((has) => { if (has || status.guest) window.db.prefetch(); });
    return { mode: "supabase", guest: !!status.guest, emailInvites: !!status.emailInvites, link, linkError, tokenHash, tokenType };
  }
  window.storage = local;
  installDb();
  if (status && status.mode === "error") return { mode: "error", error: status.error };
  return { mode: "local" };
}
