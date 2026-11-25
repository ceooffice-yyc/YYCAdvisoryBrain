// A lever record card and the "which lever?" picker, shared by the Knowledge Base and the Lever Explorer.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { leverTag, parseIndustry } from "../lib/levers.js";
import { P } from "../theme.js";
import { Icon } from "./Icon.jsx";
import { CopyButton } from "./CopyButton.jsx";
import { formatStrategy } from "../lib/copy.js";
import { ClaimText, ImpactBox } from "./ClaimView.jsx";

export function LeverRecordCard({ record, meta, t, lang, onOpenPicker, isAdmin, onEdit, onDelete }) {
  const isZh = lang === "zh";
  const claim = isZh
    ? (record.claim_zh || record.claim_en)
    : (record.claim_en || record.claim_zh);
  const { main, sub } = parseIndustry(meta?.industry || "", meta);

  return (
    <div className="yyc-lever-record" onClick={() => onOpenPicker(record)} /* a click anywhere on the card opens the choices; the keyboard and screen readers use the button area below */>
      <div
        className="yyc-lever-record-hit"
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenPicker(record);
          }
        }}
      >
      <div className="yyc-lever-record-head">
        <span
          className="yyc-lever-pill"
          style={{ border: "1px solid rgba(184,134,11,0.4)" }}
          title={leverTag(t, record)}
        >
          {leverTag(t, record)}
        </span>
        <span className="yyc-lever-record-doc">
          <Icon name="file" size={11} />
          {meta?.title || record.doc_title || "(unknown)"}
        </span>
      </div>

      {record.lever === "others" && record.related_to && (
        <div className="yyc-lever-record-meta">{t.relatedTo}: <b style={{ color: P.ink }}>{record.related_to}</b></div>
      )}
      {claim && <div className="yyc-lever-record-claim"><ClaimText text={claim} stacked /></div>}
      <ImpactBox record={record} />


      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="yyc-lever-record-meta" style={{ flex: 1 }}>
          {sub ? `${main} · ${sub}` : main}
          {record.section ? ` · ${record.section}` : ""}
        </div>
        <div className="yyc-doc-actions" style={{ opacity: 1 }} onClick={(e) => e.stopPropagation()}>
          <CopyButton label="Copy this strategy" done="Strategy copied" getText={() => formatStrategy(record, { leverName: t.levers[record.lever] || record.lever, docTitle: meta?.title })} />
          {isAdmin && (<>
            <button className="yyc-icon-btn" onClick={() => onEdit(record)} title={t.edit} aria-label={t.edit}><Icon name="edit" size={13} /></button>
            <button className="yyc-icon-btn is-danger" onClick={() => onDelete(record)} title={t.del} aria-label={t.del}><Icon name="trash" size={13} /></button>
          </>)}
        </div>
      </div>
    </div>
  );
}

export function LeverPickerModal({ t, currentLever, counts, onSelect, onClose, onOpenSource, onClear }) {
  return (
    <div className="yyc-modal-backdrop" onClick={onClose}>
      <div className="yyc-modal" style={{ width: 420, padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 750, letterSpacing: "-0.01em" }}>{t.pickLeverTitle}</div>
            <div style={{ fontSize: 12.5, color: P.sub, marginTop: 4, lineHeight: 1.5 }}>{t.pickLeverHint}</div>
          </div>
          <button className="yyc-icon-btn" onClick={onClose} aria-label="Close" style={{ width: 30, height: 30 }}>
            <Icon name="close" size={13} />
          </button>
        </div>

        <div className="yyc-lever-picker-list" style={{ marginTop: 16 }}>
          {onClear && (
            <button
              type="button"
              className={`yyc-lever-picker-item ${currentLever === "all" ? "is-active" : ""}`}
              onClick={() => { onClear(); onClose(); }}
            >
              <span className="yyc-lever-pill" style={{ border: `1px solid ${P.lineDark}`, background: P.card, color: P.sub }} title={t.allLevers}>
                {t.allLevers}
              </span>
              <span className="yyc-lever-picker-count">
                {Object.values(counts).reduce((s, n) => s + n, 0)} {t.recordsWord || "records"}
              </span>
            </button>
          )}
          {Object.keys(t.levers).map((l) => {
            const n = counts[l] || 0;
            const active = l === currentLever;
            return (
              <button
                key={l}
                type="button"
                className={`yyc-lever-picker-item ${active ? "is-active" : ""}`}
                onClick={() => { onSelect(l); onClose(); }}
                disabled={n === 0 && !active}
              >
                <span className="yyc-lever-pill" style={{ border: "1px solid rgba(184,134,11,0.4)" }} title={t.levers[l]}>
                  {t.levers[l]}
                </span>
                <span className="yyc-lever-picker-count">
                  {n} {n === 1 ? "record" : "records"}
                </span>
              </button>
            );
          })}
        </div>

        <div className="yyc-lever-picker-foot">
          {onOpenSource && (
            <button className="yyc-btn-secondary" onClick={onOpenSource} style={{ padding: "7px 12px", fontSize: 12.5 }}>
              <Icon name="file" size={12} /> {t.openSource}
            </button>
          )}
          <button className="yyc-btn-secondary" onClick={onClose} style={{ padding: "7px 12px", fontSize: 12.5 }}>
            {t.closeMenu}
          </button>
        </div>
      </div>
    </div>
  );
}