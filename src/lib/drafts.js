// Drafts (DRAFT-01): unsaved work on the Review and Bulk screens is kept in THIS browser (localStorage), so a refresh, a crash or a lost connection
// does not throw it away. Nothing leaves the computer. One draft per signed-in account (or per browser when there is no sign-in), cleared when the work is
// saved or discarded, and forgotten after 7 days. Pure functions: the storage is passed in so they can be tested without a browser.

const VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CHARS = 2_500_000; // browsers allow about 5 million characters in all; the library copy and other settings need room too

export const draftKey = (owner) => `yyc:draft:v${VERSION}:${owner || "local"}`;
const defaultStore = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/* The same draft without the formatted (HTML) view of each document: much smaller, and the documents can still be read and saved as text. */
function lighter(draft) {
  if (draft.kind === "single") return { ...draft, html: "" };
  return { ...draft, items: (draft.items || []).map((x) => ({ ...x, html: "" })) };
}

/* -> { state: "saved" | "saved-light" | "too-big" | "failed" }. "too-big": even the light copy does not fit (the older draft is removed so it cannot mislead). */
export function saveDraft(owner, draft, { store = defaultStore(), now = Date.now() } = {}) {
  if (!store) return { state: "failed" };
  const key = draftKey(owner);
  const pack = (d, light) => JSON.stringify({ v: VERSION, at: now, light, draft: d });
  const tries = [[draft, false], [lighter(draft), true]];
  for (const [d, light] of tries) {
    let json;
    try { json = pack(d, light); } catch { return { state: "failed" }; }
    if (json.length > MAX_CHARS) continue;
    try { store.setItem(key, json); return { state: light ? "saved-light" : "saved", chars: json.length }; } catch { /* storage full: try the light copy */ }
  }
  try { store.removeItem(key); } catch { /* ignore */ }
  return { state: "too-big" };
}

/* -> { draft, at, light } or null. Anything unreadable, from another version, older than 7 days or of the wrong shape is removed and treated as no draft. */
export function loadDraft(owner, { store = defaultStore(), now = Date.now() } = {}) {
  if (!store) return null;
  const key = draftKey(owner);
  let raw;
  try { raw = store.getItem(key); } catch { return null; }
  if (raw === null || raw === undefined) return null;
  const drop = () => { try { store.removeItem(key); } catch { /* ignore */ } return null; };
  let o;
  try { o = JSON.parse(raw); } catch { return drop(); }
  if (!o || o.v !== VERSION || typeof o.at !== "number" || !o.draft || now - o.at > MAX_AGE_MS || o.at > now + 60_000) return drop();
  const d = o.draft;
  if (d.kind === "single") { if (!d.extraction || !Array.isArray(d.extraction.levers)) return drop(); }
  else if (d.kind === "bulk") { if (!Array.isArray(d.items) || !d.items.length || d.items.some((x) => !x || !x.id)) return drop(); }
  else return drop();
  return { draft: d, at: o.at, light: !!o.light };
}

export function clearDraft(owner, { store = defaultStore() } = {}) {
  if (!store) return;
  try { store.removeItem(draftKey(owner)); } catch { /* ignore */ }
}

/* Nothing runs after a refresh, so a file that was waiting or being extracted goes back to "ready" (the person presses Start again); finished results stay. */
export function restoreItems(items) {
  return (items || []).map((x) => (x.status === "pending" || x.status === "extracting" ? { ...x, status: "ready", include: x.include !== false } : { ...x, html: x.html || "" }));
}

/* One short line for the "restore?" banner. */
export function describeDraft(d) {
  if (d.kind === "single") return `Unsaved review: "${String((d.extraction && d.extraction.title) || d.title || "Untitled").slice(0, 80)}"`;
  const n = d.items.length, done = d.items.filter((x) => x.status === "done").length, err = d.items.filter((x) => x.status === "error").length;
  return `Unsaved bulk list: ${n} file${n === 1 ? "" : "s"}, ${done} extracted${err ? `, ${err} with errors` : ""}`;
}

export function ageLabel(at, now = Date.now()) {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}
