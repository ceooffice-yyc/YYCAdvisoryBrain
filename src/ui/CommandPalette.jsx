// The Ctrl+K quick-jump box.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { useEffect, useMemo, useRef, useState } from "react";
import { P } from "../theme.js";
import { Icon } from "./Icon.jsx";

export function CommandPalette({ t, index, isAdmin, isGuest, onClose, onTab, onDoc, onLever }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const items = useMemo(() => [
    ...Object.entries(t.tabs)
      .filter(([k]) => (k !== "gap" || isAdmin) && (k !== "users" || (isAdmin && window.storage?.remote)) && !(k === "chat" && isGuest))
      .map(([k, label]) => ({ type: "tab", id: k, label, sub: "", badge: t.kbarPage })),
    ...Object.keys(t.levers).map((l) => ({ type: "lever", id: l, label: t.levers[l], sub: "", badge: t.kbarLever })),
    ...index.map((d) => ({
      type: "doc", id: d.id, label: d.title,
      sub: `${t.docTypes[d.doc_type] || d.doc_type}${d.industry ? " · " + d.industry : ""}`,
      badge: t.kbarDoc,
    })),
  ], [t, index, isAdmin, isGuest]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items.slice(0, 9);
    const terms = query.split(/\s+/).filter(Boolean);
    return items
      .map((it) => {
        const hay = (it.label + " " + it.sub).toLowerCase();
        if (!terms.every((w) => hay.includes(w))) return null;
        const score = hay.startsWith(query) ? 3 : it.label.toLowerCase().includes(query) ? 2 : 1;
        return { ...it, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 9);
  }, [q, items]);

  const [activeFor, setActiveFor] = useState(q);
  if (activeFor !== q) { setActiveFor(q); setActive(0); }

  const run = (it) => {
    if (!it) return;
    if (it.type === "tab") onTab(it.id);
    else if (it.type === "doc") onDoc(it.id);
    else if (it.type === "lever") onLever(it.id);
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(filtered[active]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div className="yyc-kbar-overlay" onClick={onClose}>
      <div className="yyc-kbar" onClick={(e) => e.stopPropagation()}>
        <div className="yyc-kbar-inputrow">
          <Icon name="search" size={15} color={P.faint} />
          <input
            ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
            placeholder={t.kbarPh} className="yyc-kbar-input"
          />
          <span className="yyc-kbar-kbd">esc</span>
        </div>
        <div className="yyc-kbar-list">
          {filtered.length === 0 ? (
            <div className="yyc-kbar-empty">{t.kbarEmpty}</div>
          ) : (
            filtered.map((it, i) => (
              <button
                key={it.type + it.id}
                className={`yyc-kbar-item ${i === active ? "is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(it)}
              >
                <span className="yyc-kbar-badge">{it.badge}</span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.label}
                  {it.sub && <span className="yyc-kbar-sub"> — {it.sub}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}