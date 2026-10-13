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
  const auth = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
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
      if (error) throw new Error(/invalid login/i.test(error.message) ? "Wrong email or password." : error.message);
      storage.hooks.signedIn(); // start loading the library while the server confirms who this is
      try { const me = await storage.loadMe(); setGuest(false); return me; } catch (e) { storage.hooks.signedOut(); await auth.auth.signOut(); throw e; }
    },
    async signOut() { storage.user = null; storage.hooks.signedOut(); try { await auth.auth.signOut(); } catch { /* already signed out */ } },
    onSignedOut(cb) { const { data } = auth.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") { storage.hooks.signedOut(); cb(); } }); return () => data.subscription.unsubscribe(); },
  };
  return storage;
}

/* -> { mode: "local" | "supabase" | "error", guest?, error? }. Sets window.storage and window.db. */
export async function initStorage() {
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
    return { mode: "supabase", guest: !!status.guest };
  }
  window.storage = local;
  installDb();
  if (status && status.mode === "error") return { mode: "error", error: status.error };
  return { mode: "local" };
}
