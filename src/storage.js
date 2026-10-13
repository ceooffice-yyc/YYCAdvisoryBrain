// window.storage for the app. Two backends behind the same interface:
//   • the shared database (Supabase, through the server's /api/kv) when the server reports it is configured. People must sign in with
//     Supabase Auth; every call carries their session token and the SERVER decides what they may do (see server/kvStore.js);
//   • this browser's localStorage otherwise (the original behaviour, no sign-in).
// Personal data that is not part of the library (UI hints) always stays in this browser.

const makeLocal = () => ({
  remote: false,
  async get(key) { const v = localStorage.getItem(key); if (v === null) throw new Error("not found"); return { key, value: v }; },
  async set(key, value) { localStorage.setItem(key, value); return { key, value }; },
  async delete(key) { localStorage.removeItem(key); return { key, deleted: true }; },
  async list(prefix) { return { keys: Object.keys(localStorage).filter((k) => !prefix || k.startsWith(prefix)) }; },
});

async function makeRemote(local, cfg) {
  const { createClient } = await import("@supabase/supabase-js"); // only loaded when sign-in is in use
  const auth = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const token = async () => { try { return (await auth.auth.getSession()).data.session?.access_token || ""; } catch { return ""; } };
  const authHeader = async () => { const t = await token(); return t ? { Authorization: `Bearer ${t}` } : {}; };
  const GUEST_KEY = "yyc:guest"; // "continue as guest" lasts for this browser tab only
  const isGuest = () => { try { return sessionStorage.getItem(GUEST_KEY) === "1"; } catch { return false; } };
  const setGuest = (on) => { try { on ? sessionStorage.setItem(GUEST_KEY, "1") : sessionStorage.removeItem(GUEST_KEY); } catch { /* private mode */ } };
  const shared = (key, sharedFlag) => sharedFlag !== false && key.startsWith("kb:");

  const call = async (method, { query = "", body } = {}) => {
    const res = await fetch(`/api/kv${query}`, {
      method,
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && !isGuest()) window.dispatchEvent(new Event("yyc-auth-expired")); // session ended: the app returns to the sign-in screen
    return { res, data };
  };
  const fail = (res, data) => { throw new Error((data && data.error) || `Shared database error (${res.status})`); };

  const storage = {
    remote: true,
    user: null, // { id, email, isAdmin }, filled in by loadMe() after sign-in
    authHeader,
    isGuest,
    setGuest,
    async get(key, sharedFlag) {
      if (!shared(key, sharedFlag)) return local.get(key);
      const { res, data } = await call("GET", { query: `?key=${encodeURIComponent(key)}` });
      if (res.status === 404) throw new Error("not found");
      if (!res.ok) fail(res, data);
      return { key, value: data.value };
    },
    async set(key, value, sharedFlag) {
      if (!shared(key, sharedFlag)) return local.set(key, value);
      const { res, data } = await call("PUT", { body: { key, value } });
      if (!res.ok) fail(res, data);
      return { key, value };
    },
    async delete(key, sharedFlag) {
      if (!shared(key, sharedFlag)) return local.delete(key);
      const { res, data } = await call("DELETE", { query: `?key=${encodeURIComponent(key)}` });
      if (!res.ok) fail(res, data);
      return { key, deleted: true };
    },
    async list(prefix) {
      const { res, data } = await call("GET", { query: `?prefix=${encodeURIComponent(prefix || "")}` });
      if (!res.ok) fail(res, data);
      return { keys: data.keys || [] };
    },
    // ── sign-in ──
    async hasSession() { return !!(await token()); },
    async loadMe() { // who am I, according to the server (also enforces ALLOWED_EMAIL_DOMAINS)
      const { res, data } = await call("GET", { query: "?action=me" });
      if (!res.ok) { storage.user = null; fail(res, data); }
      storage.user = data;
      return data;
    },
    async signIn(email, password) {
      const { error } = await auth.auth.signInWithPassword({ email: String(email).trim(), password });
      if (error) throw new Error(/invalid login/i.test(error.message) ? "Wrong email or password." : error.message);
      try { const me = await storage.loadMe(); setGuest(false); return me; } catch (e) { await auth.auth.signOut(); throw e; }
    },
    async signOut() { storage.user = null; try { await auth.auth.signOut(); } catch { /* already signed out */ } },
    onSignedOut(cb) { const { data } = auth.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") cb(); }); return () => data.subscription.unsubscribe(); },
  };
  return storage;
}

/* -> { mode: "local" | "supabase" | "error", error? }. Sets window.storage. */
export async function initStorage() {
  if (window.storage) return { mode: window.storage.remote ? "supabase" : "local" };
  const local = makeLocal();
  let status = null;
  for (let attempt = 0; attempt < 2 && !status; attempt++) {
    try {
      const res = await fetch("/api/kv?action=status");
      if (res.ok) status = await res.json();
      else if (res.status === 404 || res.status === 405) break; // no /api/kv here (e.g. a static host): local storage
    } catch { /* server not reachable yet: try once more */ }
  }
  if (status && status.mode === "supabase") {
    window.storage = await makeRemote(local, status);
    return { mode: "supabase", guest: !!status.guest };
  }
  window.storage = local;
  if (status && status.mode === "error") return { mode: "error", error: status.error };
  return { mode: "local" };
}
