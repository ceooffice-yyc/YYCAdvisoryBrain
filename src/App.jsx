import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isLive, softDelete, uid } from "./lib/util.js";
import { BUILTIN_LEVER_DEFAULTS, setLeverOverrides, setOtherCatConfig } from "./lib/levers.js";
import { T } from "./i18n.js";
import { P, fontStack } from "./theme.js";
import { Icon } from "./ui/Icon.jsx";
import { GlobalStyles } from "./ui/GlobalStyles.jsx";
import { BrandMark } from "./ui/BrandMark.jsx";
import { CopyFallback } from "./ui/CopyFallback.jsx";
import { closeDoc, navigate, useRoute } from "./lib/route.js";
import { SkeletonLines, SkeletonPage } from "./ui/Skeleton.jsx";
import { ConfirmModal } from "./ui/ConfirmModal.jsx";
import { lazyScreen } from "./lazyScreen.js";
import { ScreenBoundary } from "./ui/ScreenBoundary.jsx";

// Each screen is downloaded the first time it is needed, so the first page only carries what it shows (PERF-01).
const KnowledgePanel = lazyScreen(() => import("./screens/KnowledgePanel.jsx"), "KnowledgePanel");
const ChatPanel = lazyScreen(() => import("./screens/ChatPanel.jsx"), "ChatPanel");
const ExplorerPanel = lazyScreen(() => import("./screens/ExplorerPanel.jsx"), "ExplorerPanel");
const GapPanel = lazyScreen(() => import("./screens/GapPanel.jsx"), "GapPanel");
const UsersPanel = lazyScreen(() => import("./screens/UsersPanel.jsx"), "UsersPanel");
const PreviewModal = lazyScreen(() => import("./screens/PreviewModal.jsx"), "PreviewModal");
const AdminGate = lazyScreen(() => import("./ui/AdminGate.jsx"), "AdminGate");
const CommandPalette = lazyScreen(() => import("./ui/CommandPalette.jsx"), "CommandPalette");
const ProfileModal = lazyScreen(() => import("./ui/ProfileModal.jsx"), "ProfileModal");
const SEARCH_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "") ? "⌘K" : "Ctrl K";
const PRELOAD = { chat: ChatPanel, explorer: ExplorerPanel, gap: GapPanel, users: UsersPanel }; // started when the pointer is over a tab

