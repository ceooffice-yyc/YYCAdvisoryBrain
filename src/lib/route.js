// The address bar as part of the app (UX-03). The tab, the open document and the filters live in the part of the address after the #, so:
//   - the Back and Forward buttons move between screens (tab changes and opening a document are steps; typing in a filter box is not),
//   - a refresh keeps the place,
//   - a link can be copied and sent: it opens the same document or the same filtered list.
// (the address is rewritten at once for a single change and at most every 0.2 s while typing)
// Examples:   #/explorer?lever=volume      #/library?lever=price&industry=Services&sort=az&q=fees      #/library?doc=d1&section=Pricing      #/ask
// The part after # never goes to the server, so no server setting is needed and unknown addresses still get the real 404 page.
// Everything read from the address is treated as untrusted text: it is checked, shortened, and anything unknown falls back to the default.
import { useSyncExternalStore } from "react";

export const TAB_SLUGS = { kb: "library", chat: "ask", explorer: "explorer", gap: "gaps", users: "users" };
const SLUG_TAB = Object.fromEntries(Object.entries(TAB_SLUGS).map(([tab, slug]) => [slug, tab]));
export const SORTS = ["oldest", "newest", "az", "levers"]; // "oldest" is the order the library has always had (the order materials were added)
export const KB_DEFAULTS = Object.freeze({ q: "", lever: "all", industry: "all", sub: "all", sort: "oldest" });
export const EXPLORER_DEFAULTS = Object.freeze({ lever: "price", industry: "all", cat: "all", q: "" });
export const defaultRoute = () => ({ tab: "kb", doc: null, section: null, kb: { ...KB_DEFAULTS }, explorer: { ...EXPLORER_DEFAULTS } });

const ID = /^[A-Za-z0-9_.-]{1,80}$/;
const LEVER = /^[a-z0-9_]{1,60}$/;
// no control characters, and never longer than the limit
const clean = (v, max) => Array.from(String(v == null ? "" : v)).filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127).join("").trim().slice(0, max);

