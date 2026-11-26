// The Ask the Brain screen.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { useEffect, useMemo, useRef, useState } from "react";
import { makeLocalRetriever } from "../../server/ask/localRetrieval.js";
import { runAsk } from "../../server/ask/pipeline.js";
import { isSmallTalk } from "../../server/ask/router.js";
import { askAI, describeAskError } from "../lib/ai.js";
import { P } from "../theme.js";
import { citationLabel } from "../lib/levers.js";
import { Icon } from "../ui/Icon.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { CopyButton } from "../ui/CopyButton.jsx";
import { formatAnswer } from "../lib/copy.js";

/* Minimal, injection-safe renderer for model answers: paragraphs, headings, bullet/numbered lists, **bold**.
   Builds React elements only (never innerHTML), so model output can't inject markup. */
function renderInline(s, keyBase) {
  return String(s).split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? <strong key={keyBase + i}>{p.slice(2, -2)}</strong> : p
  );
}
function MarkdownLite({ text }) {
  const blocks = [];
  let list = null;
  const flush = () => { if (list) { blocks.push(list); list = null; } };
  String(text || "").split(/\r?\n/).forEach((raw) => {
    const line = raw.trimEnd();
    const b = line.match(/^\s*[-*•]\s+(.*)$/);
    const n = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (b || n) {
      const type = b ? "ul" : "ol";
      if (!list || list.type !== type) { flush(); list = { type, start: n ? Number(n[1]) : 1, items: [] }; }
      list.items.push(b ? b[1] : n[2]);
      return;
    }
    flush();
    if (!line.trim()) return;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(h ? { type: "h", text: h[1] } : { type: "p", text: line });
  });
  flush();
  return (
    <div className="yyc-md">
      {blocks.map((bl, i) => {
        if (bl.type === "ul" || bl.type === "ol") {
          const Tag = bl.type;
          return <Tag key={i} start={bl.type === "ol" ? bl.start : undefined}>{bl.items.map((it, j) => <li key={j}>{renderInline(it, `${i}-${j}-`)}</li>)}</Tag>;
        }
        if (bl.type === "h") return <div key={i} className="yyc-md-h">{renderInline(bl.text, `${i}-`)}</div>;
        return <p key={i}>{renderInline(bl.text, `${i}-`)}</p>;
      })}
    </div>
  );
}