export default function App() {
  const [lang] = useState("en"); // [ZH disabled for now] was: const [lang, setLang] = useState("en");
  const route = useRoute(); // the tab, the open document and the filters live in the address (src/lib/route.js): Back works, a refresh keeps the place, links can be shared
  const tabRaw = route.tab;
  const setTab = useCallback((k) => navigate({ tab: k, doc: null, section: null }, { push: true }), []);
  useEffect(() => { // once the page is up and the browser is idle, fetch the small document window so opening a card is instant (not on a slow or data-saving connection)
    const c = navigator.connection;
    if (c && (c.saveData || /2g/.test(c.effectiveType || ""))) return undefined;
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const id = idle(() => PreviewModal.preload());
    return () => cancel(id);
  }, []);
  const [kbWorking, setKbWorking] = useState(false); // an extraction / save is running inside the Knowledge Base tab
  const kbWorkingRef = useRef(false);
  const [, setRoleTick] = useState(0); // bumps to redraw when the signed-in person's role changed
  const [demoteHeld, setDemoteHeld] = useState(false); // demoted while unsaved work is open: the page stays until they leave it
  const lastRoleCheck = useRef(0);
  const [adminOn, setIsAdmin] = useState(!!(window.storage?.remote && window.storage.user?.isAdmin)); // with sign-in, admin accounts are admins as soon as they log in
  // Admin now = the role says so, unless a demotion is being held back while unsaved work is open. An admin-only tab that is no longer allowed shows the Knowledge Base.
  const isAdmin = adminOn && !(demoteHeld && !kbWorking);
  const [config, setConfig] = useState(null);
  const [index, setIndex] = useState([]);
  const [levers, setLevers] = useState([]);
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null); // the document that was loaded for route.doc: { doc, targetRecordId }
  const recordTarget = useRef(null);
  const [gateOpen, setGateOpen] = useState(false);
  const signedUser = window.storage?.remote ? window.storage.user : null; // { id, email, isAdmin } when the shared database is on
  const isGuest = !!(window.storage?.remote && !window.storage.user); // "continue as guest": may only browse the knowledge base and lever records
  // a tab the person may not use (an address typed or shared by someone with more access) shows the Knowledge Base instead
  const tab = (!isAdmin && (tabRaw === "gap" || tabRaw === "users")) || (isGuest && tabRaw === "chat") ? "kb" : tabRaw;
  useEffect(() => { window.scrollTo(0, 0); }, [tab]); // a newly opened tab starts at its top, not where the last one was scrolled to
  const [toasts, setToasts] = useState([]); // up to 3, oldest first: { id, msg, kind: "ok" | "error", leaving }
  const toastTimers = useRef(new Map());
  const toastSeq = useRef(0);
  const toastsRef = useRef([]);
  const [confirm, setConfirm] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false); // the signed-in person's profile window
  const [chatAll, setChatAll] = useState([]); // every message, deleted ones included
  const chatOkRef = useRef(false);
  const chatMsgs = useMemo(() => chatAll.filter(isLive), [chatAll]);
  // The chat panel works on the visible messages; anything it removes (Clear chat) is kept, marked deleted
  const setChatMsgs = useCallback((upd) => setChatAll((all) => {
    const liveNow = all.filter(isLive);
    const next = typeof upd === "function" ? upd(liveNow) : upd;
    const stamped = next.map((m) => (m.id ? m : { ...m, id: uid(), status: "active", at: Date.now() }));
    const keep = new Set(stamped.map((m) => m.id));
    const removed = liveNow.filter((m) => !keep.has(m.id)).map(softDelete);
    return [...all.filter((m) => !isLive(m)), ...removed, ...stamped];
  }), []);
  const [adminLocked, setAdminLocked] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const t = useMemo(() => {
    setOtherCatConfig(config?.otherCatOverrides, config?.customOtherCats);
    setLeverOverrides(config?.leverOverrides, config?.customLevers); // the lever definitions (built-in edits + custom levers) reach the extraction prompt and heading matcher
    const renamed = Object.fromEntries(Object.entries(config?.leverOverrides || {}).filter(([id, o]) => (BUILTIN_LEVER_DEFAULTS[id] || id === "others") && o && String(o.name || "").trim()).map(([id, o]) => [id, String(o.name).trim()]));
    return {
      ...T[lang],
      levers: {
        ...T[lang].levers,
        ...renamed,
        ...Object.fromEntries((config?.customLevers || []).map((lever) => [lever.id, lever.name])),
      },
      otherCats: {
        ...T[lang].otherCats,
        ...Object.fromEntries(Object.entries(config?.otherCatOverrides || {}).filter(([, o]) => o && String(o.name || "").trim()).map(([id, o]) => [id, String(o.name).trim()])),
        ...Object.fromEntries((config?.customOtherCats || []).map((c) => [c.id, c.name])),
      },
    };
  }, [lang, config]);
  // Short messages at the bottom of the screen, wherever the person has scrolled to (up to 3 at a time: the newest is the lowest, and when a 4th arrives the
  // oldest (top) one fades out to make room). kind "error" is red, stays longer, is announced to screen readers and can be dismissed. The same message again just stays longer.
  const FADE_MS = 220;
  const commitToasts = (list) => { toastsRef.current = list; setToasts(list); }; // the list lives in a ref too, so no timers are ever started inside a state updater
  const clearToastTimer = (id) => { clearTimeout(toastTimers.current.get(id)); toastTimers.current.delete(id); };
  const removeToast = useCallback((id) => { // fade out, then take it away
    clearToastTimer(id);
    if (!toastsRef.current.some((x) => x.id === id && !x.leaving)) return;
    commitToasts(toastsRef.current.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    toastTimers.current.set(id, setTimeout(() => { toastTimers.current.delete(id); commitToasts(toastsRef.current.filter((x) => x.id !== id)); }, FADE_MS));
  }, []);
  const flash = useCallback((msg, kind = "ok") => {
    const text = String(msg);
    const life = kind === "error" ? 9000 : 2600;
    const live = toastsRef.current.filter((x) => !x.leaving);
    const same = live.find((x) => x.msg === text && x.kind === kind);
    if (same) { clearToastTimer(same.id); toastTimers.current.set(same.id, setTimeout(() => removeToast(same.id), life)); return; }
    const id = ++toastSeq.current;
    commitToasts([...toastsRef.current, { id, msg: text, kind, leaving: false }]);
    toastTimers.current.set(id, setTimeout(() => removeToast(id), life));
    live.slice(0, Math.max(0, live.length + 1 - 3)).forEach((x) => removeToast(x.id)); // keep at most 3: the oldest (top) fade out to make room
  }, [removeToast]);
  useEffect(() => { kbWorkingRef.current = kbWorking; }, [kbWorking]);

  // Role changes while the page is open (an admin made someone a viewer, or the other way round, or disabled the account).
  // The server already refuses anything the person may no longer do; this makes the SCREEN follow within minutes, with a message instead of a confusing refusal.
  const checkRole = useCallback(async (fresh) => {
    const W = window.storage;
    if (!W?.remote || !W.user) return; // guests and the browser-only mode have no account
    lastRoleCheck.current = Date.now();
    const r = await W.refreshMe({ fresh });
    if (!window.storage?.user) return; // signed out meanwhile
    if (r.state === "ended") { window.dispatchEvent(new Event("yyc-auth-expired")); return; }
    if (r.state === "blocked") { window.dispatchEvent(new CustomEvent("yyc-auth-blocked", { detail: { message: r.error } })); return; }
    if (r.state !== "ok") return;
    const was = !!W.user.isAdmin, now = !!r.me.isAdmin;
    W.user = { ...W.user, ...r.me };
    setRoleTick((n) => n + 1);
    if (was === now) return;
    if (now) { setIsAdmin(true); setDemoteHeld(false); flash("Your access changed: you are now an Admin.", "ok"); return; }
    if (kbWorkingRef.current) { setDemoteHeld(true); flash("Your admin access has ended. Your open work stays on screen, but saving will be refused: copy what you need.", "error"); return; }
    setIsAdmin(false);
    flash("Your access changed: you are now a Viewer. Admin actions are no longer available.", "error");
  }, [flash]);
  useEffect(() => {
    if (!(window.storage?.remote && window.storage.user)) return undefined;
    const EVERY_MS = 5 * 60_000, MIN_GAP_MS = 2 * 60_000, FORCE_GAP_MS = 10_000;
    // quiet moments only: the tab is visible, and not more often than every couple of minutes (a few requests an hour per person)
    const maybe = () => { if (document.visibilityState === "visible" && Date.now() - lastRoleCheck.current > MIN_GAP_MS) checkRole(false); };
    const force = () => { if (Date.now() - lastRoleCheck.current > FORCE_GAP_MS) checkRole(true); }; // an admin-only action was refused: look at once, with a fresh answer
    const timer = setInterval(maybe, EVERY_MS);
    document.addEventListener("visibilitychange", maybe);
    window.addEventListener("focus", maybe);
    window.addEventListener("yyc-role-check", force);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", maybe); window.removeEventListener("focus", maybe); window.removeEventListener("yyc-role-check", force); };
  }, [checkRole]);
  useEffect(() => { // any part of the app can raise a toast with: window.dispatchEvent(new CustomEvent("yyc-toast", { detail: { msg, kind } }))
    const on = (e) => { if (e.detail && e.detail.msg) flash(e.detail.msg, e.detail.kind === "error" ? "error" : "ok"); };
    window.addEventListener("yyc-toast", on);
    const timers = toastTimers.current;
    return () => { window.removeEventListener("yyc-toast", on); timers.forEach(clearTimeout); timers.clear(); };
  }, [flash]);
  // The bottom-left button. With sign-in it is Log in (guest) / Log out (signed in); the SERVER decides who is an admin, so there is no
  // passcode. Without the shared database it stays "Unlock admin" with the passcode.
  const authLabel = window.storage?.remote ? (isGuest ? "Log in" : "Log out") : (isAdmin ? t.lockAdmin : t.unlockAdmin);
  const authBtnClick = () => {
    if (exitBlocked) { flash(t.exitBlocked); return; }
    if (window.storage?.remote) { if (isGuest) window.dispatchEvent(new Event("yyc-show-login")); else window.storage.signOut(); return; }
    if (isAdmin) setIsAdmin(false); else setGateOpen(true);
  };
  const exitBlocked = isAdmin && (adminLocked || confirm !== null || !!route.doc);
  const profileBlocked = exitBlocked || kbWorking || confirm !== null; // nothing in progress may be disturbed by opening the profile, changing the password or logging out
  const profileInitial = ((signedUser && signedUser.email) || "?").charAt(0).toUpperCase();

  useEffect(() => {
    (async () => {
      try {
        // Paint from the copy kept in this browser at once (shared database only), then replace it with the fresh copy
        const kept = window.storage?.remote ? window.db.peek() : null;
        if (kept) { setConfig(kept.config || {}); setIndex(kept.index); setLevers(kept.records); setReady(true); }
        // config, documents and lever records arrive in ONE request (it was usually already prefetched while the sign-in screen showed)
        const lib = await window.db.loadLibrary();
        setConfig(lib.config);
        setIndex(lib.index);
        setLevers(lib.records);
        /* [ZH disabled for now — English only] restore saved UI language
        const savedLang = await sget("ui:lang", false);
        if (savedLang) setLang(savedLang);
        */
        try { // the chat must not stop the library from loading, and is only saved back once it has been read successfully
          if (window.storage?.remote && !window.storage.user) throw new Error("guest: no chat"); // guests have no chat history
          const savedChat = await window.db.chatLoad();
          if (Array.isArray(savedChat) && savedChat.length) setChatAll(savedChat.map((m) => (m.id ? m : { ...m, id: uid(), status: "active" })));
          chatOkRef.current = true;
        } catch { chatOkRef.current = false; }
        setReady(true);
      } catch { setLoadErr(true); }
    })();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { setPreviewDoc(null); setGateOpen(false); setConfirm(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!ready || !chatOkRef.current) return;
    window.db.chatSave(chatAll).catch(() => { });
  }, [chatAll, ready]);

  // [ZH disabled for now — English only] language switcher handler
  // const switchLang = (l) => { setLang(l); sset("ui:lang", l, false).catch(() => { }); };

  // Opening a document adds a Back step; the window itself is drawn from the address (route.doc), so a shared link, a refresh and Back all work.
  const openPreview = useCallback((docId, targetSection, targetRecordId) => {
    recordTarget.current = targetRecordId || null;
    navigate({ doc: docId, section: targetSection || null }, { push: true });
  }, []);
  const closePreview = useCallback(() => closeDoc(), []);
  useEffect(() => {
    const id = route.doc;
    if (!id) return undefined;
    let live = true;
    window.db.getDocument(id).then((doc) => {
      if (!live) return;
      if (doc) setPreviewDoc({ doc, targetRecordId: recordTarget.current });
      else { flash("That document could not be found. It may have been deleted.", "error"); navigate({ doc: null, section: null }); }
    }).catch(() => {
      if (!live) return;
      flash("The document could not be opened. Check your connection and try again.", "error");
      navigate({ doc: null, section: null });
    });
    return () => { live = false; };
  }, [route.doc, flash]);

  const refreshKB = async () => {
    const kb = await window.db.loadKB();
    setIndex(kb.index);
    setLevers(kb.records);
  };

  const [waitingRequests, setWaitingRequests] = useState(0); // access requests waiting for an admin, shown as a badge on the Users tab
  useEffect(() => {
    if (!(isAdmin && window.storage?.remote)) return undefined;
    let on = true;
    const refresh = async () => { try { const r = await window.db.requestsList(); if (on) setWaitingRequests(r.requests.filter((x) => x.status === "pending").length); } catch { /* the badge is a convenience */ } };
    refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 90_000);
    window.addEventListener("yyc-requests-changed", refresh);
    return () => { on = false; clearInterval(timer); window.removeEventListener("yyc-requests-changed", refresh); };
  }, [isAdmin]);
  const navItems = [
    { key: "kb", icon: "book", label: t.tabs.kb },
    ...(isGuest ? [] : [{ key: "chat", icon: "chat", label: t.tabs.chat }]), // guests cannot use Ask the Brain
    { key: "explorer", icon: "scale", label: t.tabs.explorer },
    ...(isAdmin ? [{ key: "gap", icon: "alert", label: t.tabs.gap }] : []),
    ...(isAdmin && window.storage?.remote ? [{ key: "users", icon: "user", label: t.tabs.users, badge: waitingRequests }] : []), // accounts need the shared database
  ];

  if (loadErr) {
    return (
      <div style={{ background: P.paper, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: P.ink, fontFamily: fontStack, padding: 24, textAlign: "center" }}>
        <div>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: P.crimsonSoft, color: P.crimsonText, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Icon name="alert" size={26} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{T.en.loadErr}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="yyc-root" style={{ fontFamily: fontStack }}>
      <a className="skip-link" href="#yyc-main">Skip to the content</a>
      <GlobalStyles />
      {/* <div className="yyc-brandbar" /> */}

      <div className="yyc-shell">
        <aside className="yyc-sidebar">
          <div className="yyc-brand">
            <div className="yyc-brand-mark"><BrandMark size={42} /></div>
            <div className="yyc-brand-text">
              <div className="yyc-brand-name">{t.appTitle}</div>
              <div className="yyc-brand-sub">{t.appSub}</div>
            </div>
          </div>

          <button type="button" className="yyc-search-btn" onClick={() => setPalette(true)} aria-keyshortcuts="Control+K Meta+K">
            <Icon name="search" size={15} /><span className="yyc-search-btn-text">Search the library</span><kbd className="yyc-kbd">{SEARCH_KEY}</kbd>
          </button>

          <nav className="yyc-nav">
            <div className="yyc-nav-label">{t.workspace}</div>
            {navItems.map((item) => {
              const active = tab === item.key;
              return (
                <button key={item.key} className={`yyc-nav-item ${active ? "is-active" : ""}`} onClick={() => setTab(item.key)} onPointerEnter={() => PRELOAD[item.key]?.preload()} onFocus={() => PRELOAD[item.key]?.preload()}>
                  <span className="yyc-nav-ico"><Icon name={item.icon} size={17} /></span><span className="yyc-nav-text">{item.label}</span>{item.badge > 0 && <span className="yyc-nav-badge" aria-label={`${item.badge} waiting`}>{item.badge}</span>}{item.key === "kb" && kbWorking && <span className="yyc-spin" title="Extracting in the background…" style={{ marginLeft: "auto", width: 11, height: 11, borderRadius: "50%", border: "2px solid rgba(128,0,0,.25)", borderTopColor: P.maroon, display: "inline-block", flexShrink: 0 }} />}
                </button>
              );
            })}
          </nav>

          <div className="yyc-sidebar-foot">
            {/* [ZH disabled for now — English only] language switcher
            <div className="yyc-lang">
              {["en", "zh"].map((l) => (
                <button key={l} className={`yyc-lang-btn ${lang === l ? "is-active" : ""}`} onClick={() => switchLang(l)}>
                  {l === "en" ? "EN" : "中文"}
                </button>
              ))}
            </div>
            */}
            {signedUser ? (
              <button
                className="yyc-profile-btn"
                disabled={profileBlocked}
                title={profileBlocked ? "Finish the current action first." : "Your profile"}
                aria-haspopup="dialog"
                aria-label="Your profile"
                onClick={() => setProfileOpen(true)}
              >
                <span className="yyc-avatar">{profileInitial}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{signedUser.email}</span>
                  <span style={{ display: "block", fontSize: 11, color: P.sub, marginTop: 1 }}>{signedUser.isAdmin ? "Admin" : "Viewer"} · Profile</span>
                </span>
              </button>
            ) : (<>
            <button
              className={`yyc-admin-btn ${isAdmin ? "is-on" : ""}`}
              disabled={exitBlocked}
              title={exitBlocked ? t.exitBlocked : authLabel}
              onClick={authBtnClick}
              style={exitBlocked ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            >
              <Icon name={window.storage?.remote ? (isGuest ? "lock" : "unlock") : (isAdmin ? "unlock" : "lock")} size={13} />
              {authLabel}
            </button>
            {window.storage?.remote && (
              <div style={{ fontSize: 12, color: P.sub, margin: "8px 2px 0", lineHeight: 1.5, wordBreak: "break-all" }}>Guest · browse only</div>
            )}
            </>)}
            <div className="yyc-foot-note">{t.sharedNote}</div>
          </div>
        </aside>

        <main className="yyc-main" id="yyc-main" tabIndex={-1}>
          <header className="yyc-topbar">
            <div className="yyc-brand">
              <div className="yyc-brand-mark"><BrandMark size={42} /></div>
              <div className="yyc-brand-text">
                <div className="yyc-brand-name">{t.appTitle}</div>
                <div className="yyc-brand-sub">{t.appSub}</div>
              </div>
            </div>
            <div className="yyc-topbar-actions">
              <button type="button" className="yyc-icon-btn yyc-topbar-search" onClick={() => setPalette(true)} aria-label="Search the library"><Icon name="search" size={18} /></button>
              {/* [ZH disabled for now — English only] language switcher
              <div className="yyc-lang">
                {["en", "zh"].map((l) => (
                  <button key={l} className={`yyc-lang-btn ${lang === l ? "is-active" : ""}`} onClick={() => switchLang(l)}>
                    {l === "en" ? "EN" : "中"}
                  </button>
                ))}
              </div>
              */}
              {signedUser ? (
                <button
                className="yyc-profile-btn yyc-profile-compact"
                disabled={profileBlocked}
                title={profileBlocked ? "Finish the current action first." : "Your profile"}
                aria-haspopup="dialog"
                aria-label="Your profile"
                onClick={() => setProfileOpen(true)}
              >
                <span className="yyc-avatar">{profileInitial}</span>
              </button>
              ) : (
              <button
                className={`yyc-admin-btn ${isAdmin ? "is-on" : ""}`}
                disabled={exitBlocked}
                title={exitBlocked ? t.exitBlocked : authLabel}
                onClick={authBtnClick}
                style={exitBlocked ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
              >
                <Icon name={window.storage?.remote ? (isGuest ? "lock" : "unlock") : (isAdmin ? "unlock" : "lock")} size={13} />
                {window.storage?.remote ? <span style={{ marginLeft: 6 }}>{authLabel}</span> : null}
              </button>
              )}
            </div>
          </header>

          <div className="yyc-content">{/* no key={tab}: re-keying rebuilt every panel on each tab change and threw away a running extraction */}
            {!ready ? (
              <SkeletonPage label="Loading the library" />
            ) : (
              <>
                {/* Always mounted, only hidden: switching tabs must not discard a running extraction or an unsaved review */}
                <div className="yyc-fade" style={{ display: tab === "kb" ? "block" : "none" }}>
                  <ScreenBoundary><Suspense fallback={<SkeletonPage label="Loading the Knowledge Base" />}>
                  <KnowledgePanel
                    onWorking={setKbWorking}
                    t={t} lang={lang} isAdmin={isAdmin} index={index} levers={levers}
                    refreshKB={refreshKB} openPreview={openPreview} flash={flash}
                    config={config} setConfig={setConfig} setConfirm={setConfirm}
                    setAdminLocked={setAdminLocked}
                  />
                  </Suspense></ScreenBoundary>
                </div>
                {tab !== "kb" && (
                  <div className="yyc-fade" key={tab}>
                  <ScreenBoundary><Suspense fallback={<SkeletonPage variant={tab === "chat" ? "chat" : tab === "explorer" ? "explorer" : tab === "users" ? "people" : "log"} label="Loading" />}>
                  {tab === "chat" && (
                    <ChatPanel
                      t={t}
                      lang={lang}
                      index={index}
                      levers={levers}
                      openPreview={openPreview}
                      msgs={chatMsgs}
                      setMsgs={setChatMsgs}
                    />
                  )}
                  {tab === "explorer" && (
                    <ExplorerPanel t={t} levers={levers} index={index} openPreview={openPreview} isAdmin={isAdmin} config={config} setConfig={setConfig} setConfirm={setConfirm} setAdminLocked={setAdminLocked} flash={flash} refreshKB={refreshKB} />
                  )}
                  {tab === "gap" && isAdmin && <GapPanel t={t} flash={flash} setConfirm={setConfirm} />}
                  {tab === "users" && isAdmin && window.storage?.remote && <UsersPanel flash={flash} setConfirm={setConfirm} />}
                  </Suspense></ScreenBoundary>
                  </div>
                )}
              </>
            )}
          </div>

          <nav className="yyc-botnav">
            {navItems.map((item) => {
              const active = tab === item.key;
              return (
                <button key={item.key} className={`yyc-botnav-item ${active ? "is-active" : ""}`} title={item.label} aria-current={active ? "page" : undefined} onClick={() => setTab(item.key)} onTouchStart={() => PRELOAD[item.key]?.preload()}>
                  <Icon name={item.icon} size={20} /><span className="yyc-botnav-label">{item.label}</span>{item.badge > 0 && <span className="yyc-nav-badge" aria-label={`${item.badge} waiting`}>{item.badge}</span>}{item.key === "kb" && kbWorking && <span className="yyc-spin" title="Extracting in the background…" style={{ marginLeft: 4, width: 11, height: 11, borderRadius: "50%", border: "2px solid rgba(128,0,0,.25)", borderTopColor: P.maroon, display: "inline-block", flexShrink: 0 }} />}
                </button>
              );
            })}
          </nav>
        </main>
      </div>

      {/* The document window is drawn from the address. While the document is being fetched a plain placeholder shows; once it is here the window (which loads its own code) takes over,
          with the same placeholder while that code arrives. They are never on the page together. */}
      {route.doc && (previewDoc && previewDoc.doc.id === route.doc
        ? (
          <ScreenBoundary><Suspense fallback={<div className="yyc-modal-backdrop"><div className="yyc-modal" style={{ width: 840, maxWidth: "100%", padding: 24 }}><SkeletonLines rows={8} label="Opening the document" /></div></div>}>
            <PreviewModal key={`${route.doc}|${route.section || ""}`} t={t} lang={lang} data={{ doc: previewDoc.doc, targetSection: route.section, targetRecordId: previewDoc.targetRecordId }} levers={levers} index={index} onClose={closePreview} />
          </Suspense></ScreenBoundary>
        )
        : <div className="yyc-modal-backdrop"><div className="yyc-modal" style={{ width: 840, maxWidth: "100%", padding: 24 }}><SkeletonLines rows={8} label="Opening the document" /></div></div>)}
      {gateOpen && <ScreenBoundary><Suspense fallback={null}><AdminGate t={t} config={config} onOk={() => { setIsAdmin(true); setGateOpen(false); }} onClose={() => setGateOpen(false)} /></Suspense></ScreenBoundary>}
      {palette && (
        <ScreenBoundary><Suspense fallback={null}>
          <CommandPalette
            t={t} index={index} isAdmin={isAdmin} isGuest={isGuest}
            onClose={() => setPalette(false)}
            onTab={(id) => setTab(id)}
            onDoc={(id) => openPreview(id)}
            onLever={(id) => navigate({ tab: "kb", doc: null, section: null, kb: { lever: id } }, { push: true })}
          />
        </Suspense></ScreenBoundary>
      )}
      {profileOpen && signedUser && <ScreenBoundary><Suspense fallback={null}><ProfileModal user={signedUser} onClose={() => setProfileOpen(false)} /></Suspense></ScreenBoundary>}
      {confirm && <ConfirmModal {...confirm} onCancel={() => setConfirm(null)} onConfirm={() => { confirm.onConfirm(); setConfirm(null); }} />}
      <CopyFallback />
      {toasts.length > 0 && (
        <div className="yyc-toasts">
          {toasts.map((x) => (
            <div key={x.id} className={`yyc-toast${x.kind === "error" ? " is-error" : ""}${x.leaving ? " is-leaving" : ""}`} role={x.kind === "error" ? "alert" : "status"}>
              {x.kind === "error" ? <span className="yyc-toast-ico" aria-hidden="true"><Icon name="alert" size={14} /></span> : <div className="yyc-toast-dot" />}<span className="yyc-toast-msg">{x.msg}</span>
              {x.kind === "error" && <button type="button" className="yyc-toast-x" onClick={() => removeToast(x.id)} aria-label="Dismiss this message"><Icon name="close" size={13} /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
