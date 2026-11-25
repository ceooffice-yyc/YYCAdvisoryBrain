// The "Opening the document" window (shown while the document or the code of its window is on the way). It must never trap the person:
//   - Escape (handled in src/App.jsx), a click outside, or the Close button cancels it;
//   - after 8 seconds it says it is taking longer than usual and offers to reload the page (the address still points at the document, so reloading tries again).
import { useEffect, useState } from "react";
import { Icon } from "./Icon.jsx";
import { SkeletonLines } from "./Skeleton.jsx";

export function DocLoading({ onClose }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(timer); }, []);
  return (
    <div className="yyc-modal-backdrop" onClick={onClose}>
      <div className="yyc-modal" style={{ width: 840, maxWidth: "100%", padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button type="button" className="yyc-icon-btn" onClick={onClose} aria-label="Cancel opening the document"><Icon name="close" size={14} /></button>
        </div>
        <SkeletonLines rows={8} label="Opening the document" />
        {slow && (
          <div role="alert" className="yyc-docload-slow">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>This is taking longer than usual.</div>
            <div style={{ color: "var(--sub)", marginBottom: 12, lineHeight: 1.5 }}>Check your connection. You can wait, close this, or reload the page to try again.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="yyc-btn-primary" onClick={() => window.location.reload()}>Reload the page</button>
              <button type="button" className="yyc-btn-secondary" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
