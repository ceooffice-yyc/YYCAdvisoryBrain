// The Users screen (admins): requests, accounts, activity.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { useCallback, useEffect, useState } from "react";
import { P, S } from "../theme.js";
import { SkeletonPage } from "../ui/Skeleton.jsx";

/* Admin: who can use the library. Nobody registers on their own: people ask for access, an admin approves, and the account is created either
   with an emailed link (EMAIL_INVITES=on) or with a one-time temporary password that the admin hands over (the default, no email needed). */
const TRAIL_TEXT = {
  request: (e) => `${e.target} asked for access`,
  invite: (e) => `${e.actor} invited ${e.target} as ${(e.detail && e.detail.role) || "viewer"}`,
  create: (e) => `${e.actor} created an account for ${e.target} as ${(e.detail && e.detail.role) || "viewer"}`,
  approve: (e) => `${e.actor} approved ${e.target}${e.detail && e.detail.role ? ` as ${e.detail.role}` : ""}`,
  reject: (e) => `${e.actor} rejected the request of ${e.target}`,
  role: (e) => `${e.actor} made ${e.target} ${(e.detail && e.detail.role) || "viewer"}`,
  disable: (e) => `${e.actor} disabled ${e.target}`,
  enable: (e) => `${e.actor} enabled ${e.target}`,
  reset: (e) => `${e.actor} sent a password reset email to ${e.target}`,
  reject_all: (e) => `${e.actor} rejected all ${(e.detail && e.detail.count) || 0} waiting requests`,
  temp_password: (e) => `${e.actor} set a temporary password for ${e.target}`,
  password_changed: (e) => `${e.target} chose a new password`,
};

/* The temporary password is shown ONCE, here. It is not stored anywhere the admin can look it up again. */
function TempPasswordModal({ info, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(info.password); setCopied(true); } catch { setCopied(false); } };
  return (
    <div className="yyc-modal-backdrop">
      <div className="yyc-modal" role="dialog" aria-modal="true" aria-label="Temporary password" style={{ width: 470, maxWidth: "94vw", padding: 24 }}>
        <div style={{ fontSize: 15.5, fontWeight: 750, marginBottom: 6 }}>Give this to {info.email}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 12 }}>This temporary password is shown only once. Pass it on privately (not in a group chat). They must choose their own password the first time they sign in.</div>
        <div style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 18, fontWeight: 700, letterSpacing: "0.04em", padding: "12px 14px", background: P.wash, border: `1px solid ${P.line}`, borderRadius: 10, wordBreak: "break-all", userSelect: "all" }}>{info.password}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button className="yyc-btn-secondary" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          <button className="yyc-btn-primary" onClick={onClose} autoFocus>I have passed it on</button>
        </div>
      </div>
    </div>
  );
}

