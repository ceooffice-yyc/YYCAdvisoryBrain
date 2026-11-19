// The Lever Explorer screen.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { useMemo, useState } from "react";
import { tokenizeQuery } from "../../server/ask/text.js";
import { P, S } from "../theme.js";
import { OTHER_CATS } from "../lib/levers.js";
import { LeverManagerModal } from "./LeverManagerModal.jsx";
import { ClaimText, ImpactBox } from "../ui/ClaimView.jsx";

export function ExplorerPanel({ t, levers, index, openPreview, isAdmin, config, setConfig, setConfirm, setAdminLocked, flash, refreshKB }) {
  const [showMgr, setShowMgr] = useState(false);
  const [sel, setSel] = useState("price");
  const [cat, setCat] = useState("all");
  const [oc, setOc] = useState("all");
  const [q, setQ] = useState("");

  const metaById = useMemo(() => Object.fromEntries(index.map((d) => [d.id, d])), [index]);
  const leverKeys = Object.keys(t.levers);
  const counts = useMemo(() => leverKeys.reduce((a, l) => { a[l] = levers.filter((r) => r.lever === l).length; return a; }, {}), [levers, leverKeys]);
  const cats = useMemo(
    () => Array.from(new Set(levers.map((r) => metaById[r.doc_id]?.industry_main).filter(Boolean))).sort(),
    [levers, metaById]
  );

  const records = useMemo(() => {
    const terms = tokenizeQuery(q);
    return levers.filter((r) => {
      if (r.lever !== sel) return false;
      const meta = metaById[r.doc_id];
      if (cat !== "all" && meta?.industry_main !== cat) return false;
      if (sel === "others" && oc !== "all" && (r.other_category || "misc") !== oc) return false;
      if (terms.length) {
        const hay = ((r.claim_en || "") + " " + (r.claim_zh || "") + " " + (r.quote || "") + " " + (r.impact || "") + " " + (r.related_to || "") + " " + (meta?.title || "")).toLowerCase();
        if (!terms.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }, [levers, sel, cat, oc, q, metaById]);

  const otherCounts = useMemo(() => {
    const c = {};
    levers.forEach((r) => { if (r.lever === "others") { const k = r.other_category || "misc"; c[k] = (c[k] || 0) + 1; } });
    return c;
  }, [levers]);

  const byDoc = useMemo(() => {
    const m = new Map();
    records.forEach((r) => { if (!m.has(r.doc_id)) m.set(r.doc_id, []); m.get(r.doc_id).push(r); });
    return Array.from(m.entries());
  }, [records]);

  return (
    <div>
      <div className="yyc-section-head">
        <div>
          <h1 className="yyc-section-title">{t.tabs.explorer}</h1>
          <div className="yyc-section-sub">{t.explorerIntro}</div>
        </div>
        {isAdmin && <button className="yyc-btn-secondary" onClick={() => setShowMgr(true)}>Manage lever categories</button>}
      </div>
      {showMgr && isAdmin && <LeverManagerModal t={t} config={config} setConfig={setConfig} setConfirm={setConfirm} setAdminLocked={setAdminLocked} flash={flash} refreshKB={refreshKB} onClose={() => setShowMgr(false)} />}

      {/* lever pills */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {leverKeys.map((l) => {
          const active = sel === l;
          const n = counts[l] || 0;
          return (
            <button key={l} className="yyc-pillbtn" onClick={() => { setSel(l); setOc("all"); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 999,
                border: `1px solid ${active ? P.crimson : P.lineDark}`, cursor: "pointer",
                background: active ? P.crimson : P.card, color: active ? "#fff" : n ? P.ink : P.faint,
                fontFamily: "inherit", fontSize: 13, fontWeight: active ? 700 : 600, transition: "all .15s",
              }}>
              {t.levers[l] || l}
              <span style={{
                fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: "1px 7px", fontVariantNumeric: "tabular-nums",
                background: active ? "rgba(255,255,255,0.22)" : n ? P.goldSoft : P.wash,
                color: active ? "#fff" : n ? P.goldText : P.faint,
              }}>{n}</span>
            </button>
          );
        })}
      </div>

      {sel === "others" && Object.keys(otherCounts).length > 0 && (
        <div className="yyc-chip-row" style={{ marginBottom: 16 }}>
          <span className="yyc-chip-row-label">{t.otherCat}</span>
          <button className={`yyc-lever-chip ${oc === "all" ? "is-active" : ""}`} onClick={() => setOc("all")}>{t.allOtherCats}</button>
          {OTHER_CATS.filter((k) => otherCounts[k]).map((k) => (
            <button key={k} className={`yyc-lever-chip ${oc === k ? "is-active" : ""}`} onClick={() => setOc(oc === k ? "all" : k)}>
              {t.otherCats[k]}
              <span className="yyc-lever-chip-count">{otherCounts[k]}</span>
            </button>
          ))}
        </div>
      )}

      {/* filters + stats */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <select value={cat} aria-label="Industry" onChange={(e) => setCat(e.target.value)} className="yyc-input" style={{ width: "auto", padding: "8px 12px", fontSize: 13 }}>
          <option value="all">{t.allMainCat}</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.explorerSearchPh} className="yyc-input" style={{ width: 220, padding: "8px 12px", fontSize: 13 }} />
        <span style={{ fontSize: 12.5, color: P.sub, fontWeight: 600 }}>
          {t.explorerStats.replace("{n}", String(records.length)).replace("{m}", String(byDoc.length))}
        </span>
      </div>

      {records.length === 0 ? (
        <div style={{ ...S.card, padding: 32, textAlign: "center", color: P.sub, fontSize: 14 }}>{t.explorerEmpty}</div>
      ) : (
        byDoc.map(([docId, recs]) => {
          const meta = metaById[docId] || {};
          return (
            <div key={docId} style={{ ...S.card, padding: 0, marginBottom: 14, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "13px 18px", borderBottom: `1px solid ${P.line}`, background: P.wash }}>
                <button onClick={() => openPreview(docId)}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 14.5, fontWeight: 750, color: P.maroonText, textAlign: "left" }}>
                  {meta.title || "—"}
                </button>
                {meta.industry_main && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: P.sub, background: P.card, border: `1px solid ${P.line}`, borderRadius: 999, padding: "2px 10px" }}>
                    {meta.industry_main}{meta.industry_sub ? ` · ${meta.industry_sub}` : ""}
                  </span>
                )}
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: P.faint, fontWeight: 700 }}>{recs.length}</span>
              </div>
              {recs.map((r, i) => (
                <div key={r.id || i} style={{ padding: "12px 18px", borderTop: i ? `1px solid ${P.line}` : "none" }}>
                  {r.lever === "others" && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 5 }}>
                      <span className="yyc-lever-pill">{t.otherCats[r.other_category || "misc"]}</span>
                      {r.related_to && <span style={{ fontSize: 12, color: P.sub }}>{t.relatedTo}: <b style={{ color: P.ink }}>{r.related_to}</b></span>}
                    </div>
                  )}
                  <div style={{ fontSize: 13.5, lineHeight: 1.6 }}><ClaimText text={r.claim_en || r.claim_zh} stacked /></div>
                  <ImpactBox record={r} style={{ marginTop: 6 }} />
                  {r.section && (
                    <button className="yyc-linkbtn" onClick={() => openPreview(docId, r.section)}
                      style={{ background: "none", border: "none", padding: 0, marginTop: 5, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700, color: P.crimsonText, textDecoration: "underline" }}>
                      {r.section} →
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}