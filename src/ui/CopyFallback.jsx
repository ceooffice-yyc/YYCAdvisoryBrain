// The last resort for copying (UX-01): when the browser refuses every way of copying, this window shows the text already selected, so the person can still press
// Ctrl+C (or hold and choose Copy on a phone). It opens on the "yyc-copy-manual" event sent by src/lib/clipboard.js.
import { useEffect, useRef, useState } from "react";

export function CopyFallback() {
  const [text, setText] = useState(null);
  const box = useRef(null);
  useEffect(() => {
    const open = (e) => setText(e.detail && typeof e.detail.text === "string" ? e.detail.text : "");
    window.addEventListener("yyc-copy-manual", open);
    return () => window.removeEventListener("yyc-copy-manual", open);
  }, []);
  useEffect(() => {
    if (text === null) return undefined;
    const el = box.current;
    if (el) { el.focus(); el.select(); }
    const onKey = (e) => { if (e.key === "Escape") setText(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [text]);
  if (text === null) return null;
  return (
    <div className="yyc-modal-backdrop" style={{ zIndex: 80 }} onClick={() => setText(null)}>
      <div className="yyc-modal" role="dialog" aria-modal="true" aria-label="Copy by hand" style={{ width: 520, maxWidth: "94vw", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 750, marginBottom: 6 }}>Copy it by hand</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 12, color: "var(--sub)" }}>
          Your browser did not allow copying from the page. The text is selected below: press <b>Ctrl+C</b> (on a phone, hold it and choose Copy).
        </div>
        <textarea ref={box} className="yyc-input" readOnly value={text} rows={9} aria-label="The text to copy" style={{ width: "100%", fontSize: 13, lineHeight: 1.5 }} onFocus={(e) => e.target.select()} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="yyc-btn-primary" onClick={() => setText(null)}>Done</button>
        </div>
      </div>
    </div>
  );
}
