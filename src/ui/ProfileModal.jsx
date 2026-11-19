// The signed-in person's profile: email, change password, log out.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { useEffect, useState } from "react";
import { P } from "../theme.js";
import { Icon } from "./Icon.jsx";

/* The signed-in person's profile: who they are, change password, log out. While a password is being saved nothing else can be pressed or closed. */
export function ProfileModal({ user, onClose }) {
  const [view, setView] = useState("main"); // "main" | "password"
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  const save = async (e) => {
    e.preventDefault();
    if (!cur) { setErr("Enter your current password."); return; }
    if (pw.length < 10) { setErr("The new password needs at least 10 characters."); return; }
    if (pw !== pw2) { setErr("The two new passwords do not match."); return; }
    if (pw === cur) { setErr("Choose a password different from the current one."); return; }
    setBusy(true); setErr("");
    try { await window.storage.changeOwnPassword(cur, pw); setCur(""); setPw(""); setPw2(""); setDone(true); setView("main"); }
    catch (ex) { setErr(String((ex && ex.message) || "The password could not be changed.")); }
    setBusy(false);
  };
  const logout = async () => { setBusy(true); try { await window.storage.signOut(); } catch { setBusy(false); } };
  const lock = { opacity: busy ? 0.55 : 1, cursor: busy ? "not-allowed" : "pointer" };
  return (
    <div className="yyc-modal-backdrop" onClick={() => { if (!busy) onClose(); }}>
      <div className="yyc-modal" role="dialog" aria-modal="true" aria-label="Your profile" style={{ width: 400, maxWidth: "94vw", padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <span className="yyc-avatar" style={{ width: 44, height: 44, fontSize: 18 }}>{(user.email || "?").charAt(0).toUpperCase()}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 750, overflowWrap: "anywhere", lineHeight: 1.3 }}>{user.email}</div>
            <div style={{ fontSize: 12.5, color: P.sub, marginTop: 2 }}>{user.isAdmin ? "Admin" : "Viewer"}</div>
          </div>
          <button className="yyc-btn-secondary" style={{ padding: "5px 9px", ...lock }} onClick={onClose} disabled={busy} aria-label="Close"><Icon name="close" size={13} /></button>
        </div>

        {view === "main" ? (
          <div style={{ display: "grid", gap: 10 }}>
            {done && <div role="status" style={{ fontSize: 13, color: P.greenText, fontWeight: 650 }}>Your password was changed.</div>}
            <button className="yyc-btn-secondary" style={{ justifyContent: "center", ...lock }} disabled={busy} onClick={() => { setDone(false); setErr(""); setView("password"); }}>
              <Icon name="lock" size={14} /> Change password
            </button>
            <button className="yyc-btn-primary" style={{ justifyContent: "center", ...lock }} disabled={busy} onClick={logout}>
              <Icon name="arrowRight" size={14} /> {busy ? "Logging out…" : "Log out"}
            </button>
          </div>
        ) : (
          <form onSubmit={save}>
            <label style={{ fontSize: 12, fontWeight: 700, color: P.sub }}>Current password</label>
            <input className="yyc-input" type="password" autoComplete="current-password" autoFocus disabled={busy} value={cur} onChange={(e) => { setCur(e.target.value); setErr(""); }} style={{ margin: "5px 0 12px" }} />
            <label style={{ fontSize: 12, fontWeight: 700, color: P.sub }}>New password</label>
            <input className="yyc-input" type="password" autoComplete="new-password" disabled={busy} value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} style={{ margin: "5px 0 12px" }} />
            <label style={{ fontSize: 12, fontWeight: 700, color: P.sub }}>Type the new password again</label>
            <input className="yyc-input" type="password" autoComplete="new-password" disabled={busy} value={pw2} onChange={(e) => { setPw2(e.target.value); setErr(""); }} style={{ margin: "5px 0 6px" }} />
            <div style={{ fontSize: 12, color: P.faint, lineHeight: 1.5 }}>At least 10 characters.</div>
            {err && <div role="alert" style={{ color: P.redText, fontSize: 13, fontWeight: 600, marginTop: 10, lineHeight: 1.5 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className="yyc-btn-secondary" style={lock} disabled={busy} onClick={() => { setErr(""); setView("main"); }}>Cancel</button>
              <button type="submit" className="yyc-btn-primary" style={lock} disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}