export function UsersPanel({ flash, setConfirm }) {
  const [users, setUsers] = useState(null);
  const [emailInvites, setEmailInvites] = useState(false); // true when the server sends invite / reset emails
  const [reqs, setReqs] = useState([]);
  const [schemaMissing, setSchemaMissing] = useState(false); // the database is missing the latest schema.sql
  const [events, setEvents] = useState([]);
  const [err, setErr] = useState("");
  useEffect(() => { if (err) flash(err, "error"); }, [err, flash]); // errors appear as a toast, wherever the person has scrolled to
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [reqRole, setReqRole] = useState({}); // request id -> the role chosen when approving
  const [showTrail, setShowTrail] = useState(false);
  const [shown, setShown] = useState(null); // { email, password }: a temporary password to hand over
  const meId = window.storage?.user?.id;

  const load = useCallback(async () => {
    try {
      const [u, r, ev] = await Promise.all([window.db.usersList(), window.db.requestsList(), window.db.accountEvents()]);
      setUsers(u.users); setEmailInvites(u.emailInvites); setReqs(r.requests); setSchemaMissing(r.schemaMissing); setEvents(ev); setErr("");
      window.dispatchEvent(new Event("yyc-requests-changed")); // the badge on the Users tab follows
    } catch (e) { setErr(String((e && e.message) || "Could not load the users.")); setUsers((x) => x || []); }
  }, []);
  useEffect(() => { // first load; the answer is dropped if the tab was closed meanwhile
    let on = true;
    (async () => {
      try {
        const [u, r, ev] = await Promise.all([window.db.usersList(), window.db.requestsList(), window.db.accountEvents()]);
        if (on) { setUsers(u.users); setEmailInvites(u.emailInvites); setReqs(r.requests); setSchemaMissing(r.schemaMissing); setEvents(ev); }
      } catch (e) { if (on) { setErr(String((e && e.message) || "Could not load the users.")); setUsers([]); } }
    })();
    return () => { on = false; };
  }, []);

  // every action asks first, then reports what happened; a failure shows its reason on the page; a temporary password is shown once
  const ask = (title, message, confirmLabel, run, okText, danger = false) => setConfirm({
    title, message, confirmLabel, tone: danger ? "danger" : "primary",
    onConfirm: async () => {
      try { const out = await run(); if (out && out.password) setShown({ email: out.email, password: out.password }); flash(out && out.existing ? "That person already had an account, so the request is closed. The password they chose was not used." : okText); setErr(""); }
      catch (e) { setErr(String((e && e.message) || "That did not work.")); }
      await load();
    },
  });
  const roleWord = (r) => (r === "admin" ? "an admin" : "a viewer");
  const inviteByEmail = () => {
    const to = email.trim();
    if (!to) { setErr("Enter an email address."); return; }
    ask("Send an invite?", `An email with a link to set a password is sent to ${to}. They join as ${roleWord(role)}.`, "Send invite", async () => { const out = await window.db.userInvite(to, role); setEmail(""); return out; }, "Invite sent");
  };
  const createAccount = () => {
    const to = email.trim();
    if (!to) { setErr("Enter an email address."); return; }
    ask("Create this account?", `${to} gets an account as ${roleWord(role)}. You are shown a one-time temporary password to give them. They must choose their own at first sign-in.`, "Create account", async () => { const out = await window.db.userCreate(to, role); setEmail(""); return out; }, "Account created");
  };
  const decide = (r, decision, mode) => {
    const rl = reqRole[r.id] || "viewer";
    if (decision === "approve" && r.isOwner) ask(`Approve ${r.name || r.email} as an owner?`, `${r.email} is listed as an admin in the server settings, so this account will have full control whatever role you pick. Only another server-settings admin can approve it. Approve only if you are certain this person sent the request.`, "Approve owner account", () => window.db.requestDecide(r.id, "approve", rl, r.hasPassword || !emailInvites ? "password" : "email"), "Approved", true);
    else if (decision === "approve" && mode === "email") ask(`Approve ${r.name || r.email}?`, `An invite email is sent to ${r.email}. They join as ${roleWord(rl)}.`, "Approve and invite", () => window.db.requestDecide(r.id, "approve", rl, "email"), "Approved: invite sent");
    else if (decision === "approve" && r.hasPassword) ask(`Approve ${r.name || r.email}?`, `${r.email} can then sign in as ${roleWord(rl)} with the password they chose when they asked. No email is sent, and nobody has checked that the address is really theirs, so approve only if you know this person sent the request.`, "Approve", () => window.db.requestDecide(r.id, "approve", rl, "password"), "Approved: they can sign in now");
    else if (decision === "approve") ask(`Approve ${r.name || r.email}?`, `An account is created for ${r.email} as ${roleWord(rl)}. You are shown a one-time temporary password to give them. They must choose their own at first sign-in.`, "Approve and create account", () => window.db.requestDecide(r.id, "approve", rl, "password"), "Approved: account created");
    else ask(`Reject ${r.name || r.email}?`, `${r.email} is not given access. They are not contacted.`, "Reject", () => window.db.requestDecide(r.id, "reject"), "Request rejected", true);
  };
  const rejectAll = () => ask(`Reject all ${pending.length} waiting requests?`, "None of them is given access and nobody is contacted. Use this to clear a list filled with requests you do not recognise.", "Reject all", () => window.db.requestsRejectAll(), "All waiting requests rejected", true);
  const changeRole = (u) => {
    const next = u.role === "admin" ? "viewer" : "admin";
    ask(next === "admin" ? `Make ${u.email} an admin?` : `Make ${u.email} a viewer?`, next === "admin" ? "Admins can add, edit and delete library content, import backups, and manage people here." : "They keep reading the library and asking questions, but can no longer change it.", next === "admin" ? "Make admin" : "Make viewer", () => window.db.userSetRole(u.id, next), "Role changed", next === "viewer");
  };
  const toggleDisabled = (u) => {
    if (u.disabled) ask(`Enable ${u.email}?`, "They can sign in again.", "Enable", () => window.db.userSetDisabled(u.id, false), "Account enabled");
    else ask(`Disable ${u.email}?`, "They can no longer use the library, starting now. Nothing they wrote is deleted, and you can enable the account again at any time.", "Disable", () => window.db.userSetDisabled(u.id, true), "Account disabled", true);
  };
  const resetByEmail = (u) => ask(`Send a password reset to ${u.email}?`, "They get an email with a one-time link to choose a new password.", "Send reset email", () => window.db.userSendReset(u.id), "Reset email sent");
  const tempPassword = (u) => ask(`Set a temporary password for ${u.email}?`, "Their current password stops working. You are shown a one-time temporary password to give them, and they must choose their own at next sign-in.", "Set temporary password", () => window.db.userTempPassword(u.id), "Temporary password set", true);

  if (users === null) return <SkeletonPage variant="people" label="Loading the users" />;
  const pending = reqs.filter((r) => r.status === "pending");
  const people = users.filter((u) => !u.pending); // someone waiting for approval is a request, not a person yet
  const chip = (text, bg, fg) => <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: bg, color: fg, whiteSpace: "nowrap" }}>{text}</span>;
  const when = (x) => (x ? new Date(x).toLocaleString("en-MY") : "never");
  const small = { padding: "5px 10px", fontSize: 12 };
  const statusChip = (u) => (u.disabled ? chip("Disabled", P.redSoft, P.red) : u.mustChange ? chip("Temporary password, not changed yet", P.goldSoft, P.goldDark) : !u.accepted ? chip("Invited, not opened yet", P.goldSoft, P.goldDark) : chip("Active", P.greenSoft, P.green));

  return (
    <div>
      {shown && <TempPasswordModal info={shown} onClose={() => setShown(null)} />}
      <div className="yyc-section-head">
        <div>
          <h1 className="yyc-section-title">Users</h1>
          <div className="yyc-section-sub">Approve access requests or create accounts. Nobody can register on their own.</div>
        </div>
      </div>
      {schemaMissing && <div role="alert" style={{ ...S.card, padding: "12px 16px", marginBottom: 12, borderColor: P.gold, background: P.goldSoft, fontSize: 13.5, lineHeight: 1.55 }}><b>The database needs one update.</b> People cannot send access requests until you paste the latest <code>supabase/schema.sql</code> into Supabase → SQL Editor and run it (it is safe to run again).</div>}

      <div style={{ ...S.card, padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}><div style={{ fontWeight: 750 }}>Access requests {pending.length ? <span style={{ marginLeft: 6 }}>{chip(`${pending.length} waiting`, P.goldSoft, P.goldText)}</span> : null}</div>{pending.length > 1 && <button className="yyc-btn-secondary" style={{ padding: "5px 10px", fontSize: 12, borderColor: P.red, color: P.redText }} onClick={rejectAll}>Reject all</button>}</div>
        {pending.length === 0 && <div style={{ fontSize: 13, color: P.sub }}>No requests are waiting.</div>}
        {pending.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 0", borderTop: `1px solid ${P.line}` }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 14, fontWeight: 650 }}>{r.name} <span style={{ fontWeight: 500, color: P.sub }}>· {r.email}</span></div>
              {r.note && <div style={{ fontSize: 12.5, color: P.sub, marginTop: 2, lineHeight: 1.45 }}>{r.note}</div>}
              <div style={{ fontSize: 11.5, color: P.faint, marginTop: 2 }}>asked {when(r.requested_at)}{r.hasPassword ? " · chose their own password" : ""}</div>
            </div>
            <select className="yyc-input" aria-label={`Role for ${r.email}`} value={reqRole[r.id] || "viewer"} onChange={(e) => setReqRole({ ...reqRole, [r.id]: e.target.value })} style={{ width: 110, padding: "6px 8px", fontSize: 13 }}>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
            {emailInvites && <button className="yyc-btn-primary" style={small} onClick={() => decide(r, "approve", "email")}>Approve (email invite)</button>}
            <button className={emailInvites ? "yyc-btn-secondary" : "yyc-btn-primary"} style={small} onClick={() => decide(r, "approve", "password")}>{emailInvites ? "Approve (temporary password)" : "Approve"}</button>
            <button className="yyc-btn-secondary" style={{ ...small, borderColor: P.red, color: P.redText }} onClick={() => decide(r, "reject")}>Reject</button>
          </div>
        ))}
      </div>

      <div style={{ ...S.card, padding: 18, marginBottom: 16 }}>
        <div style={{ fontWeight: 750, marginBottom: 10 }}>{emailInvites ? "Invite someone" : "Create an account"}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="yyc-input" type="email" placeholder="name@company.com" aria-label="Email for the new account" value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }} style={{ flex: 1, minWidth: 220 }} />
          <select className="yyc-input" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 120 }}>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          {emailInvites && <button className="yyc-btn-primary" onClick={inviteByEmail} disabled={!email.trim()}>Send invite email</button>}
          <button className={emailInvites ? "yyc-btn-secondary" : "yyc-btn-primary"} onClick={createAccount} disabled={!email.trim()}>{emailInvites ? "Create with temporary password" : "Create account"}</button>
        </div>
        <div style={{ fontSize: 12, color: P.faint, marginTop: 8 }}>Viewers read the library and ask questions. Admins can also change the library and manage people.</div>
      </div>

      <div style={{ ...S.card, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ padding: "14px 18px", fontWeight: 750 }}>People ({people.length})</div>
        {people.map((u) => (
          <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 18px", borderTop: `1px solid ${P.line}` }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 14, fontWeight: 650, wordBreak: "break-all" }}>{u.email}{u.id === meId ? <span style={{ fontWeight: 500, color: P.sub }}> (you)</span> : null}</div>
              <div style={{ fontSize: 11.5, color: P.faint, marginTop: 2 }}>last signed in {when(u.lastSignInAt)}</div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {u.role === "admin" ? chip("Admin", P.goldSoft, P.goldDark) : chip("Viewer", P.wash, P.sub)}
              {statusChip(u)}
            </div>
            {u.id !== meId && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {u.roleLocked
                  ? <span title="This admin is set in the server settings (ADMIN_EMAILS)" style={{ fontSize: 11.5, color: P.faint, alignSelf: "center" }}>set in server settings</span>
                  : <button className="yyc-btn-secondary" style={small} onClick={() => changeRole(u)}>{u.role === "admin" ? "Make viewer" : "Make admin"}</button>}
                {emailInvites && <button className="yyc-btn-secondary" style={small} onClick={() => resetByEmail(u)}>Send reset email</button>}
                <button className="yyc-btn-secondary" style={small} onClick={() => tempPassword(u)}>Temporary password</button>
                <button className="yyc-btn-secondary" style={{ ...small, ...(u.disabled ? {} : { borderColor: P.red, color: P.redText }) }} onClick={() => toggleDisabled(u)}>{u.disabled ? "Enable" : "Disable"}</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ ...S.card, overflow: "hidden" }}>
        <button className="yyc-btn-secondary" style={{ width: "100%", border: 0, borderRadius: 0, justifyContent: "space-between", padding: "14px 18px", fontWeight: 750 }} onClick={() => setShowTrail(!showTrail)} aria-expanded={showTrail}>
          <span>Activity ({events.length})</span><span style={{ color: P.faint }}>{showTrail ? "Hide" : "Show"}</span>
        </button>
        {showTrail && (events.length === 0
          ? <div style={{ padding: "0 18px 14px", fontSize: 13, color: P.sub }}>Nothing yet.</div>
          : events.map((e) => (
            <div key={e.id} style={{ padding: "9px 18px", borderTop: `1px solid ${P.line}`, fontSize: 13, lineHeight: 1.5 }}>
              {(TRAIL_TEXT[e.action] || ((x) => `${x.actor} ${x.action} ${x.target}`))(e)}
              <span style={{ color: P.faint }}> · {when(e.at)}</span>
            </div>
          )))}
      </div>
    </div>
  );
}