/* "#/library?lever=price" -> a route object. Anything that does not check out is ignored. */
export function parseHash(hash) {
  const out = defaultRoute();
  const h = String(hash || "").replace(/^#/, "");
  if (!h) return out;
  const cut = h.indexOf("?");
  const slug = (cut < 0 ? h : h.slice(0, cut)).replace(/^\/+|\/+$/g, "").toLowerCase();
  let qs;
  try { qs = new URLSearchParams(cut < 0 ? "" : h.slice(cut + 1)); } catch { qs = new URLSearchParams(""); }
  out.tab = SLUG_TAB[slug] || "kb";
  const doc = qs.get("doc");
  if (doc && ID.test(doc)) { out.doc = doc; out.section = clean(qs.get("section"), 120) || null; }
  const pick = (key, test, max) => { const v = qs.get(key); return v != null && test(v) ? clean(v, max) : null; };
  if (out.tab === "kb") {
    const f = out.kb;
    f.lever = pick("lever", (v) => v === "all" || LEVER.test(v), 60) || f.lever;
    f.industry = pick("industry", (v) => clean(v, 80) !== "", 80) || f.industry;
    f.sub = pick("sub", (v) => clean(v, 80) !== "", 80) || f.sub;
    const sort = qs.get("sort"); if (SORTS.includes(sort)) f.sort = sort;
    f.q = clean(qs.get("q"), 200);
  } else if (out.tab === "explorer") {
    const f = out.explorer;
    f.lever = pick("lever", (v) => LEVER.test(v), 60) || f.lever;
    f.industry = pick("industry", (v) => clean(v, 80) !== "", 80) || f.industry;
    f.cat = pick("cat", (v) => LEVER.test(v) || v === "all", 60) || f.cat;
    f.q = clean(qs.get("q"), 200);
  }
  return out;
}

/* A route object -> "#/..." (settings that equal the default are left out, so addresses stay short; the plain first page has no hash at all). */
export function buildHash(r) {
  const p = new URLSearchParams();
  if (r.tab === "kb") {
    const f = { ...KB_DEFAULTS, ...r.kb };
    for (const k of ["lever", "industry", "sub", "sort"]) if (f[k] !== KB_DEFAULTS[k]) p.set(k, f[k]);
    if (f.q) p.set("q", f.q);
  } else if (r.tab === "explorer") {
    const f = { ...EXPLORER_DEFAULTS, ...r.explorer };
    for (const k of ["lever", "industry", "cat"]) if (f[k] !== EXPLORER_DEFAULTS[k]) p.set(k, f[k]);
    if (f.q) p.set("q", f.q);
  }
  if (r.doc) { p.set("doc", r.doc); if (r.section) p.set("section", r.section); }
  const qs = p.toString();
  if (r.tab === "kb" && !qs) return "";
  return `#/${TAB_SLUGS[r.tab] || "library"}${qs ? `?${qs}` : ""}`;
}

/* A link to a document (and a section in it) that anyone with access can open. */
export function docLink(id, section, base) {
  const origin = base != null ? base : (typeof location !== "undefined" ? location.origin + location.pathname : "");
  return `${origin}${buildHash({ tab: "kb", doc: id, section: section || null, kb: {}, explorer: {} })}`;
}

export function mergeRoute(prev, patch) {
  const next = { ...prev, ...patch };
  next.kb = { ...prev.kb, ...(patch.kb || {}) };
  next.explorer = { ...prev.explorer, ...(patch.explorer || {}) };
  return next;
}

// ── the live route: one value shared by the whole app, kept in step with the address bar ──
const inBrowser = typeof window !== "undefined" && typeof history !== "undefined" && typeof location !== "undefined";
let state = inBrowser ? parseHash(location.hash) : defaultRoute();
const subscribers = new Set();
let pendingWrite = null;
let lastWrite = 0;
let backPending = null; // while "go back one step" (closing a document) is still on its way, the next change waits for it, so the two cannot cross
const WRITE_GAP_MS = 200; // browsers limit how fast the address may be rewritten, so a burst of typing is written at most this often
const notify = () => subscribers.forEach((fn) => fn());

function writeUrl(push, docPushed) {
  if (!inBrowser) return;
  const url = location.pathname + location.search + buildHash(state);
  if (url === location.pathname + location.search + location.hash) return; // nothing to change: no duplicate step
  lastWrite = Date.now();
  try {
    if (push) history.pushState({ yyc: 1, docPushed: !!docPushed }, "", url);
    else history.replaceState({ yyc: 1, docPushed: !!(history.state && history.state.docPushed) }, "", url);
  } catch { /* a browser or frame that forbids it: the app works, only the address does not follow */ }
}
const flushPending = () => { if (pendingWrite) { clearTimeout(pendingWrite); pendingWrite = null; writeUrl(false); } };

/* Change the route. { push: true } adds a Back step (tab changes, opening a document); otherwise the current address is replaced, a moment later (typing in a box). */
export function navigate(patch, { push = false } = {}) {
  if (backPending) { backPending.queue.push([patch, { push }]); return; }
  const next = mergeRoute(state, patch);
  if (JSON.stringify(next) === JSON.stringify(state)) return;
  if (push) flushPending(); // the step we leave keeps what was typed
  state = next;
  notify();
  if (push) writeUrl(true, !!patch.doc);
  else if (!pendingWrite && Date.now() - lastWrite >= WRITE_GAP_MS) writeUrl(false); // a single change is written at once (a refresh right after it keeps it)
  else if (!pendingWrite) pendingWrite = setTimeout(() => { pendingWrite = null; writeUrl(false); }, WRITE_GAP_MS); // a burst: the latest state is written when the pause ends
}

/* Close the open document: if opening it added a Back step, go back one step (so Back does not reopen it); otherwise just remove it from the address. */
export function closeDoc() {
  if (inBrowser && history.state && history.state.docPushed && !backPending) {
    try {
      // going back finishes a moment later (the browser reports it with "popstate"); a change made in between waits, and is applied right after. If the browser never reports it, a short timer closes the document directly.
      backPending = { queue: [], timer: setTimeout(() => { const q = backPending ? backPending.queue : []; backPending = null; navigate({ doc: null, section: null }); q.forEach(([p, o]) => navigate(p, o)); }, 400) };
      history.back();
      return;
    } catch { if (backPending) { clearTimeout(backPending.timer); backPending = null; } }
  }
  navigate({ doc: null, section: null });
}
function settleBack() { if (!backPending) return; clearTimeout(backPending.timer); const q = backPending.queue; backPending = null; q.forEach(([p, o]) => navigate(p, o)); }

if (inBrowser) {
  const resync = () => { if (pendingWrite) { clearTimeout(pendingWrite); pendingWrite = null; } state = parseHash(location.hash); notify(); settleBack(); };
  window.addEventListener("popstate", resync);
  window.addEventListener("hashchange", resync);
}

export const getRoute = () => state;
export const subscribeRoute = (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); };
export const useRoute = () => useSyncExternalStore(subscribeRoute, getRoute, getRoute);
export const _test = { reset: () => { state = defaultRoute(); } };
