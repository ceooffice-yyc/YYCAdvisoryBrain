// The "are you sure?" pop-up used for every action that needs a question first.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { P } from "../theme.js";
import { Icon } from "./Icon.jsx";

// A question before an action. Only `message` is needed; `title`, `details` (a list of lines), `confirmLabel`, `cancelLabel` and `tone` ("danger" or "primary") are optional, so the older calls look as they always did.
export function ConfirmModal({ message, title, details, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "danger", onCancel, onConfirm }) {
  const danger = tone !== "primary";
  return (
    <div className="yyc-modal-backdrop" onClick={onCancel}>
      <div className="yyc-modal" role="dialog" aria-modal="true" aria-label={title || message} style={{ width: 440, maxWidth: "94vw", padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 18 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: danger ? P.redSoft : P.goldSoft, color: danger ? P.redText : P.goldText, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name={danger ? "alert" : "check"} size={18} />
          </div>
          <div style={{ paddingTop: title ? 0 : 6 }}>
            {title && <div style={{ fontSize: 15.5, fontWeight: 750, marginBottom: 4 }}>{title}</div>}
            <div style={{ fontSize: 14, fontWeight: title ? 500 : 600, lineHeight: 1.5, whiteSpace: "pre-line" }}>{message}</div>
            {details && details.length > 0 && (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: P.sub }}>
                {details.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="yyc-btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className="yyc-btn-primary" style={danger ? { background: P.red } : undefined} onClick={onConfirm} autoFocus>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}