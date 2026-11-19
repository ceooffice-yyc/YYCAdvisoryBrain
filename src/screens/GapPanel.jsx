// The Gap Log screen (admins).
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { useEffect, useState } from "react";
import { P, S } from "../theme.js";
import { Icon } from "../ui/Icon.jsx";
import { SkeletonPage } from "../ui/Skeleton.jsx";

/* Admin: what people asked and how it went (the ask_log table). Filters: refused, thumbs down, answers with figures nobody could match. */
function AskLogPanel({ t }) {
  const [filter, setFilter] = useState("refused");
  const [data, setData] = useState({ filter: null, rows: [] });
  useEffect(() => {
    let off = false;
    window.db.askLog(filter).then((rows) => { if (!off) setData({ filter, rows }); }).catch(() => { if (!off) setData({ filter, rows: [] }); });
    return () => { off = true; };
  }, [filter]);
  const loading = data.filter !== filter;
  const chip = (key, label) => (
    <button key={key} className={filter === key ? "yyc-btn-primary" : "yyc-btn-secondary"} style={{ padding: "6px 12px", fontSize: 12.5 }} onClick={() => setFilter(key)}>{label}</button>
  );
  const badge = (text, bg, fg) => <span style={{ background: bg, color: fg, borderRadius: 999, padding: "1px 9px", fontSize: 11, fontWeight: 650, marginRight: 6 }}>{text}</span>;
  return (
    <div style={{ marginTop: 34 }}>
      <div className="yyc-section-head">
        <div>
          <h2 className="yyc-section-title" style={{ fontSize: 18 }}>{t.askLogTitle}</h2>
          <div className="yyc-section-sub">{t.askLogIntro}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {chip("refused", t.askLogRefused)}
        {chip("down", t.askLogDown)}
        {chip("figures", t.askLogFigures)}
        {chip("all", t.askLogAll)}
      </div>
      {loading ? (
        <SkeletonPage variant="log" label="Loading the question log" />
      ) : data.rows.length === 0 ? (
        <div className="yyc-empty">{t.askLogEmpty}</div>
      ) : (
        <div style={{ ...S.card, overflow: "hidden" }}>
          {data.rows.map((r, i) => (
            <div key={r.id} style={{ padding: "12px 20px", borderTop: i ? `1px solid ${P.line}` : "none" }}>
              <div style={{ fontSize: 14, lineHeight: 1.55 }}>{r.question}</div>
              <div style={{ marginTop: 6 }}>
                {r.error ? badge(t.askLogFailed, P.redSoft, P.red) : r.answerable === false ? badge(t.askLogNotCovered, P.goldSoft, P.goldDark) : badge(t.askLogAnswered, P.greenSoft, P.green)}
                {r.feedback === -1 && badge(t.fbDown, P.redSoft, P.red)}
                {r.feedback === 1 && badge(t.fbUp, P.greenSoft, P.green)}
                {Array.isArray(r.unsupported) && r.unsupported.length > 0 && badge(`${t.askLogFigureTag}: ${r.unsupported.join(", ")}`, P.goldSoft, P.goldDark)}
              </div>
              {r.feedback_note && <div style={{ fontSize: 12.5, color: P.sub, marginTop: 5 }}>“{r.feedback_note}”</div>}
              {r.error && <div style={{ fontSize: 12, color: P.redText, marginTop: 4 }}>{r.error}</div>}
              <div style={{ fontSize: 12, color: P.faint, marginTop: 5 }}>
                {new Date(r.created_at).toLocaleString("en-MY")} · {r.user_email || "?"}{r.mode ? ` · ${r.mode}` : ""}{r.ms ? ` · ${(r.ms / 1000).toFixed(1)}s` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function GapPanel({ t, flash, setConfirm }) {
  const [log, setLog] = useState(null);
  useEffect(() => { (async () => { try { setLog(await window.db.gapList()); } catch { setLog([]); } })(); }, []);
  const clear = () => {
    setConfirm({
      message: t.clearGap + "?",
      onConfirm: async () => { // soft delete: the entries stay in storage, marked deleted
        await window.db.gapClear(); setLog([]); flash("OK");
      },
    });
  };
  if (log === null) return <SkeletonPage variant="log" label="Loading the gap log" />;
  const shown = log;
  return (
    <div>
      <div className="yyc-section-head">
        <div>
          <h1 className="yyc-section-title">{t.tabs.gap}</h1>
          <div className="yyc-section-sub">{t.gapIntro}</div>
        </div>
        {shown.length > 0 && (
          <button className="yyc-btn-secondary yyc-iconify" onClick={clear} title={t.clearGap}><Icon name="trash" size={15} /> <span className="yyc-btn-label">{t.clearGap}</span></button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="yyc-empty">
          <div className="yyc-empty-icon"><Icon name="alert" size={22} /></div>
          {t.gapEmpty}
        </div>
      ) : (
        <div style={{ ...S.card, overflow: "hidden" }}>
          {[...shown].reverse().map((g, i) => (
            <div key={i} style={{ padding: "14px 20px", borderTop: i ? `1px solid ${P.line}` : "none" }}>
              <div style={{ fontSize: 14, lineHeight: 1.55 }}>{g.q}</div>
              <div style={{ fontSize: 12, color: P.faint, marginTop: 4 }}>{new Date(g.at).toLocaleString("en-MY")}</div>
            </div>
          ))}
        </div>
      )}
      {window.db?.askLog && <AskLogPanel t={t} />}
    </div>
  );
}