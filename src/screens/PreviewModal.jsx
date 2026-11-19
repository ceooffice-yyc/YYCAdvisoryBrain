// The window that shows one document: its text, summary and lever records.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { useEffect, useRef, useState } from "react";
import { safeDocHtml } from "../safeHtml.js";
import { leverTag, sortByLever } from "../lib/levers.js";
import { P, S } from "../theme.js";
import { T } from "../i18n.js";
import { Icon } from "../ui/Icon.jsx";
import { SkeletonLines } from "../ui/Skeleton.jsx";
import { ClaimText, ImpactBox } from "../ui/ClaimView.jsx";

export function PreviewModal({ t, lang, data, levers, onClose }) {
  const { doc, targetSection, targetRecordId } = data;
  const hasHtml = !!doc.html;
  const docLevers = sortByLever((levers || []).filter((l) => l.doc_id === doc.id));
  /* a reference to one lever record opens the Lever records tab on that record (if it still exists); otherwise the old section behaviour */
  const hasTargetRecord = !!targetRecordId && docLevers.some((l) => l.id === targetRecordId);
  const [view, setView] = useState(hasTargetRecord ? "levers" : targetSection ? "summary" : hasHtml ? "document" : "summary");
  const targetRef = useRef(null);
  const [safeHtml, setSafeHtml] = useState(null); // the cleaned document HTML (null while the cleaner loads)
  useEffect(() => {
    let on = true;
    safeDocHtml(doc.html).then((h) => { if (on) setSafeHtml(h); });
    return () => { on = false; };
  }, [doc.html]);

  useEffect(() => {
    const id = setTimeout(() => targetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => clearTimeout(id);
  }, [view]);

  const tabs = [
    ...(hasHtml ? [["document", t.docView]] : []),
    ["summary", t.sumView],
    ...(docLevers.length ? [["levers", `${t.leverRecords} (${docLevers.length})`]] : []),
  ];

  return (
    <div className="yyc-modal-backdrop yyc-backdrop-full" onClick={onClose}>
      <div className="yyc-modal yyc-modal-sheet" style={{ width: 840, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="yyc-modal-head yyc-preview-head">
          <div className="yyc-preview-title">
            <div className="yyc-preview-h">{doc.title}</div>
            <div className="yyc-preview-meta">
              {T[lang].docTypes[doc.doc_type] || doc.doc_type} · {doc.industry}
              {doc.problem_signature ? ` · ${doc.problem_signature}` : ""}
            </div>
          </div>
          <button className="yyc-icon-btn yyc-preview-close" onClick={onClose} aria-label="Close"><Icon name="close" size={14} /></button>
          {tabs.length > 1 && (
            <div className="yyc-seg" role="group" aria-label="What to show">
              {tabs.map(([k, label]) => (
                <button key={k} type="button" className={`yyc-seg-btn ${view === k ? "is-active" : ""}`} aria-pressed={view === k} onClick={() => setView(k)}>{label}</button>
              ))}
            </div>
          )}
        </div>

        <div className="yyc-preview-body" style={{ overflowY: "auto", padding: view === "document" ? "28px 26px" : "20px 26px" }}>
          {view === "document" && hasHtml ? (
            <div className="yyc-paper" style={{ background: P.card, borderRadius: 12, boxShadow: P.s2, maxWidth: 680, margin: "0 auto", padding: "40px 46px" }}>
              <style>{`
                .yyc-docview h1 { font-size: 22px; font-weight: 800; margin: 18px 0 10px; line-height: 1.3; }
                .yyc-docview h2 { font-size: 18px; font-weight: 750; margin: 16px 0 8px; line-height: 1.3; color: ${P.maroonText}; }
                .yyc-docview h3 { font-size: 15.5px; font-weight: 700; margin: 14px 0 6px; }
                .yyc-docview p { font-size: 14px; line-height: 1.75; margin: 0 0 10px; }
                .yyc-docview ul, .yyc-docview ol { padding-left: 22px; margin: 0 0 10px; }
                .yyc-docview li { font-size: 14px; line-height: 1.7; margin-bottom: 3px; }
                .yyc-docview table { border-collapse: collapse; margin: 10px 0; width: 100%; }
                .yyc-docview td, .yyc-docview th { border: 1px solid ${P.lineDark}; padding: 6px 10px; font-size: 13px; }
                .yyc-docview strong { font-weight: 700; }
                .yyc-docview img { max-width: 100%; }
              `}</style>
              {safeHtml === null ? <SkeletonLines rows={9} /> : <div className="yyc-docview" dangerouslySetInnerHTML={{ __html: safeHtml }} />}
            </div>
          ) : view === "levers" ? (
            docLevers.map((r, i) => (
              <div key={r.id || i} ref={hasTargetRecord && r.id === targetRecordId ? targetRef : null}
                style={{ ...S.card, padding: "16px 18px", marginBottom: 10, ...(hasTargetRecord && r.id === targetRecordId ? { background: P.goldSoft, border: `1px solid ${P.gold}`, borderLeft: `3px solid ${P.gold}` } : null) }}>
                <div className="yyc-rec-row" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span className="yyc-rec-pill" style={{ background: P.goldSoft, color: P.goldText, border: `1px solid rgba(184,134,11,0.4)`, fontSize: 11, fontWeight: 750, padding: "4px 11px", whiteSpace: "nowrap", borderRadius: 999 }}>
                    {leverTag(t, r)}
                  </span>
                  <div className="yyc-rec-main" style={{ flex: 1, minWidth: 0 }}>
                    {r.lever === "others" && r.related_to && (
                      <div style={{ fontSize: 12, color: P.sub, marginBottom: 4 }}>{t.relatedTo}: <b style={{ color: P.ink }}>{r.related_to}</b></div>
                    )}
                    <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                      <ClaimText text={r.claim_en || r.claim_zh} stacked />
                    </div>
                    <ImpactBox record={r} style={{ marginTop: 10, padding: "10px 14px", borderRadius: 9 }} />
                    {r.section && <div style={{ fontSize: 11.5, color: P.faint, marginTop: 8, fontWeight: 600 }}>{r.section}</div>}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <>
              {(doc.sections || []).map((s, i) => {
                const isTarget = targetSection && s.heading === targetSection;
                return (
                  <div key={i} ref={isTarget ? targetRef : null}
                    style={{
                      padding: "14px 16px", marginBottom: 8, borderRadius: 11,
                      background: isTarget ? P.goldSoft : P.card,
                      border: `1px solid ${isTarget ? P.gold : P.line}`,
                      borderLeft: isTarget ? `3px solid ${P.gold}` : `3px solid ${P.line}`,
                      animation: `yycFadeUp .25s ease-out ${i * 20}ms both`,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.heading}</div>
                    <div style={{ fontSize: 13, color: P.sub, marginTop: 4, lineHeight: 1.6 }}>
                      {lang === "zh" ? s.summary_zh || s.summary_en : s.summary_en || s.summary_zh}
                    </div>
                  </div>
                );
              })}
              {!hasHtml && (
                <>
                  <div style={{ fontWeight: 750, fontSize: 13, color: P.maroonText, margin: "22px 0 10px", textTransform: "uppercase", letterSpacing: ".04em" }}>
                    {t.fullText}
                  </div>
                  <div style={{ fontSize: 13.5, whiteSpace: "pre-wrap", lineHeight: 1.7, color: P.ink, background: P.card, padding: 20, borderRadius: 12, border: `1px solid ${P.line}` }}>
                    {doc.full_text}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}