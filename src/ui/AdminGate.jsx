// The admin passcode box (browser-only mode).
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { useState } from "react";
import { P } from "../theme.js";
import { Icon } from "./Icon.jsx";

export function AdminGate({ t, config, onOk, onClose }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState(false);
  const tryUnlock = async () => {
    if (window.storage?.remote) { // shared database: the server checks the password and returns an admin session
      let ok;
      try { ok = await window.storage.login(pass); } catch { ok = false; }
      if (ok) onOk(); else setErr(true);
    } else if (pass === (config?.adminPass || "12345")) onOk();
    else setErr(true);
  };
  return (
    <div className="yyc-modal-backdrop" onClick={onClose}>
      <div className="yyc-modal" style={{ width: 400, padding: 26 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: P.crimson, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="lock" size={18} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 750 }}>{t.passPrompt}</div>
        </div>
        <input type="password" value={pass} autoFocus
          onChange={(e) => { setPass(e.target.value); setErr(false); }}
          onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
          className="yyc-input"
          style={{ borderColor: err ? P.red : undefined }} />
        {err && <div style={{ color: P.redText, fontSize: 12.5, marginTop: 8, fontWeight: 600 }}>{t.passWrong}</div>}
        <div style={{ color: P.faint, fontSize: 12, marginTop: 12, lineHeight: 1.55 }}>{t.passNote}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 22 }}>
          <button className="yyc-btn-secondary" onClick={onClose}>{t.cancel}</button>
          <button className="yyc-btn-primary" onClick={tryUnlock}>{t.unlock}</button>
        </div>
      </div>
    </div>
  );
}