export function ChatPanel({ t, lang, index, levers, openPreview, msgs, setMsgs }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState(null);   // {query} while "@…" is being typed
  const [mIdx, setMIdx] = useState(0);
  const [taggedDocs, setTaggedDocs] = useState([]); // [{id,title}] forced into retrieval
  const inputElRef = useRef(null);
  const [sugg, setSugg] = useState(null);
  const [suggBusy, setSuggBusy] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (index.length > 0 && window.innerWidth >= 900) {
      inputElRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus once when the chat opens
  }, []);

  // only the in-browser mode reads every document for each question; on the hosted site the server searches, so nothing is downloaded
  useEffect(() => { if (!window.db?.ask) window.db?.warmDocuments(index.map((d) => d.id)); }, [index]);


  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  useEffect(() => {
    if (!index.length) { setSugg(null); return; }
    const fp = index.map((d) => d.id).sort().join(",");
    let cancelled = false;
    (async () => {
      const cached = await window.db.suggestionsGet();
      if (cached && cached.fp === fp && Array.isArray(cached.en) && Array.isArray(cached.zh)) {
        if (!cancelled) setSugg(cached);
        return;
      }
      if (window.storage?.remote && !window.storage.user?.isAdmin) { // a viewer: show the stored examples, even if the library changed since
        if (!cancelled) setSugg(cached && Array.isArray(cached.en) ? cached : null);
        return;
      }
      setSuggBusy(true);
      try {
        const docs = await window.db.getDocuments(index.slice(0, 12).map((d) => d.id));
        const outline = docs
          .map((d) => `- ${d.title} (${d.doc_type}, ${d.industry}): ${(d.sections || []).slice(0, 5).map((s) => s.heading).join("; ")}`)
          .join("\n");
        const j = await askAI(
          `Generate exactly 3 short example questions a YYC advisor could ask this internal knowledge base. Each must be answerable ONLY from the materials outlined below and mention concrete topics from them (max 14 words each). Return ONLY JSON: {"en": ["q1","q2","q3"]}\n\nMATERIALS:\n${outline}`, // [ZH disabled for now] was: {"en": [...], "zh": [...]} — zh in Simplified Chinese
          1500
        );
        if (!cancelled && Array.isArray(j.en)) {
          const rec = { fp, en: j.en.slice(0, 3), zh: [] /* [ZH disabled for now] j.zh.slice(0, 3) */ };
          await window.db.suggestionsSet(rec);
          setSugg(rec);
        }
      } catch { /* suggestions are optional */ }
      if (!cancelled) setSuggBusy(false);
    })();
    return () => { cancelled = true; };
  }, [index]);

  const onQChange = (val) => {
    setQ(val);
    const m = val.match(/@([^@]{0,40})$/);
    if (m) { setMention({ query: m[1] }); setMIdx(0); }
    else setMention(null);
  };

  const mentionCands = mention
    ? index
      .filter((d) => (d.title || "").toLowerCase().includes(mention.query.trim().toLowerCase()))
      .sort((a, b) => {
        const qq = mention.query.trim().toLowerCase();
        const aStarts = a.title.toLowerCase().startsWith(qq) ? 1 : 0;
        const bStarts = b.title.toLowerCase().startsWith(qq) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts; // prefix matches first
        return a.title.localeCompare(b.title); // then alphabetical
      })
      .slice(0, 6)
    : [];

  const pickMention = (d) => {
    setQ((cur) => cur.replace(/@([^@]{0,40})$/, `@${d.title} `));
    setTaggedDocs((tags) => (tags.some((x) => x.id === d.id) ? tags : [...tags, { id: d.id, title: d.title }]));
    setMention(null);
    inputElRef.current?.focus();
  };

  const onInputKeyDown = (e) => {
    if (mention && mentionCands.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMIdx((i) => Math.min(i + 1, mentionCands.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(mentionCands[mIdx]); return; }
      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
    }
    if (e.key === "Enter") send();
  };

  /* Ask the Brain. With the shared database (the hosted site) the SERVER does the work (POST /api/ask: search, AI, references, logging).
     Without it, the very same pipeline (server/ask/pipeline.js) runs here in the browser on the documents this browser holds. */
  const liveRef = useRef({ index, levers });
  liveRef.current = { index, levers };
  const localRetriever = useMemo(() => makeLocalRetriever(() => window.db.getDocuments(liveRef.current.index.map((d) => d.id)), { ttlMs: 30000 }), []);
  const askInBrowser = (payload) => runAsk(payload, {
    llm: { json: (prompt, o = {}) => askAI(prompt, o.maxTokens || 1500, o.retries ?? 1) },
    retrieve: localRetriever.retrieve,
    records: async () => liveRef.current.levers,
    docIndex: async () => liveRef.current.index,
  });
  const hosted = !!window.db?.ask;

  const send = async (forcedText) => {
    const question = (typeof forcedText === "string" ? forcedText : q).trim();
    if (!question || busy) return;
    setQ("");
    if (isSmallTalk(question)) {
      setMsgs((m) => [...m, { role: "user", text: question }, { role: "ai", text: t.greetReply }]);
      return; // no search, no AI call, no log entry
    }
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    const payload = {
      question,
      history: msgs.slice(-4).map((m) => ({ role: m.role, text: m.text || "" })),
      taggedIds: taggedDocs.filter((td) => question.includes(td.title)).map((td) => td.id),
    };
    setTaggedDocs([]);
    try {
      let r;
      if (hosted) {
        try { r = await window.db.ask(payload); } catch (e) { if (e.kind !== "unavailable") throw e; } // this server has no /api/ask yet: do it here instead
      }
      if (!r) r = await askInBrowser(payload);
      if (!r.answerable) {
        setMsgs((m) => [...m, { role: "ai", refused: true, text: t.refused, closest: r.closest, retrieved: r.retrieved, logId: r.logId }]);
        if (!r.gapLogged) await window.db.gapAdd(question); // on the hosted site the server has already put it on the Gap list
      } else {
        setMsgs((m) => [...m, { role: "ai", text: r.text, citations: r.citations, evidence: r.evidence, retrieved: r.retrieved, unsupportedFigures: r.unsupportedFigures, uncited: r.uncited, logId: r.logId }]);
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: "ai", refused: true, text: describeAskError(e, t) }]);
    }
    setBusy(false);
  };

  /* thumbs up / down on an answer; pressing the same one again takes it back */
  const rate = async (i, rating) => {
    const m = msgs[i];
    if (!m || !m.logId || !window.db?.askFeedback) return;
    const next = m.rating === rating ? 0 : rating;
    setMsgs((ms) => ms.map((x, k) => (k === i ? { ...x, rating: next || null } : x)));
    try { await window.db.askFeedback(m.logId, next); } catch { setMsgs((ms) => ms.map((x, k) => (k === i ? { ...x, rating: m.rating || null } : x))); }
  };

  const clearChat = () => setMsgs([]);

  return (
    <div style={{paddingBottom: 0, marginBottom: 0}}>
      <div className="yyc-section-head">
        <div>
          <h1 className="yyc-section-title">{t.tabs.chat}</h1>
          <div className="yyc-section-sub">{t.chatIntro}</div>
        </div>
        {msgs.length > 0 && (
          <button className="yyc-btn-secondary" onClick={clearChat} style={{ padding: "8px 14px" }}>{t.clearChat}</button>
        )}
      </div>

      {index.length === 0 && (
        <div style={{ color: P.redText, fontSize: 13, marginBottom: 14, fontWeight: 600 }}>{t.noDocsChat}</div>
      )}

      <div className="yyc-chat-wrap">
        <div className="yyc-chat-scroll">
          {msgs.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", minHeight: "100%", flexShrink: 0, color: P.faint, textAlign: "left", padding: 20 }}>
              <div style={{ width: 60, height: 60, flexShrink: 0, borderRadius: 18, background: P.crimsonSoft, color: P.crimsonText, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <Icon name="brain" size={26} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: P.ink, marginBottom: 6 }}>Ask the Brain</div>
              <div style={{ fontSize: 13, maxWidth: 380, lineHeight: 1.55 }}>{t.chatIntro}</div>
              {index.length > 0 && (suggBusy || (sugg && (sugg[lang] || []).length > 0)) && (
                <div style={{ marginTop: 20, width: "100%" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: P.faint, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 }}>
                    {t.tryAsking}
                  </div>
                  {suggBusy ? (
                    <div role="status" aria-busy="true" aria-label={t.loadingSuggestions} style={{ display: "grid", gap: 8, marginTop: 8, maxWidth: 420 }}>
                      {[0, 1, 2].map((k) => <Skeleton key={k} h={40} r={11} />)}
                    </div>
                  ) : (
                    (sugg[lang] || []).map((s, k) => (
                      <button key={k} className="yyc-sugg-chip" onClick={() => send(s)}>{s}</button>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            msgs.map((m, i) => (
              <div key={i} className={`yyc-msg-row ${m.role === "user" ? "is-user" : ""}`}>
                {m.role === "ai" && (
                  <div className={`yyc-avatar is-ai ${m.refused ? "is-refused" : ""}`}><Icon name="brain" size={13} /></div>
                )}
                <div style={{ maxWidth: "82%" }}>
                  <div className={`yyc-bubble ${m.role === "user" ? "is-user" : m.refused ? "is-refused" : "is-ai"}`}>
                    {m.role === "ai" && !m.refused ? <MarkdownLite text={m.text} /> : m.text}
                    {m.refused && m.closest && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${P.lineDark}`, fontStyle: "normal", fontSize: 12.5 }}>
                        <b>{t.closestMatch}:</b>{" "}
                        <button className="yyc-why-doclink" onClick={() => openPreview(m.closest.doc_id)}>{m.closest.doc_title}</button>
                        {m.closest.section ? ` · ${m.closest.section}` : ""}{" — "}{t.belowThresholdNote}
                      </div>
                    )}
                  </div>
                  {m.citations?.length > 0 && (
                    <div className="yyc-cites">
                      <span className="yyc-cites-label">{t.refs}:</span>
                      {m.citations.map((c, j) => {
                        const label = citationLabel(c);
                        return (
                          <button key={j} className="yyc-cite-btn" title={label.full} aria-label={label.full} onClick={() => openPreview(c.doc_id, c.section, c.record_id)}>
                            <Icon name="file" size={11} />
                            {label.short}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {m.role === "ai" && !m.refused && (m.unsupportedFigures?.length > 0 || m.uncited) && (
                    <div className="yyc-ans-note">
                      {m.unsupportedFigures?.length > 0 && <div>{t.figuresWarn.replace("{list}", m.unsupportedFigures.join(", "))}</div>}
                      {m.uncited && <div>{t.uncitedNote}</div>}
                    </div>
                  )}
                  {m.role === "ai" && (m.evidence?.length > 0 || m.retrieved?.length > 0) && (
                    <div style={{ marginTop: 7 }}>
                      <button
                        className="yyc-why-toggle"
                        onClick={() => setMsgs((ms) => ms.map((x, k) => (k === i ? { ...x, why: !x.why } : x)))}
                      >
                        <span style={{ display: "inline-flex", transition: "transform .15s", transform: m.why ? "rotate(180deg)" : "none" }}>
                          <Icon name="chevronDown" size={12} />
                        </span>
                        {t.whyThis}
                      </button>
                      {m.why && (
                        <div className="yyc-why-panel">
                          {(m.evidence || []).map((e, k) => {
                            const barColor = e.relevance >= 70 ? P.green : e.relevance >= 40 ? P.gold : P.red;
                            return (
                              <div key={k} className="yyc-why-row" onClick={() => openPreview(e.doc_id, e.section, e.record_id)}>
                                <div className="yyc-why-row-head">
                                  <span className="yyc-why-doc">
                                    <Icon name="file" size={11} /> {e.doc_title}{e.section ? ` · ${e.section}` : ""}
                                  </span>
                                  <span className="yyc-why-pct" style={{ color: barColor }}>
                                    {e.relevance}% {t.evidenceMatch}
                                  </span>
                                </div>
                                {e.passage && <div className="yyc-why-passage">"{e.passage}"</div>}
                                <div className="yyc-why-bar">
                                  <div style={{ width: `${e.relevance}%`, background: barColor }} />
                                </div>
                              </div>
                            );
                          })}
                          {m.retrieved?.length > 0 && (
                            <div className="yyc-why-checked">
                              {t.checkedDocs}: {m.retrieved.map((r) => r.title).join(" · ")}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {m.role === "ai" && !m.refused && m.text && (
                    <div className="yyc-msg-actions">
                      <CopyButton className="yyc-chip-btn" showLabel label="Copy answer" done="Answer copied, with its sources"
                        getText={() => formatAnswer({ question: msgs[i - 1] && msgs[i - 1].role === "user" ? msgs[i - 1].text : "", answer: m.text, citations: m.citations, titleOf: (id) => (index.find((d) => d.id === id) || {}).title })} />
                    </div>
                  )}
                  {m.role === "ai" && m.logId && (
                    <div className="yyc-fb">
                      <span>{t.fbAsk}</span>
                      <button className={m.rating === 1 ? "is-on" : ""} onClick={() => rate(i, 1)}>{t.fbUp}</button>
                      <button className={m.rating === -1 ? "is-on is-down" : ""} onClick={() => rate(i, -1)}>{t.fbDown}</button>
                    </div>
                  )}
                </div>
                {m.role === "user" && <div className="yyc-avatar is-user"><Icon name="user" size={13} /></div>}
              </div>
            ))
          )}
          {busy && (
            <div className="yyc-msg-row">
              <div className="yyc-avatar is-ai"><Icon name="brain" size={13} /></div>
              <div className="yyc-typing"><span /><span /><span /></div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="yyc-chat-input-wrap" style={{ position: "relative" }}>
          {mention && mentionCands.length > 0 && (
            <div className="yyc-mention-pop">
              {mentionCands.map((d, i) => (
                <button
                  key={d.id}
                  className={`yyc-kbar-item ${i === mIdx ? "is-active" : ""}`}
                  onMouseEnter={() => setMIdx(i)}
                  onClick={() => pickMention(d)}
                >
                  <span className="yyc-kbar-badge">{t.kbarDoc}</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
                </button>
              ))}
            </div>
          )}
          {taggedDocs.length > 0 && (
            <div className="yyc-tag-row">
              {taggedDocs.map((td) => (
                <span key={td.id} className="yyc-tag-chip">
                  @{td.title}
                  <button onClick={() => setTaggedDocs((tags) => tags.filter((x) => x.id !== td.id))}>×</button>
                </span>
              ))}
            </div>
          )}
          <input
            ref={inputElRef}
            value={q} onChange={(e) => onQChange(e.target.value)} onKeyDown={onInputKeyDown}
            placeholder={t.chatPh} disabled={index.length === 0} className="yyc-chat-input"
          />
          <button className="yyc-btn-primary yyc-iconify yyc-send" onClick={send} disabled={busy || !q.trim() || index.length === 0} title={t.send} style={{ padding: "11px 22px" }}>
            <Icon name="arrowRight" size={17} className="yyc-send-icon" /><span className="yyc-btn-label">{t.send}</span>
          </button>
        </div>
      </div>
    </div>
  );
}