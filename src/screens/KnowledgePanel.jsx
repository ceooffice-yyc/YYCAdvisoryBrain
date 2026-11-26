// The Knowledge Base screen: browsing, and for admins adding, extracting, reviewing and editing documents.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { addLever, hasClaimText, removeLever, splitClaim, undoRemoveLever } from "../claim.js";
import { isTicked, itemFlags, saveMany, summarizeTicked } from "../bulkSave.js";
import { planSplit } from "../compilationSplit.js";
import { FULL_TEXT_LIMIT } from "../extractionNotices.js";
import ClaimFields from "../ClaimFields.jsx";
import { P, S, TYPE_COLORS } from "../theme.js";
import { detectMnaDocument, mnaSectionKind } from "../pipeline/headings.js";
import { AIError, describeAIError, fastExtraction, keysInUse, setAiListener } from "../lib/ai.js";
import { claimSimilarity, cleanDocTitle, fmtElapsed, isLive, me, uid } from "../lib/util.js";
import { parseDocxFile } from "../pipeline/docx.js";

// The extraction code is only needed when an admin extracts something, so it is downloaded then, not with this screen.
const extractDocument = async (...args) => (await import("../pipeline/extract.js")).extractDocument(...args);
const buildCompilationItems = async (...args) => (await import("../pipeline/extract.js")).buildCompilationItems(...args);
import { OTHER_CATS, leverTag, normalizeMainCategory, normalizeOther, parseIndustry, sortByLever } from "../lib/levers.js";
import { T } from "../i18n.js";
import { Icon } from "../ui/Icon.jsx";
import { SkeletonLines } from "../ui/Skeleton.jsx";
import { navigate, useRoute } from "../lib/route.js";
import { ageLabel, clearDraft, describeDraft, loadDraft, restoreItems, saveDraft } from "../lib/drafts.js";
import { LeverPickerModal, LeverRecordCard } from "../ui/LeverParts.jsx";

// Asked when the person's M&A tick and the document's section headings disagree: proceed either way, or skip the file
function MnaChoiceModal({ ask, onPick }) {
  const markedNormal = ask.chosen === false;
  const lead = markedNormal ? "Proceed as M&A" : "Proceed as normal";
  const other = markedNormal ? "Proceed as normal" : "Proceed as M&A anyway";
  const leadPick = markedNormal ? "mna" : "normal";
  const otherPick = markedNormal ? "normal" : "mna";
  return (
    <div className="yyc-modal-backdrop">
      <div className="yyc-modal" role="dialog" aria-modal="true" aria-label="M&A or normal case study?" style={{ width: 470, maxWidth: "94vw", padding: 24 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 18 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: P.goldSoft, color: P.goldText, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="alert" size={18} />
          </div>
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 750, marginBottom: 4 }}>{markedNormal ? "This file looks like an M&A document" : "No M&A headings found"}</div>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              {markedNormal
                ? `"${ask.name}" has M&A section headings, but it is set to be read as a normal case study.`
                : `"${ask.name}" is ticked as an M&A document, but none of the M&A section headings (such as Acquisition Criteria or Post-Acquisition Strategy) were found.`}
            </div>
            {ask.headings.length > 0 && (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: P.sub }}>
                {ask.headings.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="yyc-btn-secondary" onClick={() => onPick("skip")}>Skip this file</button>
          <button className="yyc-btn-secondary" onClick={() => onPick(otherPick)}>{other}</button>
          <button className="yyc-btn-primary" onClick={() => onPick(leadPick)} autoFocus>{lead}</button>
        </div>
      </div>
    </div>
  );
}

/* Import Backup preview: every material found in the backup, with its status and strategies, and the lever settings found in it.
   Nothing is saved until "Import selected" is pressed; only what is ticked is imported. */
const IMPORT_STATE = { new: ["New", P.greenText, P.greenSoft], exists: ["Already in the library: skipped", P.goldText, P.goldSoft], deleted: ["Was deleted: skipped", P.redText, P.redSoft] };
function ImportPreviewModal({ t, plan, busy, onCancel, onConfirm }) {
  const [selDocs, setSelDocs] = useState(() => new Set(plan.docs.filter((d) => d.state === "new").map((d) => d.id)));
  const [selCfg, setSelCfg] = useState(() => new Set(plan.cfgItems.filter((c) => !c.exists).map((c) => c.key)));
  const [open, setOpen] = useState(() => new Set());
  const toggle = (set, setter, key) => { const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); setter(n); };
  const newDocs = plan.docs.filter((d) => d.state === "new");
  const nDocs = selDocs.size, nCfg = selCfg.size;
  const nRecs = plan.docs.filter((d) => selDocs.has(d.id)).reduce((n, d) => n + d.records.length, 0);
  const counts = (st) => plan.docs.filter((d) => d.state === st).length;
  const chip = (st) => <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999, color: IMPORT_STATE[st][1], background: IMPORT_STATE[st][2], whiteSpace: "nowrap" }}>{IMPORT_STATE[st][0]}</span>;
  return (
    <div className="yyc-modal-backdrop" onClick={() => !busy && onCancel()}>
      <div className="yyc-modal" style={{ width: 760, maxWidth: "100%", padding: 24, maxHeight: "90vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: P.crimsonText, fontWeight: 750, letterSpacing: ".08em", textTransform: "uppercase" }}>Import backup</div>
            <h2 style={{ margin: "4px 0 0", fontSize: 20, color: P.title, fontWeight: "bolder" }}>Review what will be imported</h2>
            <div style={{ fontSize: 12.5, color: P.sub, marginTop: 4, lineHeight: 1.5 }}>
              {plan.fileName}{plan.exportedAt ? ` · exported ${new Date(plan.exportedAt).toLocaleString("en-MY")}` : ""} · {plan.docs.length} material{plan.docs.length === 1 ? "" : "s"}: {counts("new")} new, {counts("exists")} already in the library, {counts("deleted")} previously deleted. Nothing is saved until you press Import selected.
            </div>
          </div>
          <button className="yyc-icon-btn" onClick={onCancel} disabled={busy} title={t.close} aria-label={t.close}><Icon name="close" size={13} /></button>
        </div>

        <div style={{ display: "flex", gap: 8, margin: "14px 0 8px", alignItems: "center", flexWrap: "wrap" }}>
          <button className="yyc-btn-secondary" style={{ padding: "5px 12px", fontSize: 12 }} disabled={busy || !newDocs.length} onClick={() => setSelDocs(new Set(newDocs.map((d) => d.id)))}>Select all new</button>
          <button className="yyc-btn-secondary" style={{ padding: "5px 12px", fontSize: 12 }} disabled={busy || !nDocs} onClick={() => setSelDocs(new Set())}>Select none</button>
          <span style={{ fontSize: 12, color: P.faint }}>{nDocs} of {newDocs.length} importable material{newDocs.length === 1 ? "" : "s"} ticked</span>
        </div>

        <div style={{ overflowY: "auto", flex: 1, minHeight: 120, border: `1px solid ${P.line}`, borderRadius: 12 }}>
          {plan.docs.length === 0 && <div style={{ padding: 18, fontSize: 13, color: P.sub }}>This backup contains no materials.</div>}
          {plan.docs.map((d, i) => {
            const importable = d.state === "new"; const isOpen = open.has(d.id);
            return (
              <div key={d.id} style={{ borderTop: i ? `1px solid ${P.line}` : "none", opacity: importable ? 1 : 0.7 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 14px" }}>
                  <input type="checkbox" aria-label={`Import ${d.title}`} checked={selDocs.has(d.id)} disabled={busy || !importable} onChange={() => toggle(selDocs, setSelDocs, d.id)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title || "(untitled)"}</div>
                    <div style={{ fontSize: 12, color: P.sub }}>{[t.docTypes[d.doc_type] || d.doc_type, d.industry].filter(Boolean).join(" · ")} · {d.records.length} strateg{d.records.length === 1 ? "y" : "ies"}</div>
                  </div>
                  {chip(d.state)}
                  <button className="yyc-btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy || !d.records.length} onClick={() => toggle(open, setOpen, d.id)}>{isOpen ? "Hide" : "Preview"}</button>
                </div>
                {isOpen && (
                  <div style={{ padding: "0 14px 12px 40px", display: "grid", gap: 8 }}>
                    {d.records.map((r) => { const c = splitClaim(r.claim_en || r.claim_zh || ""); return (
                      <div key={r.id} style={{ fontSize: 12.5, lineHeight: 1.5, background: P.wash, borderRadius: 8, padding: "8px 10px" }}>
                        <span className="yyc-lever-pill">{t.levers[r.lever] || r.lever}{r.lever === "others" && r.other_category ? ` · ${t.otherCats[r.other_category] || r.other_category}` : ""}</span>{" "}
                        <b>{c.name}</b>{c.name ? ": " : ""}<span>{String(c.desc || "").slice(0, 220)}{String(c.desc || "").length > 220 ? "…" : ""}</span>
                        {r.impact && r.impact !== "N/A" && <div style={{ color: P.sub, marginTop: 2 }}>Actual impact: {String(r.impact).slice(0, 160)}{String(r.impact).length > 160 ? "…" : ""}</div>}
                      </div>
                    ); })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {plan.cfgItems.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13.5, fontWeight: 750, marginBottom: 6 }}>Lever settings in this backup</div>
            <div style={{ border: `1px solid ${P.line}`, borderRadius: 12, maxHeight: 150, overflowY: "auto" }}>
              {plan.cfgItems.map((c, i) => (
                <label key={c.key} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 14px", borderTop: i ? `1px solid ${P.line}` : "none", opacity: c.exists ? 0.7 : 1, cursor: c.exists || busy ? "default" : "pointer" }}>
                  <input type="checkbox" checked={selCfg.has(c.key)} disabled={busy || c.exists} onChange={() => toggle(selCfg, setSelCfg, c.key)} />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.45 }}><b>{c.label}</b>{c.detail ? <span style={{ color: P.sub }}> — {String(c.detail).slice(0, 110)}{String(c.detail).length > 110 ? "…" : ""}</span> : null}</div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: c.exists ? P.goldText : P.greenText }}>{c.exists ? "Already set: skipped" : "New"}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12.5, color: P.sub }}>
            Will import <b style={{ color: P.ink }}>{nDocs}</b> material{nDocs === 1 ? "" : "s"} with <b style={{ color: P.ink }}>{nRecs}</b> strateg{nRecs === 1 ? "y" : "ies"}
            {nCfg ? <> and <b style={{ color: P.ink }}>{nCfg}</b> lever setting{nCfg === 1 ? "" : "s"}</> : null}.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="yyc-btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
            <button className="yyc-btn-primary" disabled={busy || (!nDocs && !nCfg)} onClick={() => onConfirm({ docIds: selDocs, cfgKeys: selCfg })}>{busy ? "Importing…" : "Import selected"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* One document card. Memoised: while someone types in the search box only the cards whose data changed are drawn again. */
const DocCard = memo(function DocCard({ d, i, t, lang, isAdmin, lc, main, sub, on }) {
  const tc = TYPE_COLORS[d.doc_type] || TYPE_COLORS.notes;
  return (
    <div
      className="yyc-doc"
      onMouseEnter={() => on.warm(d.id)}
      style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
      onClick={() => on.open(d.id)} /* a click anywhere on the card opens it (mouse and touch); the keyboard and screen readers use the title, which is a real button */
    >
      <div className="yyc-doc-top">
        <span className="yyc-chip" style={{ background: tc.bg, color: tc.fg }}>
          {t.docTypes[d.doc_type] || d.doc_type}
        </span>
        <span style={{ fontSize: 11.5, color: P.faint, fontWeight: 600 }}>
          <Icon name="tag" size={10} /> {sub ? `${main} · ${sub}` : main}
        </span>
      </div>

      <div>
        <button type="button" className="yyc-doc-title yyc-doc-open" aria-label={`Open: ${d.title}`}>{d.title}</button>
        {d.problem_signature && <div className="yyc-doc-sig" style={{ marginTop: 6 }}>{d.problem_signature}</div>}
      </div>

      <div className="yyc-doc-foot">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span className={`yyc-lever-pill ${lc === 0 ? "is-empty" : ""}`}>
            {lc > 0 ? `● ${lc} ${t.leverRecords.toLowerCase()}` : `○ 0 ${t.leverRecords.toLowerCase()}`}
          </span>
          {d.created && (
            <span style={{ fontSize: 11, color: P.faint, fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {new Date(d.created).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-MY", { year: "numeric", month: "short", day: "numeric" })}
            </span>
          )}
        </span>
        {isAdmin && (
          <div className="yyc-doc-actions" onClick={(e) => e.stopPropagation()}>
            <button className="yyc-icon-btn" onClick={() => on.edit(d.id)} title={t.edit} aria-label={t.edit}><Icon name="edit" size={13} /></button>
            <button className="yyc-icon-btn is-danger" onClick={() => on.del(d.id)} title={t.del} aria-label={t.del}><Icon name="trash" size={13} /></button>
          </div>
        )}
      </div>
    </div>
  );
});

export function KnowledgePanel({
  t, lang, isAdmin, index, levers, refreshKB, openPreview, flash, config, setConfig, setConfirm, setAdminLocked,
  onWorking,
}) {
  const leverKeys = Object.keys(t.levers);
  const [mode, setMode] = useState("list");
  const [stage, setStage] = useState("");                 // single-upload progress stage
  const [bulkItems, setBulkItems] = useState([]);         // [{id,name,title,text,html,status,extraction}]
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkWait, setBulkWait] = useState(0);            // countdown between docs (TPM pacing)
  const [bulkReviewId, setBulkReviewId] = useState(null); // review screen came from bulk
  const bulkCancelRef = useRef(false);
  const bulkRunIdRef = useRef(0);                      // changes when the queue is cancelled or left, so a queue that is still finishing cannot touch the next one
  const extractRunRef = useRef(0);                     // changes when a running extraction is cancelled, so its late answer is ignored
  const [bulkTicks, setBulkTicks] = useState({});      // what the person ticked or unticked by hand, by item id (anything not here follows the "safe to save" rule)
  const [bulkSaving, setBulkSaving] = useState(null);  // { done, total } while "Save selected" is running
  const [editBase, setEditBase] = useState("");        // the edit screen as it was opened, to tell whether anything changed
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [html, setHtml] = useState("");
  const [splitOffer, setSplitOffer] = useState(null);   // a file that looks like several stories: waiting for "split" or "keep as one"
  const [splitBusyId, setSplitBusyId] = useState(null); // the bulk item whose cards are being prepared
  const [mnaChoice, setMnaChoice] = useState(null); // Add screen: null = follow the detection, true / false = what the person ticked
  const [mnaAsk, setMnaAsk] = useState(null); // the "M&A or normal?" question being shown
  const mnaResolveRef = useRef(null);
  const detectedMna = useMemo(() => detectMnaDocument(text, title), [text, title]);
  const splitDeclinedRef = useRef(false);               // "keep as one document" was chosen: extract without asking again
  const [fastMode, setFastMode] = useState(fastExtraction()); // tick box on the Add material screen
  const [importPlan, setImportPlan] = useState(null); // the Import Backup preview window
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  useEffect(() => { if (errMsg) flash(errMsg, "error"); }, [errMsg, flash]); // errors appear as a toast, wherever the person has scrolled to
  const [aiNote, setAiNote] = useState(null);                 // live rate-limit wait from askAI: {kind:"wait", sec}
  useEffect(() => { setAiListener(setAiNote); return () => setAiListener(null); }, []);
  const aiBanner = aiNote && (
    <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: P.wash, border: `1px solid ${P.lineDark}`, color: P.sub, fontSize: 13, fontWeight: 600 }}>
      ⏳ {t.rateWaiting} {aiNote.sec}s
    </div>
  );
  const [extraction, setExtraction] = useState(null);
  const [reviewEpoch, setReviewEpoch] = useState(0);        // changes when a record is removed / restored, so the boxes below it are rebuilt from the data

  // ── Drafts (DRAFT-01): unsaved Review / Bulk work is kept in this browser, so a refresh or crash does not lose it ──
  const draftOwner = (window.storage?.remote && window.storage.user?.id) || "local";
  const [draftOffer, setDraftOffer] = useState(() => loadDraft(draftOwner)); // a draft from before the page was opened, waiting for "Restore" or "Discard"
  const draftWarned = useRef(false);
  useEffect(() => {
    if (draftOffer || !isAdmin) return undefined; // never overwrite a draft the person has not decided about yet
    const build = () => {
      if (bulkItems.length && (mode === "bulk" || mode === "review")) return { kind: "bulk", items: bulkItems, ticks: bulkTicks, reviewId: mode === "review" ? bulkReviewId : null, reviewExtraction: mode === "review" && bulkReviewId ? extraction : null };
      if (mode === "review" && extraction && !bulkReviewId) return { kind: "single", title, text, html, extraction, mnaChoice };
      return null; // nothing unsaved: no draft
    };
    const write = () => {
      const d = build();
      if (!d) { clearDraft(draftOwner); return; }
      const r = saveDraft(draftOwner, d);
      if ((r.state === "too-big" || r.state === "failed") && !draftWarned.current) { draftWarned.current = true; flash("This work is too big to keep as a draft in the browser: finish or save it before closing the page.", "error"); }
    };
    const timer = setTimeout(write, 800); // a moment after the last change, not on every keystroke
    const flush = () => { clearTimeout(timer); write(); };
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", onHide); };
  }, [draftOffer, isAdmin, draftOwner, mode, extraction, title, text, html, mnaChoice, bulkItems, bulkTicks, bulkReviewId, flash]);
  const restoreDraft = () => {
    if (!draftOffer) return;
    const d = draftOffer.draft;
    if (d.kind === "single") {
      setBulkItems([]); setBulkTicks({}); setBulkReviewId(null);
      setTitle(d.title || ""); setText(d.text || ""); setHtml(d.html || ""); setMnaChoice(d.mnaChoice === undefined ? null : d.mnaChoice);
      setExtraction(d.extraction); setReviewEpoch((n) => n + 1);
      setMode("review");
    } else {
      const items = restoreItems(d.items);
      setBulkItems(items); setBulkTicks(d.ticks || {});
      const open = d.reviewId && d.reviewExtraction ? items.find((x) => x.id === d.reviewId) : null;
      if (open) {
        setTitle(open.title); setText(open.text); setHtml(open.html || "");
        setExtraction(d.reviewExtraction); setBulkReviewId(open.id); setReviewEpoch((n) => n + 1);
        setMode("review");
      } else { setBulkReviewId(null); setMode("bulk"); }
    }
    setErrMsg("");
    flash(draftOffer.light ? "Draft restored. The formatted view of the documents was too big to keep, so they show as plain text." : "Draft restored");
    setDraftOffer(null);
  };
  // ── Recently deleted (UX-04) ──
  const [trash, setTrash] = useState(null);        // null | { state: "loading" } | { state: "error", message } | { state: "ready", docs, records }
  const [restoringId, setRestoringId] = useState(null);
  const loadTrash = async (quiet = false) => {
    if (!quiet) setTrash({ state: "loading" });
    try { const r = await window.db.trashList(); setTrash({ state: "ready", docs: r.docs || [], records: r.records || [] }); }
    catch (e) { setTrash({ state: "error", message: String((e && e.message) || "The list could not be loaded.") }); }
  };
  const openTrash = () => { setMode("trash"); loadTrash(); };
  const restoreOne = async (kind, id) => {
    setRestoringId(id);
    try {
      if (kind === "doc") await window.db.restoreDocument(id); else await window.db.restoreRecord(id);
      try { await refreshKB(); } catch { /* it is restored; the library list refreshes on the next load */ }
      flash(kind === "doc" ? "Material restored" : "Strategy restored");
      await loadTrash(true);
    } catch (e) { setErrMsg(String((e && e.message) || "It could not be restored. Try again.")); await loadTrash(true); }
    setRestoringId(null);
  };
  const askDiscardDraft = () => setConfirm({
    title: "Discard the saved draft?", message: "The unsaved work kept in this browser is deleted. This cannot be undone.",
    confirmLabel: "Discard draft", onConfirm: () => { clearDraft(draftOwner); setDraftOffer(null); },
  });
  const [editDoc, setEditDoc] = useState(null);
  const [editLevers, setEditLevers] = useState([]);
  const [editLeverRecord, setEditLeverRecord] = useState(null);
  const [newPass, setNewPass] = useState("");
  // The filters live in the address (src/lib/route.js): they survive a refresh, work with the Back button, and can be shared as a link.
  const kbF = useRoute().kb;
  const search = kbF.q;
  const leverFilter = kbF.lever === "all" || leverKeys.includes(kbF.lever) ? kbF.lever : "all"; // a lever that does not exist (an old or hand-typed link) shows everything
  const mainCat = kbF.industry;
  const subCat = kbF.sub;
  const sortKey = kbF.sort;
  const setSearch = (v) => navigate({ kb: { q: v } });
  const setLeverFilter = (v) => navigate({ kb: { lever: v } });
  const setMainCat = (v) => navigate({ kb: { industry: v, sub: "all" } });
  const setSubCat = (v) => navigate({ kb: { sub: v } });
  const setSortKey = (v) => navigate({ kb: { sort: v } });
  const [pickerRecord, setPickerRecord] = useState(null);
  const [statPicker, setStatPicker] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!setAdminLocked) return;
    const locked =
      mode === "edit" || mode === "review" || mode === "add" || mode === "bulk" ||
      busy ||
      editLeverRecord !== null ||
      pickerRecord !== null ||
      importPlan !== null ||
      statPicker;
    setAdminLocked(locked);
    return () => setAdminLocked(false);
  }, [mode, busy, editLeverRecord, pickerRecord, statPicker, importPlan, setAdminLocked]);

  // for each extracted item in the bulk list: how many records it would save, how many resemble records already in the library, and its warnings
  const bulkFlags = useMemo(() => {
    const out = {};
    bulkItems.filter((x) => x.status === "done").forEach((x) => { out[x.id] = itemFlags(x, levers, (a, b) => Math.max(claimSimilarity(a, b), 0)); });
    return out;
  }, [bulkItems, levers]);
  const flagsOf = (it) => bulkFlags[it.id] || { records: 0, similar: 0, warnings: [] };

  // tell the app when something is running, and warn before the page is closed/refreshed with work in progress or an unsaved review
  const working = busy || bulkRunning || !!bulkSaving;
  useEffect(() => { if (onWorking) onWorking(working); }, [working, onWorking]);
  useEffect(() => {
    const unsaved = working || mode === "review" || (mode === "bulk" && bulkItems.some((x) => x.status === "done"));
    if (!unsaved) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [working, mode, bulkItems]);

  const onFile = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    if (files.length === 1) {
      try {
        const p = await parseDocxFile(files[0]);
        setText(p.text);
        setHtml(p.html);
        setMnaChoice(null);
        if (!title) setTitle(p.title);
      } catch { setErrMsg(t.apiErr); }
      return;
    }
    /* bulk mode */
    try {
      const items = [];
      for (const f of files) {
        const p = await parseDocxFile(f);
        const detected = detectMnaDocument(p.text, p.title);
        const stories = planSplit(p.text, p.html);
        items.push({ id: uid(), name: f.name, ...p, status: "ready", include: true, mna: detected, detectedMna: detected, storyCount: stories ? stories.cards.length : 0, extraction: null });
      }
      setBulkItems(items);
      setMode("bulk"); // nothing is sent to the AI until the person presses Start extraction
    } catch { setErrMsg(t.apiErr); }
  };

  // the M&A question: resolves "mna", "normal" or "skip" when the person answers
  const askMna = (name, body, chosen) => new Promise((resolve) => {
    const headings = [...new Set(String(body || "").split(/\n\s*\n/).map((p) => p.trim()).filter((p) => mnaSectionKind(p)))].slice(0, 6);
    mnaResolveRef.current = resolve;
    setMnaAsk({ name, chosen, headings });
  });
  const answerMna = (pick) => { const r = mnaResolveRef.current; mnaResolveRef.current = null; setMnaAsk(null); if (r) r(pick); };
  // undefined = follow the detection; true / false = read it in that mode; null = skip the file. Asks only when the person's tick disagrees with the headings.
  const pickMnaMode = async (name, body, docTitle, chosen) => {
    if (typeof chosen !== "boolean" || chosen === detectMnaDocument(body, docTitle)) return chosen;
    const pick = await askMna(name, body, chosen);
    return pick === "skip" ? null : pick === "mna";
  };
  const SKIPPED = "Skipped: you chose not to extract this file. Press Retry to extract it.";

  // the confirmation page: what to extract, and whether each file is an M&A document
  const setBulkInclude = (id, on) => setBulkItems((arr) => arr.map((x) => (x.id === id ? { ...x, include: on } : x)));
  const setBulkMna = (id, on) => setBulkItems((arr) => arr.map((x) => (x.id === id ? { ...x, mna: on } : x)));
  const startBulk = () => {
    const chosen = bulkItems.filter((x) => x.status !== "ready" || x.include !== false).map((x) => (x.status === "ready" ? { ...x, status: "pending" } : x));
    if (!chosen.length) return;
    setBulkItems(chosen);
    runBulk(chosen);
  };

  /* sequential, TPM-paced queue: one extraction ≈ one minute of an 8k-TPM quota,
     so docs are spaced ~70s apart; askAI's 429 handling is the safety net */
  const runBulk = async (items) => {
    bulkCancelRef.current = false;
    const runId = ++bulkRunIdRef.current;
    setErrMsg("");
    setBulkRunning(true);
    for (let i = 0; i < items.length; i++) {
      if (bulkCancelRef.current || runId !== bulkRunIdRef.current) break;
      const it = items[i];
      const offer = planSplit(it.text, it.html); // a file of separate stories waits for the person's choice instead of being extracted whole
      if (offer) { setBulkItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, status: "offer", offer } : x))); continue; }
      const mnaMode = await pickMnaMode(it.title, it.text, it.title, it.mna);
      if (runId !== bulkRunIdRef.current) break; // the person left while the question was open
      if (mnaMode === null) { setBulkItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, status: "error", error: SKIPPED } : x))); continue; }
      setBulkItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, status: "extracting" } : x)));
      const startedAt = Date.now();
      try {
        const j = await extractDocument(it.text, it.title, config?.customLevers || [], it.html, { mna: mnaMode });
        setBulkItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, status: "done", extraction: j, error: "", elapsed: Date.now() - startedAt } : x)));
      } catch (e) {
        const msg = describeAIError(e, t);
        setBulkItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, status: "error", error: msg } : x)));
        setErrMsg(msg);
        // daily quota gone: every remaining document would fail the same way — stop the queue, leave them pending
        if (e instanceof AIError && e.kind === "daily") break;
      }
      if (i < items.length - 1 && !bulkCancelRef.current && runId === bulkRunIdRef.current) {
        const pauseSec = (await keysInUse()) > 1 ? 0 : 45; // several keys: the token budget does the pacing; one key: the original 45 s gap
        for (let sLeft = pauseSec; sLeft > 0; sLeft--) {
          if (bulkCancelRef.current || runId !== bulkRunIdRef.current) break;
          setBulkWait(sLeft);
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (runId === bulkRunIdRef.current) setBulkWait(0);
      }
    }
    if (runId === bulkRunIdRef.current) { setBulkWait(0); setBulkRunning(false); } // a queue that was left is already switched off
  };

  const retryBulkItem = async (itemId) => {
    const it = bulkItems.find((x) => x.id === itemId);
    if (!it || bulkRunning) return;
    const mnaMode = await pickMnaMode(it.title, it.text, it.title, it.mna);
    if (mnaMode === null) { setBulkItems((arr) => arr.map((x) => (x.id === itemId ? { ...x, status: "error", error: SKIPPED } : x))); return; }
    setBulkItems((arr) => arr.map((x) => (x.id === itemId ? { ...x, status: "extracting" } : x)));
    try {
      const j = await extractDocument(it.text, it.title, config?.customLevers || [], it.html, { mna: mnaMode });
      setBulkItems((arr) => arr.map((x) => (x.id === itemId ? { ...x, status: "done", extraction: j, error: "" } : x)));
      setErrMsg("");
    } catch (e) {
      const msg = describeAIError(e, t);
      setBulkItems((arr) => arr.map((x) => (x.id === itemId ? { ...x, status: "error", error: msg } : x)));
      setErrMsg(msg);
    }
  };

  const reviewBulkItem = (itemId) => {
    const it = bulkItems.find((x) => x.id === itemId);
    if (!it || !it.extraction) return;
    setTitle(it.title);
    setText(it.text);
    setHtml(it.html);
    setExtraction(it.extraction);
    setBulkReviewId(itemId);
    setMode("review");
  };

  const runExtract = async () => {
    if (!text.trim()) return;
    const declined = splitDeclinedRef.current;
    splitDeclinedRef.current = false;
    setSplitOffer(null);
    if (!declined) {
      const offer = planSplit(text, html); // a file of separate stories: ask before spending any AI on it
      if (offer) { setSplitOffer({ ...offer, forText: text, parentTitle: cleanDocTitle(title) || "Uploaded file" }); return; }
    }
    const mnaMode = await pickMnaMode(cleanDocTitle(title) || "This text", text, title, mnaChoice === null ? undefined : mnaChoice);
    if (mnaMode === null) return; // the person chose to skip it
    const runId = ++extractRunRef.current;
    setBusy(true); setErrMsg(""); setStage("analyze");
    const stageTimer = setTimeout(() => setStage("levers"), 7000); // presentational: one AI call, staged for confidence
    const startedAt = Date.now();
    let cancelled = false; // the person went back while this was running: its answer is thrown away
    try {
      const j = await extractDocument(text, title, config?.customLevers || [], html, { mna: mnaMode });
      if (runId !== extractRunRef.current) cancelled = true;
      else {
        setExtraction(j);
        setMode("review");
        flash(`Extracted in ${fmtElapsed(Date.now() - startedAt)} (${fastExtraction() ? "fast mode" : "normal mode"})`);
      }
    } catch (e) { if (runId !== extractRunRef.current) cancelled = true; else setErrMsg(describeAIError(e, t)); }
    clearTimeout(stageTimer);
    if (!cancelled) { setStage(""); setBusy(false); }
  };

  // "Split into N cards": the cards go into the bulk list (already extracted), where each one is reviewed and saved on its own
  const acceptSplit = async () => {
    if (!splitOffer) return;
    setBusy(true); setErrMsg("");
    try {
      const items = await buildCompilationItems(splitOffer, splitOffer.parentTitle);
      setBulkItems(items);
      setSplitOffer(null);
      setTitle(""); setText(""); setHtml("");
      setMode("bulk");
      flash(`Split into ${items.length} cards`);
    } catch (e) { setErrMsg(describeAIError(e, t)); }
    setBusy(false);
  };
  const keepWhole = () => { splitDeclinedRef.current = true; runExtract(); };

  // the same choice for a file that arrived in a bulk upload
  const acceptBulkSplit = async (itemId) => {
    const it = bulkItems.find((x) => x.id === itemId);
    if (!it || !it.offer) return;
    setSplitBusyId(itemId); setErrMsg("");
    try {
      const items = await buildCompilationItems(it.offer, it.title);
      setBulkItems((arr) => { const at = arr.findIndex((x) => x.id === itemId); return at < 0 ? arr : [...arr.slice(0, at), ...items, ...arr.slice(at + 1)]; });
    } catch (e) { setErrMsg(describeAIError(e, t)); }
    setSplitBusyId(null);
  };
  const keepBulkWhole = (itemId) => {
    setBulkItems((arr) => arr.map((x) => (x.id === itemId ? { ...x, status: "pending", offer: null } : x)));
    setTimeout(() => retryBulkItem(itemId), 0); // only offered while the queue is idle, so it can run straight away
  };

  // builds and stores ONE document with its records, with no screen changes; used by the single "Confirm & save" and by "Save selected"
  const saveExtraction = async ({ extraction: ex, text: fullText, html: fullHtml, title: fallbackTitle }) => {
    const id = uid();
    const doc = {
      id,
      status: "active",
      created_by: me(),
      title: cleanDocTitle(ex.title || fallbackTitle) || "Untitled",
      doc_type: ex.doc_type || "notes",
      industry: ex.industry || "General",
      industry_main: ex.industry_main || normalizeMainCategory(ex.industry || "General"),
      industry_sub: ex.industry_sub || "",
      language: ex.language || "en",
      problem_signature: ex.problem_signature || "",
      sections: ex.sections || [],
      full_text: String(fullText || "").slice(0, FULL_TEXT_LIMIT),
      html: fullHtml || "",
      created: Date.now(),
    };
    const records = [];
    (ex.levers || []).forEach((lr) => {
      if (leverKeys.includes(lr.lever) && !lr.skip && hasClaimText(lr)) {
        const clean = { ...lr };
        delete clean.skip;
        delete clean.added; // only marks a record typed in by hand on the review screen
        records.push(normalizeOther({ id: uid(), status: "active", created_by: me(), doc_id: id, doc_title: doc.title, ...clean }));
      }
    });
    await window.db.saveDocument(doc, records);
    return doc;
  };

  // ── bulk list: tick what to save or discard ──
  const setTick = (id, on) => setBulkTicks((m) => ({ ...m, [id]: on }));
  const setAllTicks = (on) => setBulkTicks(Object.fromEntries(bulkItems.filter((x) => x.status === "done").map((x) => [x.id, on])));
  const saveTicked = async () => {
    const sum = summarizeTicked(bulkItems, bulkTicks, flagsOf);
    const items = bulkItems.filter((x) => sum.ids.includes(x.id));
    if (!items.length) return;
    setErrMsg(""); setBulkSaving({ done: 0, total: items.length });
    const { saved, failed } = await saveMany(items, (it) => saveExtraction({ extraction: it.extraction, text: it.text, html: it.html, title: it.title }), setBulkSaving);
    try { if (saved.length) await refreshKB(); } catch { /* the documents are saved; the library list refreshes on the next load */ }
    setBulkItems((arr) => arr.filter((x) => !saved.includes(x.id)));
    setBulkTicks({});
    setBulkSaving(null);
    if (failed.length) setErrMsg(`${failed.length} of ${items.length} could not be saved and stay in the list (${failed[0].error}). The other ${saved.length} were saved.`);
    else flash(`${saved.length} ${saved.length === 1 ? "document" : "documents"} saved`);
    if (!failed.length && !bulkRunning && bulkItems.every((x) => saved.includes(x.id))) setMode("list");
  };

  // ── a question before each action that saves, discards or leaves ──
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const askSaveSelected = () => {
    const sum = summarizeTicked(bulkItems, bulkTicks, flagsOf);
    if (!sum.docs) return;
    const readyLeft = bulkItems.filter((x) => x.status === "done").length - sum.docs;
    const details = [`${plural(sum.records, "lever record")} will be added to the library.`];
    if (sum.flagged) details.push(`${plural(sum.flagged, "ticked item")} still ${sum.flagged === 1 ? "has" : "have"} a warning or a record similar to one already in the library. You ticked ${sum.flagged === 1 ? "it" : "them"} yourself, so ${sum.flagged === 1 ? "it is" : "they are"} saved too.`);
    if (readyLeft > 0) details.push(`${plural(readyLeft, "ready item")} stay${readyLeft === 1 ? "s" : ""} in the list, unsaved.`);
    setConfirm({ title: `Save ${plural(sum.docs, "document")}?`, message: "Each one is saved as its own document in the library.", details, confirmLabel: `Save ${sum.docs}`, tone: "primary", onConfirm: saveTicked });
  };
  const dropItems = (ids) => {
    setBulkItems((arr) => arr.filter((x) => !ids.includes(x.id)));
    setBulkTicks({});
    if (!bulkRunning && bulkItems.every((x) => ids.includes(x.id))) setMode("list");
  };
  const askDiscardSelected = () => {
    const sum = summarizeTicked(bulkItems, bulkTicks, flagsOf);
    if (!sum.docs) return;
    setConfirm({ title: `Discard ${plural(sum.docs, "ready item")}?`, message: "Their extractions are removed from this list. Nothing was saved, so this cannot be undone.", confirmLabel: `Discard ${sum.docs}`, onConfirm: () => dropItems(sum.ids) });
  };
  const askDiscardItem = (it) => {
    setConfirm({ title: "Discard this file?", message: `"${it.title}" and its extraction are removed from the list. Nothing was saved, so this cannot be undone.`, confirmLabel: "Discard", onConfirm: () => dropItems([it.id]) });
  };
  const askStopQueue = () => {
    setConfirm({ title: "Stop the queue?", message: "The file being extracted right now will finish. The files still waiting are not started. Everything already extracted stays in the list.", confirmLabel: "Stop queue", onConfirm: () => { bulkCancelRef.current = true; } });
  };
  const leaveBulk = () => { answerMna("skip"); bulkRunIdRef.current++; bulkCancelRef.current = true; setBulkRunning(false); setBulkWait(0); setBulkItems([]); setBulkTicks({}); setErrMsg(""); setMode("list"); };
  const askLeaveBulk = () => {
    if (!bulkItems.length) { leaveBulk(); return; }
    const ready = bulkItems.filter((x) => x.status === "done").length;
    const details = [];
    if (ready) details.push(`${plural(ready, "extracted item")} not saved yet will be lost.`);
    if (bulkRunning) details.push("The extraction in progress stops, and the AI calls already started finish in the background with no result used.");
    setConfirm({ title: bulkRunning ? "Extraction is still running" : "Leave without saving?", message: bulkRunning ? "If you go back to the library now, the queue stops and everything in this list is discarded." : "If you go back to the library now, everything in this list is discarded.", details, confirmLabel: "Discard and go back", onConfirm: leaveBulk });
  };
  const goHomeFromAdd = () => { setMnaChoice(null); setSplitOffer(null); setTitle(""); setText(""); setHtml(""); setErrMsg(""); setMode("list"); };
  const askCancelAdd = () => {
    if (busy) {
      setConfirm({ title: "Extraction is still running", message: "Go back and cancel it? The AI calls already started finish in the background, but their result is thrown away.", confirmLabel: "Cancel extraction and go back", onConfirm: () => { extractRunRef.current++; setBusy(false); setStage(""); goHomeFromAdd(); } });
    } else if (text.trim() || title.trim()) {
      setConfirm({ title: "Go back without extracting?", message: "The title and text you entered or uploaded here will be cleared.", confirmLabel: "Clear and go back", onConfirm: goHomeFromAdd });
    } else goHomeFromAdd();
  };
  const reviewRecordCounts = () => {
    const all = (extraction && extraction.levers) || [];
    return { save: all.filter((l) => leverKeys.includes(l.lever) && !l.skip && hasClaimText(l)).length, skipped: all.filter((l) => l.skip).length };
  };
  const askSaveReview = () => {
    const c = reviewRecordCounts();
    const name = cleanDocTitle((extraction && extraction.title) || title) || "Untitled";
    const details = [];
    if (c.skipped) details.push(`${plural(c.skipped, "record")} marked "skip" ${c.skipped === 1 ? "is" : "are"} not saved.`);
    setConfirm({ title: "Save to the library?", message: `"${name}" will be saved as a new document with ${plural(c.save, "lever record")}.`, details, confirmLabel: "Save", tone: "primary", onConfirm: saveDoc });
  };
  const leaveReview = () => { if (bulkReviewId) { setBulkReviewId(null); setMode("bulk"); } else setMode("add"); };
  const askLeaveReview = () => {
    if (bulkReviewId) setConfirm({ title: "Leave this review?", message: "Your edits on this screen are lost. The extraction stays in the list, unsaved.", confirmLabel: "Back to the list", onConfirm: leaveReview });
    else setConfirm({ title: "Discard this extraction?", message: "Your edits on this screen are lost and nothing is saved. The text you pasted or uploaded stays on the previous screen so you can extract it again.", confirmLabel: "Discard", onConfirm: leaveReview });
  };
  const leaveEdit = () => { setMode("list"); setEditDoc(null); setEditLevers([]); };
  const askLeaveEdit = () => {
    const changed = !!editDoc && JSON.stringify({ d: editDoc, l: editLevers }) !== editBase;
    if (!changed) { leaveEdit(); return; }
    setConfirm({ title: "Discard your changes?", message: "You changed this document and have not saved. Going back loses those changes.", confirmLabel: "Discard changes", onConfirm: leaveEdit });
  };

  const askSaveEdit = () => {
    setConfirm({ title: "Save your changes?", message: `Your changes to "${(editDoc && editDoc.title) || "this document"}" and its lever records will be saved.`, confirmLabel: "Save changes", tone: "primary", onConfirm: saveEdit });
  };

  const saveDoc = async () => {
    setBusy(true); setErrMsg("");
    try {
      await saveExtraction({ extraction, text, html, title });
      await refreshKB();
      if (bulkReviewId) {
        const remaining = bulkItems.filter((x) => x.id !== bulkReviewId);
        setBulkItems(remaining);
        setBulkReviewId(null);
        setTitle(""); setText(""); setHtml(""); setExtraction(null);
        setMode(remaining.length ? "bulk" : "list");
      } else {
        setMode("list"); setTitle(""); setText(""); setHtml(""); setExtraction(null);
      }
      flash(t.saved);
    } catch { setErrMsg(t.loadErr); }
    setBusy(false);
  };

  const deleteDoc = (docId) => {
    setConfirm({
      message: t.delConfirm,
      details: ["You can bring it back from Recently deleted."],
      confirmLabel: "Delete",
      onConfirm: async () => {
        try {
          await window.db.deleteDocument(docId); // soft delete: the document and its lever records stay in storage, marked deleted
          await refreshKB();
          flash("Deleted. You can restore it from Recently deleted.");
        } catch (e) { setErrMsg(`The material could not be deleted. ${String((e && e.message) || "")}`.trim()); }
      },
    });
  };

  const startEdit = async (docId) => {
    const doc = await window.db.getDocument(docId, { fresh: true });
    if (!doc) return;
    const docCopy = JSON.parse(JSON.stringify(doc));
    const leverCopy = sortByLever(levers.filter((l) => l.doc_id === docId)).map((l) => ({ ...l }));
    setEditDoc(docCopy);
    setEditLevers(leverCopy);
    setEditBase(JSON.stringify({ d: docCopy, l: leverCopy })); // what "unchanged" means when the person goes back
    setMode("edit");
  };

  const saveLeverRecord = async () => {
    if (!editLeverRecord) return;
    setBusy(true); setErrMsg("");
    try {
      await window.db.saveRecord(normalizeOther({ ...editLeverRecord }));
      await refreshKB();
      setEditLeverRecord(null);
      flash(t.saved);
    } catch { setErrMsg(t.loadErr); }
    setBusy(false);
  };

  const deleteLeverRecord = (record) => {
    setConfirm({
      message: "Delete this strategy?",
      details: ["You can bring it back from Recently deleted."],
      confirmLabel: "Delete",
      onConfirm: async () => {
        try {
          await window.db.deleteRecord(record.id); // soft delete
          await refreshKB();
          flash("Deleted. You can restore it from Recently deleted.");
        } catch (e) { setErrMsg(`The strategy could not be deleted. ${String((e && e.message) || "")}`.trim()); }
      },
    });
  };

  const saveEdit = async () => {
    setBusy(true); setErrMsg("");
    try {
      const docToSave = editDoc.industry_main ? editDoc : { ...editDoc, industry_main: normalizeMainCategory(editDoc.industry || "General") };
      const mine = editLevers
        .filter((l) => leverKeys.includes(l.lever) && ((l.claim_en || "").trim() || (l.claim_zh || "").trim()))
        .map((l) => normalizeOther({ status: "active", ...l, doc_title: editDoc.title }));
      // records of this document that are no longer on the edit screen (removed, or emptied) stay in storage, marked deleted
      await window.db.updateDocument(docToSave, mine);
      await refreshKB();
      setMode("list"); setEditDoc(null); setEditLevers([]);
      flash(t.saved);
    } catch { setErrMsg(t.loadErr); }
    setBusy(false);
  };

  const savePass = async () => {
    if (!newPass.trim()) return;
    const cfg = { ...config, adminPass: newPass.trim() };
    try {
      await window.db.saveConfig(cfg);
      setConfig(cfg);
      setNewPass(""); flash(t.passChanged);
    } catch (e) { setErrMsg(String(e?.message || t.loadErr)); }
  };

  const importRef = useRef(null);

  // Import Backup, step 1: read the file and build a preview (what is new, what is already here, what was deleted, which settings come along)
  const importBackup = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErrMsg("");
    try {
      const parsed = JSON.parse(await f.text());
      if (!parsed || !Array.isArray(parsed.index) || !Array.isArray(parsed.docs)) { setErrMsg(t.importErr); return; }
      const docs = parsed.docs.filter((d) => d && d.id);
      const check = await window.db.importCheck(docs.map((d) => d.id));
      const have = new Set(check.exists), gone = new Set(check.deleted);
      const recs = (Array.isArray(parsed.levers) ? parsed.levers : []).filter((r) => r && r.id && isLive(r));
      const planDocs = docs.map((d) => ({
        id: d.id, title: d.title, doc_type: d.doc_type, industry: d.industry,
        state: gone.has(d.id) ? "deleted" : have.has(d.id) ? "exists" : "new",
        records: recs.filter((r) => r.doc_id === d.id),
      }));
      const pc = parsed.config || {};
      const cur = config || {};
      const cfgItems = [
        ...(Array.isArray(pc.customLevers) ? pc.customLevers : []).filter((l) => l && l.id && l.name).map((l) => ({ key: "customLevers:" + l.id, kind: "customLevers", id: l.id, label: "Custom lever: " + l.name, detail: l.description, exists: (cur.customLevers || []).some((x) => x.id === l.id) })),
        ...Object.entries(pc.leverOverrides && typeof pc.leverOverrides === "object" ? pc.leverOverrides : {}).map(([id, o]) => ({ key: "leverOverrides:" + id, kind: "leverOverrides", id, label: "Edited built-in lever: " + (T.en.levers[id] || id), detail: [o && o.name, o && o.description].filter(Boolean).join(" · "), exists: !!(cur.leverOverrides || {})[id] })),
        ...(Array.isArray(pc.customOtherCats) ? pc.customOtherCats : []).filter((c) => c && c.id && c.name).map((c) => ({ key: "customOtherCats:" + c.id, kind: "customOtherCats", id: c.id, label: "Custom Others sub-category: " + c.name, detail: c.description, exists: (cur.customOtherCats || []).some((x) => x.id === c.id) })),
        ...Object.entries(pc.otherCatOverrides && typeof pc.otherCatOverrides === "object" ? pc.otherCatOverrides : {}).map(([id, o]) => ({ key: "otherCatOverrides:" + id, kind: "otherCatOverrides", id, label: "Edited Others sub-category: " + (T.en.otherCats[id] || id), detail: [o && o.name, o && o.description].filter(Boolean).join(" · "), exists: !!(cur.otherCatOverrides || {})[id] })),
      ];
      setImportPlan({ parsed, docs: planDocs, cfgItems, fileName: f.name, exportedAt: parsed.exported_at });
    } catch (err) { setErrMsg(window.storage?.remote && err && err.message && !/JSON/i.test(err.message) ? String(err.message) : t.importErr); }
  };

  // Import Backup, step 2: import only what was ticked in the preview
  const confirmImport = async ({ docIds, cfgKeys }) => {
    const plan = importPlan; if (!plan) return;
    setBusy(true); setErrMsg("");
    try {
      const pick = plan.cfgItems.filter((c) => cfgKeys.has(c.key));
      const sub = { customLevers: [], customOtherCats: [], leverOverrides: {}, otherCatOverrides: {} };
      pick.forEach((c) => {
        const src = plan.parsed.config || {};
        if (c.kind === "customLevers") sub.customLevers.push(src.customLevers.find((x) => x.id === c.id));
        else if (c.kind === "customOtherCats") sub.customOtherCats.push(src.customOtherCats.find((x) => x.id === c.id));
        else sub[c.kind][c.id] = src[c.kind][c.id];
      });
      const filtered = {
        ...plan.parsed,
        docs: plan.parsed.docs.filter((d) => d && docIds.has(d.id)),
        index: (plan.parsed.index || []).filter((d) => d && docIds.has(d.id)),
        levers: (Array.isArray(plan.parsed.levers) ? plan.parsed.levers : []).filter((r) => r && docIds.has(r.doc_id)),
        config: sub,
      };
      const { added, records, config: merged } = await window.db.importBackup(filtered);
      if (merged) setConfig(merged);
      await refreshKB();
      setImportPlan(null);
      flash(`Imported ${added} material${added === 1 ? "" : "s"}, ${records ?? 0} strateg${records === 1 ? "y" : "ies"}${pick.length ? `, ${pick.length} lever setting${pick.length === 1 ? "" : "s"}` : ""}`);
    } catch (err) {
      setErrMsg(window.storage?.remote ? String(err?.message || t.importErr) : t.importQuotaErr); // local storage: most likely the 5MB cap
      setImportPlan(null);
    }
    setBusy(false);
  };

  const exportBackup = async () => {
    const all = await window.db.exportAll();
    const { adminPass, ...cleanConfig } = all.config || {}; void adminPass; // the passcode is never written into a backup
    const backup = { version: 1, exported_at: Date.now(), config: cleanConfig, index: all.index, levers: all.levers, docs: all.docs };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `yyc-brain-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
    flash("Exported");
  };

  // Worked out once when the library changes, not on every keystroke (PERF-03): records per document, and each document's industry.
  const leverCountById = useMemo(() => { const m = new Map(); for (const l of levers) m.set(l.doc_id, (m.get(l.doc_id) || 0) + 1); return m; }, [levers]);
  const leverCount = (docId) => leverCountById.get(docId) || 0;
  const metaById = useMemo(() => {
    const m = new Map();
    for (const d of index) { const parsed = parseIndustry(d.industry || "", d); m.set(d.id, { main: parsed.main || "General", sub: parsed.sub || "" }); }
    return m;
  }, [index]);
  const docMeta = (doc) => metaById.get(doc.id) || { main: "General", sub: "" };

  const mainCategories = useMemo(() => Array.from(new Set([...metaById.values()].map((m) => m.main).filter(Boolean))).sort(), [metaById]);
  const subCategories = useMemo(() => Array.from(new Set(index.filter((d) => mainCat === "all" || docMeta(d).main === mainCat).map((d) => docMeta(d).sub).filter(Boolean))).sort(), [index, metaById, mainCat]); // eslint-disable-line react-hooks/exhaustive-deps -- docMeta only reads metaById

  // The search box shows each letter at once; the list catches up a moment later and never blocks typing.
  const deferredSearch = useDeferredValue(search);
  const filteredIndex = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return index.filter((d) => {
      const { main, sub } = metaById.get(d.id) || { main: "General", sub: "" };
      if (mainCat !== "all" && main !== mainCat) return false;
      if (subCat !== "all" && sub !== subCat) return false;
      if (q && !`${d.title || ""} ${d.industry || ""} ${d.problem_signature || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [index, metaById, mainCat, subCat, deferredSearch]);

  const groupedLevers = useMemo(() => {
    const grouped = {};
    for (const l of levers) {
      if (leverFilter !== "all" && l.lever !== leverFilter) continue;
      if (mainCat !== "all" || subCat !== "all") {
        const { main, sub } = metaById.get(l.doc_id) || {};
        if (!main) continue;
        if (mainCat !== "all" && main !== mainCat) continue;
        if (subCat !== "all" && sub !== subCat) continue;
      }
      (grouped[l.doc_id] ||= []).push(l);
    }
    return grouped;
  }, [levers, metaById, leverFilter, mainCat, subCat]);

  // Sorting (UX-05): the order of the cards, and of the materials inside a lever list. The default, "oldest", is the order the library has always had.
  const docRank = useMemo(() => {
    const title = (a, b) => String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base", numeric: true });
    const by = {
      oldest: (a, b) => (a.created || 0) - (b.created || 0),
      newest: (a, b) => (b.created || 0) - (a.created || 0),
      az: title,
      levers: (a, b) => (leverCountById.get(b.id) || 0) - (leverCountById.get(a.id) || 0) || title(a, b),
    }[sortKey] || ((a, b) => (a.created || 0) - (b.created || 0));
    return new Map([...index].sort(by).map((d, i) => [d.id, i]));
  }, [index, sortKey, leverCountById]);
  const sortedIndex = useMemo(() => [...filteredIndex].sort((a, b) => docRank.get(a.id) - docRank.get(b.id)), [filteredIndex, docRank]);
  const groupedEntries = useMemo(() => Object.entries(groupedLevers).sort((a, b) => (docRank.get(a[0]) ?? 1e9) - (docRank.get(b[0]) ?? 1e9)), [groupedLevers, docRank]);

  // The cards are memoised, so a keystroke only redraws the cards that really changed. They get stable handlers that always call the latest functions.
  const latestHandlers = useRef({});
  useEffect(() => { latestHandlers.current = { openPreview, startEdit, deleteDoc }; });
  const cardHandlers = useMemo(() => ({ open: (id) => latestHandlers.current.openPreview?.(id), warm: (id) => window.db?.warmDocuments([id]), edit: (id) => latestHandlers.current.startEdit?.(id), del: (id) => latestHandlers.current.deleteDoc?.(id) }), []);

  const clearAllFilters = () => navigate({ kb: { q: "", lever: "all", industry: "all", sub: "all" } }); // the sort stays
  const anyFilterActive = !!(search.trim() || leverFilter !== "all" || mainCat !== "all" || subCat !== "all");
  const many = (n, one, other) => `${n} ${n === 1 ? one : other}`;
  const docsShown = leverFilter !== "all" ? groupedEntries.length : sortedIndex.length;
  const resultsText = leverFilter !== "all"
    ? `${many(groupedEntries.reduce((n, [, recs]) => n + recs.length, 0), "strategy", "strategies")} in ${many(docsShown, "material", "materials")}`
    : anyFilterActive ? `Showing ${docsShown} of ${many(index.length, "material", "materials")}` : many(index.length, "material", "materials");
  const activeTags = [
    ...(search.trim() ? [{ key: "q", label: `Search: “${search.trim().slice(0, 24)}${search.trim().length > 24 ? "…" : ""}”`, remove: () => setSearch("") }] : []),
    ...(leverFilter !== "all" ? [{ key: "lever", label: `Lever: ${t.levers[leverFilter] || leverFilter}`, remove: () => setLeverFilter("all") }] : []),
    ...(mainCat !== "all" ? [{ key: "industry", label: `Industry: ${mainCat}`, remove: () => setMainCat("all") }] : []),
    ...(subCat !== "all" ? [{ key: "sub", label: `Sub-industry: ${subCat}`, remove: () => setSubCat("all") }] : []),
  ];

  if (mode === "trash" && isAdmin) {
    const when = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? ageLabel(ms) : "earlier"; };
    const by = (x) => (x.deleted_by ? ` by ${x.deleted_by}` : "");
    const docs = trash && trash.state === "ready" ? trash.docs : [], recs = trash && trash.state === "ready" ? trash.records : [];
    return (
      <div>
        <div className="yyc-section-head">
          <div>
            <button className="yyc-btn-secondary" onClick={() => setMode("list")} style={{ padding: "7px 12px", marginBottom: 10 }}><Icon name="arrowLeft" size={13} /> Back to the library</button>
            <h1 className="yyc-section-title">Recently deleted</h1>
            <div className="yyc-section-sub">Nothing you delete is lost. Restore a material (with the strategies that were deleted with it) or a single strategy.</div>
          </div>
        </div>
        {(!trash || trash.state === "loading") && <SkeletonLines rows={6} label="Loading the deleted items" />}
        {trash && trash.state === "error" && (
          <div role="alert" className="yyc-empty">
            <div className="yyc-empty-icon"><Icon name="alert" size={22} /></div>
            The list could not be loaded. {trash.message}
            <div style={{ marginTop: 12 }}><button className="yyc-btn-primary" onClick={() => loadTrash()}>Try again</button></div>
          </div>
        )}
        {trash && trash.state === "ready" && !docs.length && !recs.length && (
          <div className="yyc-empty"><div className="yyc-empty-icon"><Icon name="check" size={22} /></div>Nothing has been deleted.</div>
        )}
        {docs.length > 0 && (
          <section aria-labelledby="trash-docs" style={{ marginBottom: 26 }}>
            <h2 id="trash-docs" className="yyc-trash-h">Materials <span>({docs.length})</span></h2>
            <div className="yyc-trash-list">
              {docs.map((d) => (
                <div key={d.id} className="yyc-trash-row">
                  <div className="yyc-trash-main">
                    <div className="yyc-trash-title">{d.title || "Untitled"}</div>
                    <div className="yyc-trash-meta">{[t.docTypes[d.doc_type] || d.doc_type, d.industry].filter(Boolean).join(" · ")}{d.industry || d.doc_type ? " · " : ""}Deleted {when(d.deleted_at)}{by(d)}</div>
                  </div>
                  <button className="yyc-btn-primary yyc-trash-btn" disabled={restoringId === d.id} onClick={() => restoreOne("doc", d.id)} aria-label={`Restore the material: ${d.title || "Untitled"}`}><Icon name="undo" size={14} /> {restoringId === d.id ? "Restoring…" : "Restore"}</button>
                </div>
              ))}
            </div>
          </section>
        )}
        {recs.length > 0 && (
          <section aria-labelledby="trash-recs">
            <h2 id="trash-recs" className="yyc-trash-h">Strategies <span>({recs.length})</span></h2>
            <div className="yyc-trash-list">
              {recs.map((r) => (
                <div key={r.id} className="yyc-trash-row">
                  <div className="yyc-trash-main">
                    <div className="yyc-trash-title">{r.claim || "(empty strategy)"}</div>
                    <div className="yyc-trash-meta">{t.levers[r.lever] || r.lever} · from {r.doc_title || "a material"} · Deleted {when(r.deleted_at)}{by(r)}</div>
                    {r.docDeleted && <div className="yyc-trash-note">Its material is deleted too. Restore the material first.</div>}
                  </div>
                  <button className="yyc-btn-primary yyc-trash-btn" disabled={restoringId === r.id || r.docDeleted} onClick={() => restoreOne("record", r.id)} aria-label={`Restore the strategy: ${r.claim || "empty strategy"}`}><Icon name="undo" size={14} /> {restoringId === r.id ? "Restoring…" : "Restore"}</button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  if (mode === "edit" && editDoc) {
    const setD = (patch) => setEditDoc((d) => ({ ...d, ...patch }));
    const setSec = (i, patch) =>
      setEditDoc((d) => ({ ...d, sections: d.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
    const delSec = (i) => setEditDoc((d) => ({ ...d, sections: d.sections.filter((_, j) => j !== i) }));
    const addSec = () => setEditDoc((d) => ({ ...d, sections: [...d.sections, { heading: "", summary_en: "", summary_zh: "" }] }));
    const setLev = (i, patch) => setEditLevers((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    const delLev = (i) => setEditLevers((ls) => ls.filter((_, j) => j !== i));
    const addLev = () => setEditLevers((ls) => [
      ...ls,
      { id: uid(), status: "active", doc_id: editDoc.id, doc_title: editDoc.title, lever: "price", claim_en: "", claim_zh: "", impact: "", section: "" },
    ]);

    return (
      <div>
        <div className="yyc-section-head">
          <div>
            <button className="yyc-btn-secondary" onClick={askLeaveEdit} style={{ padding: "7px 12px", marginBottom: 10 }}>
              <Icon name="arrowLeft" size={13} /> {t.cancel}
            </button>
            <h1 className="yyc-section-title">{t.editTitle}</h1>
          </div>
        </div>

        <div className="yyc-formcard" style={{ ...S.card, padding: 24 }}>
          <label style={S.label}>{t.titlePh.split(" (")[0]}</label>
          <input value={editDoc.title} onChange={(e) => setD({ title: e.target.value })} className="yyc-input" />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>
            <div>
              <label style={S.label}>{t.docType}</label>
              <select value={editDoc.doc_type} aria-label="Document type" onChange={(e) => setD({ doc_type: e.target.value })} className="yyc-input">
                {Object.entries(t.docTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>{t.industry}</label>
              <input
                value={editDoc.industry}
                onChange={(e) => {
                  const v = e.target.value;
                  const parsed = parseIndustry(v);
                  setD({ industry: v, industry_main: parsed.main, industry_sub: parsed.sub });
                }}
                className="yyc-input"
                placeholder="Furniture (trading/retail)"
              />
            </div>
            <div>
              <label style={S.label}>{t.problemSig}</label>
              <input value={editDoc.problem_signature} onChange={(e) => setD({ problem_signature: e.target.value })} className="yyc-input" />
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: P.faint, marginTop: 6 }}>
            Parsed as: <b style={{ color: P.ink }}>{editDoc.industry_main || "General"}</b>
            {editDoc.industry_sub ? ` · ${editDoc.industry_sub}` : ""}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `2px solid ${P.crimson}`, paddingBottom: 8, marginTop: 26 }}>
            <div style={{ fontWeight: 750, fontSize: 14, color: P.maroonText }}>
              {t.sections} <span style={{ color: P.faint }}>({editDoc.sections.length})</span>
            </div>
            <button className="yyc-btn-secondary" onClick={addSec} style={{ padding: "6px 12px", fontSize: 12 }}>
              <Icon name="plus" size={12} /> {t.addSection.replace("+ ", "")}
            </button>
          </div>
          {editDoc.sections.map((s, i) => (
            <div key={i} style={{ borderTop: i ? `1px solid ${P.line}` : "none", padding: "14px 0" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input value={s.heading} onChange={(e) => setSec(i, { heading: e.target.value })} className="yyc-input" style={{ flex: 1, fontWeight: 600 }} placeholder="Heading" />
                <button onClick={() => delSec(i)} className="yyc-icon-btn is-danger" aria-label="Remove this section"><Icon name="trash" size={13} /></button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8 }}>
                <textarea value={s.summary_en || ""} onChange={(e) => setSec(i, { summary_en: e.target.value })} rows={2} placeholder="EN summary" className="yyc-input" />
                {/* [ZH disabled for now] <textarea value={s.summary_zh || ""} onChange={(e) => setSec(i, { summary_zh: e.target.value })} rows={2} placeholder="中文摘要" className="yyc-input" /> */}
              </div>
            </div>
          ))}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `2px solid ${P.gold}`, paddingBottom: 8, marginTop: 26 }}>
            <div style={{ fontWeight: 750, fontSize: 14, color: P.maroonText }}>
              {t.leverRecords} <span style={{ color: P.faint }}>({editLevers.length})</span>
            </div>
            <button className="yyc-btn-secondary" onClick={addLev} style={{ padding: "6px 12px", fontSize: 12 }}>
              <Icon name="plus" size={12} /> {t.addRecord.replace("+ ", "")}
            </button>
          </div>
          {editLevers.map((l, i) => (
            <div key={l.id || i} style={{ borderTop: i ? `1px solid ${P.line}` : "none", padding: "14px 0" }}>
              <div className="yyc-rec-top">
                <select value={l.lever} aria-label="Lever" onChange={(e) => setLev(i, { lever: e.target.value })} className="yyc-input yyc-rec-select" style={{ width: 170 }}>
                  {leverKeys.map((k) => <option key={k} value={k}>{t.levers[k]}</option>)}
                </select>
                <input value={l.section || ""} onChange={(e) => setLev(i, { section: e.target.value })} placeholder={t.sections} aria-label="Source section" className="yyc-input yyc-rec-section" style={{ flex: 1, minWidth: 140 }} />
                <button onClick={() => delLev(i)} className="yyc-icon-btn is-danger" aria-label="Remove this lever record"><Icon name="trash" size={13} /></button>
              </div>
              {l.lever === "others" && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                  <select value={OTHER_CATS.includes(l.other_category) ? l.other_category : "uncategorized"} aria-label="Others sub-category" onChange={(e) => setLev(i, { other_category: e.target.value })} className="yyc-input" style={{ width: 210 }} title={t.otherCat}>
                    {OTHER_CATS.map((k) => <option key={k} value={k}>{t.otherCats[k]}</option>)}
                  </select>
                  <input value={l.related_to || ""} onChange={(e) => setLev(i, { related_to: e.target.value })} placeholder={t.relatedToPh} className="yyc-input" style={{ flex: 1, minWidth: 200 }} />
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8 }}>
                <label className="yyc-rec-label">Strategy: title and description</label>
                <textarea value={l.claim_en || ""} onChange={(e) => setLev(i, { claim_en: e.target.value })} rows={3} placeholder="Strategy name: description" aria-label="Strategy name and description" className="yyc-input" />
                <label className="yyc-rec-label">Actual impact</label>
                <textarea value={l.impact ?? l.quote ?? ""} onChange={(e) => setLev(i, { impact: e.target.value })} rows={2} placeholder="Actual impact (as written in the document)" aria-label="Actual impact" className="yyc-input" />
                {/* [ZH disabled for now] <textarea value={l.claim_zh || ""} onChange={(e) => setLev(i, { claim_zh: e.target.value })} rows={2} placeholder="内容 (中文)" className="yyc-input" /> */}
              </div>
            </div>
          ))}
        </div>

        {errMsg && <div style={{ color: P.redText, fontSize: 13, marginTop: 12, fontWeight: 600 }}>{errMsg}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button className="yyc-btn-primary" onClick={askSaveEdit} disabled={busy}>{busy ? "…" : t.saveChanges}</button>
          <button className="yyc-btn-secondary" onClick={askLeaveEdit}>{t.cancel}</button>
        </div>
      </div>
    );
  }

  if (mode === "review" && extraction) {
    /* conflict check: does any extracted claim overlap an existing record on the same lever? */
    const conflicts = {};
    (extraction.levers || []).forEach((lr, i) => {
      let best = null;
      levers.filter((ex) => ex.lever === lr.lever).forEach((ex) => {
        const sim = Math.max(
          claimSimilarity(lr.claim_en, ex.claim_en),
          claimSimilarity(lr.claim_zh, ex.claim_zh)
        );
        if (sim >= 0.35 && (!best || sim > best.sim)) {
          best = {
            sim,
            doc_title: ex.doc_title,
            claim: lang === "zh" ? (ex.claim_zh || ex.claim_en) : (ex.claim_en || ex.claim_zh),
          };
        }
      });
      if (best) conflicts[i] = best;
    });
    const previewMeta = {
      industry: extraction.industry,
      industry_main: extraction.industry_main,
      industry_sub: extraction.industry_sub,
    };
    const { main, sub } = parseIndustry(extraction.industry || "", previewMeta);
    // take a record out before saving (it can be brought back with Undo); nothing is saved until "Save"
    const dropRecord = (i) => { setExtraction((x) => removeLever(x, i)); setReviewEpoch((n) => n + 1); };
    const restoreRecord = () => { setExtraction((x) => undoRemoveLever(x)); setReviewEpoch((n) => n + 1); };
    // add an empty record at the bottom and scroll to it, so you can type your own
    const addRecord = () => {
      const at = (extraction.levers || []).length;
      setExtraction((x) => addLever(x));
      setTimeout(() => document.getElementById(`review-record-${at}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    };

    return (
      <div>
        <div className="yyc-section-head">
          <div>
            <h1 className="yyc-section-title">{t.reviewTitle}</h1>
            <div className="yyc-section-sub">{t.reviewNote}</div>
          </div>
        </div>

        {(extraction.notices || []).length > 0 && (
          <div role="status" style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.6, background: (extraction.notices || []).some((n) => n.level === "warn") ? P.goldSoft : P.wash, border: `1px solid ${(extraction.notices || []).some((n) => n.level === "warn") ? P.gold : P.lineDark}` }}>
            <div style={{ fontWeight: 750, marginBottom: 4 }}>{t.noticesTitle}</div>
            {(extraction.notices || []).map((n, k) => (
              <div key={k} style={{ marginTop: k ? 6 : 0 }}>{n.level === "warn" ? "⚠ " : "ℹ "}{n.text}</div>
            ))}
          </div>
        )}

        <div className="yyc-formcard" style={{ ...S.card, padding: 24 }}>
          <label style={S.label}>Document title</label>
          <input className="yyc-input" value={extraction.title || ""} onChange={(e) => setExtraction((x) => ({ ...x, title: e.target.value }))} style={{ fontSize: 18, fontWeight: 750 }} />
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 10, fontSize: 13, color: P.sub }}>
            <span><b style={{ color: P.ink }}>{t.docType}:</b> {t.docTypes[extraction.doc_type] || extraction.doc_type}</span>
            <span><b style={{ color: P.ink }}>{t.industry}:</b> {sub ? `${main} · ${sub}` : main}</span>
          </div>
          <div style={{ fontSize: 13, color: P.sub, marginTop: 6 }}>
            <b style={{ color: P.ink }}>{t.problemSig}:</b> {extraction.problem_signature}
          </div>

          <div style={{ fontWeight: 750, fontSize: 14, marginTop: 24, color: P.maroonText }}>
            {t.sections} <span style={{ color: P.faint }}>({(extraction.sections || []).length})</span>
          </div>
          {(extraction.sections || []).map((s, i) => (
            <div key={i} style={{ borderTop: i ? `1px solid ${P.line}` : "none", padding: "12px 0" }}>
              <div style={{ fontWeight: 650, fontSize: 13.5 }}>{s.heading}</div>
              <div style={{ fontSize: 13, color: P.sub, marginTop: 3, lineHeight: 1.55 }}>
                {lang === "zh" ? s.summary_zh : s.summary_en}
              </div>
            </div>
          ))}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 20 }}>
            <div style={{ fontWeight: 750, fontSize: 14, color: P.maroonText }}>
              {t.leverRecords} <span style={{ color: P.faint }}>({(extraction.levers || []).length})</span>
            </div>
            <button className="yyc-btn-secondary" onClick={addRecord} style={{ padding: "6px 12px", fontSize: 12 }}>
              <Icon name="plus" size={12} /> {t.addRecord.replace("+ ", "")}
            </button>
          </div>
          {(extraction.removed || []).length > 0 && (
            <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: P.wash, border: `1px solid ${P.lineDark}`, fontSize: 12.5, display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
              <span>{t.removedNote.replace("{n}", String(extraction.removed.length))}</span>
              <button className="yyc-btn-secondary" style={{ padding: "4px 12px", fontSize: 12 }} onClick={restoreRecord}>{t.undo}</button>
            </div>
          )}
          {(extraction.levers || []).map((l, i) => {
            return (
            <div id={`review-record-${i}`} key={i} className="yyc-rec-row" style={{ display: "flex", gap: 12, alignItems: "flex-start", borderTop: i ? `1px solid ${P.line}` : "none", padding: "12px 0", opacity: l.skip ? 0.45 : 1 }}>
              <span className="yyc-rec-pill" style={{ background: P.goldSoft, color: P.goldText, border: `1px solid rgba(184,134,11,0.4)`, fontSize: 11, fontWeight: 750, padding: "3px 11px", whiteSpace: "nowrap", borderRadius: 999 }}>
                {leverTag(t, l)}
              </span>
              <div className="yyc-rec-main" style={{ flex: 1, minWidth: 0 }}>
                {l.lever === "others" && l.related_to && (
                  <div style={{ fontSize: 12, color: P.sub, marginBottom: 3 }}>{t.relatedTo}: <b style={{ color: P.ink }}>{l.related_to}</b></div>
                )}
                <ClaimFields
                  key={`${reviewEpoch}-${i}`}
                  claim={l.claim_en}
                  labelStyle={S.label}
                  onChange={(claim) => setExtraction((x) => ({ ...x, levers: x.levers.map((v, k) => (k === i ? { ...v, claim_en: claim } : v)) }))}
                />
                <label className="yyc-edit-record-field" style={S.label}>Actual impact</label>
                <textarea className="yyc-input yyc-edit-record-textarea" rows={2} value={l.impact || ""} onChange={(e) => setExtraction((x) => ({ ...x, levers: x.levers.map((v, k) => (k === i ? { ...v, impact: e.target.value } : v)) }))} />
                <div style={{ fontSize: 12, color: P.faint, marginTop: 4 }}>{l.section}</div>
                <select
                  className="yyc-input yyc-rec-select"
                  aria-label="Lever category"
                  value={l.lever}
                  onChange={(e) => setExtraction((x) => ({ ...x, levers: x.levers.map((v, k) => (k === i ? { ...v, lever: e.target.value } : v)) }))}
                  style={{ width: 190, marginTop: 8, fontSize: 12 }}
                >
                  {leverKeys.map((key) => <option key={key} value={key}>{t.levers[key]}</option>)}
                </select>
                {l.lever === "others" && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <select
                      className="yyc-input yyc-rec-select"
                      aria-label={t.otherCat}
                      title={t.otherCat}
                      value={OTHER_CATS.includes(l.other_category) ? l.other_category : "uncategorized"}
                      onChange={(e) => setExtraction((x) => ({ ...x, levers: x.levers.map((v, k) => (k === i ? { ...v, other_category: e.target.value } : v)) }))}
                      style={{ width: 230, fontSize: 12 }}
                    >
                      {OTHER_CATS.map((k) => <option key={k} value={k}>{t.otherCats[k] || k}</option>)}
                    </select>
                    <input
                      className="yyc-input"
                      value={l.related_to || ""}
                      onChange={(e) => setExtraction((x) => ({ ...x, levers: x.levers.map((v, k) => (k === i ? { ...v, related_to: e.target.value } : v)) }))}
                      placeholder={t.relatedToPh}
                      style={{ flex: 1, minWidth: 200, fontSize: 12 }}
                    />
                  </div>
                )}
                {conflicts[i] && (
                  <div style={{ marginTop: 7, padding: "8px 11px", borderRadius: 8, background: P.goldSoft, border: `1px solid rgba(184,134,11,0.45)`, fontSize: 12.5, lineHeight: 1.55 }}>
                    <span style={{ fontWeight: 750, color: P.goldText }}>⚠ {t.similarExisting} ({Math.round(conflicts[i].sim * 100)}%):</span>{" "}
                    <b>{conflicts[i].doc_title}</b> — "{conflicts[i].claim}"
                  </div>
                )}
              </div>
              <div className="yyc-rec-actions" style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                <button className="yyc-icon-btn is-danger" onClick={() => dropRecord(i)} title={t.removeRecord} aria-label={t.removeRecord}><Icon name="trash" size={13} /></button>
                {conflicts[i] && (
                  <button
                    className="yyc-btn-secondary"
                    style={{ padding: "5px 12px", fontSize: 12, ...(l.skip ? { borderColor: P.goldDark, color: P.goldText } : {}) }}
                    onClick={() => setExtraction((x) => ({ ...x, levers: x.levers.map((v, k) => (k === i ? { ...v, skip: !v.skip } : v)) }))}
                  >
                    {l.skip ? t.skippedNote : t.skipRecord}
                  </button>
                )}
              </div>
            </div>
            );
          })}
        </div>

        {errMsg && <div style={{ color: P.redText, fontSize: 13, marginTop: 12, fontWeight: 600 }}>{errMsg}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button className="yyc-btn-primary" onClick={askSaveReview} disabled={busy}>{busy ? "…" : t.saveDoc}</button>
          <button className="yyc-btn-secondary" onClick={askLeaveReview} disabled={busy}>{t.discard}</button>
        </div>
      </div>
    );
  }

  if (mode === "bulk" && isAdmin) {
    const doneN = bulkItems.filter((x) => x.status === "done").length;
    const pendingN = bulkItems.filter((x) => x.status === "pending" || x.status === "extracting").length;
    const readyN = bulkItems.filter((x) => x.status === "ready").length;
    const readyOn = bulkItems.filter((x) => x.status === "ready" && x.include !== false).length;
    const statusLabel = { ready: "Waiting for you to start", pending: t.statusPending, extracting: t.statusExtracting, done: t.statusDone, error: t.statusError, offer: t.statusOffer };
    const fmtDone = (it) => (it.status === "done" && it.elapsed ? `${statusLabel.done} · ${fmtElapsed(it.elapsed)}` : statusLabel[it.status]);
    const statusColor = { ready: P.goldDark, pending: P.faint, extracting: P.maroon, done: P.green, error: P.red, offer: P.goldDark };
    const sum = summarizeTicked(bulkItems, bulkTicks, flagsOf);
    const allTicked = doneN > 0 && sum.docs === doneN;
    const saving = !!bulkSaving;
    return (
      <div>
        <div className="yyc-section-head">
          <div>
            <button className="yyc-btn-secondary" onClick={askLeaveBulk} disabled={saving} style={{ padding: "7px 12px", marginBottom: 10 }}>
              <Icon name="arrowLeft" size={13} /> {t.backToLibrary}
            </button>
            <h1 className="yyc-section-title">{t.bulkTitle} ({bulkItems.length})</h1>
            <div className="yyc-section-sub">{t.bulkHint}</div>
          </div>
          {bulkRunning && (
            <button className="yyc-btn-secondary" onClick={askStopQueue} style={{ borderColor: P.red, color: P.redText }}>
              {t.bulkStop}
            </button>
          )}
        </div>

        {mnaAsk && <MnaChoiceModal ask={mnaAsk} onPick={answerMna} />}
        <div style={{ ...S.card, padding: 8 }}>
          {readyN > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", borderBottom: `1px solid ${P.line}`, background: P.goldSoft, borderRadius: 8, marginBottom: 4 }}>
              <div style={{ flex: 1, minWidth: 240, fontSize: 13, lineHeight: 1.5 }}>
                <b>Choose what to extract.</b> Untick any file you do not want, and tick <i>M&amp;A document</i> where it applies. Nothing is sent to the AI until you press Start extraction.
              </div>
              <button className="yyc-btn-primary" style={{ padding: "8px 16px", fontSize: 13 }} disabled={!readyOn} onClick={startBulk}>
                Start extraction ({readyOn})
              </button>
            </div>
          )}
          {doneN > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", borderBottom: `1px solid ${P.line}`, background: P.wash, borderRadius: 8, marginBottom: 4 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 650, cursor: saving ? "default" : "pointer" }}>
                <input type="checkbox" checked={allTicked} disabled={saving} ref={(el) => { if (el) el.indeterminate = sum.docs > 0 && !allTicked; }} onChange={(e) => setAllTicks(e.target.checked)} />
                Select all ready ({doneN})
              </label>
              <span style={{ fontSize: 12.5, color: P.sub }}>{sum.docs} selected{sum.docs ? ` · ${plural(sum.records, "lever record")}` : ""}</span>
              <button className="yyc-btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={saving} onClick={() => setBulkTicks({})} title="Tick only the items with no warning and nothing similar already in the library">Select only the safe ones</button>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="yyc-btn-primary" style={{ padding: "7px 14px", fontSize: 12.5 }} disabled={!sum.docs || saving} onClick={askSaveSelected}>
                  {saving ? `Saving ${bulkSaving.done} of ${bulkSaving.total}…` : `Save selected (${sum.docs})`}
                </button>
                <button className="yyc-btn-secondary" style={{ padding: "7px 14px", fontSize: 12.5, borderColor: P.red, color: P.redText }} disabled={!sum.docs || saving} onClick={askDiscardSelected}>
                  <Icon name="trash" size={13} /> Discard selected ({sum.docs})
                </button>
              </div>
            </div>
          )}
          {bulkItems.map((it) => (
            <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: `1px solid ${P.line}` }}>
              {it.status === "ready" && (
                <input type="checkbox" aria-label={`Extract ${it.title}`} checked={it.include !== false} onChange={(e) => setBulkInclude(it.id, e.target.checked)} style={{ flexShrink: 0 }} />
              )}
              {it.status === "done" && (
                <input type="checkbox" aria-label={`Select ${it.title}`} checked={isTicked(it, bulkTicks, flagsOf(it))} disabled={saving} onChange={(e) => setTick(it.id, e.target.checked)} style={{ flexShrink: 0 }} />
              )}
              {it.status === "extracting" ? (
                <span className="yyc-spin" style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${P.line}`, borderTopColor: P.maroon, display: "inline-block", flexShrink: 0 }} />
              ) : (
                <span style={{ color: statusColor[it.status], fontSize: 15, flexShrink: 0, width: 14, textAlign: "center" }}>
                  {it.status === "done" ? "✓" : it.status === "error" ? "✗" : it.status === "offer" ? "?" : "○"}
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</div>
                <div style={{ fontSize: 11.5, color: statusColor[it.status], fontWeight: 600 }}>
                  {fmtDone(it)}
                  {it.status === "done" && it.extraction ? ` · ${(it.extraction.levers || []).length} ${t.leverRecords.toLowerCase()}` : ""}
                  {it.parent ? ` · ${t.splitFrom} “${it.parent}”` : ""}
                </div>
                {it.status === "done" && (flagsOf(it).warnings.length > 0 || flagsOf(it).similar > 0 || flagsOf(it).records === 0) && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                    {flagsOf(it).records === 0 && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: P.redSoft, color: P.redText }}>no records to save</span>}
                    {flagsOf(it).warnings.length > 0 && <span title={flagsOf(it).warnings.join("\n")} style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: P.goldSoft, color: P.goldText }}>⚠ needs a look: {flagsOf(it).warnings.length === 1 ? "1 warning" : `${flagsOf(it).warnings.length} warnings`}</span>}
                    {flagsOf(it).similar > 0 && <span title="These records look like records already in the library (same lever, similar wording). Open Review & save to compare them." style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: P.goldSoft, color: P.goldText }}>⚠ {plural(flagsOf(it).similar, "record")} similar to the library</span>}
                  </div>
                )}
                {it.status === "ready" && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, fontSize: 12, color: P.sub, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!it.mna} onChange={(e) => setBulkMna(it.id, e.target.checked)} />
                    <span><b style={{ color: P.ink }}>M&amp;A document</b> · {it.mna === it.detectedMna ? (it.detectedMna ? "detected from its M&A section headings" : "no M&A headings found, so it is read as a normal case study") : "changed by you (the app checks it against the headings before extracting)"}</span>
                  </label>
                )}
                {it.status === "ready" && it.storyCount > 0 && <div style={{ fontSize: 12, color: P.goldText, marginTop: 3, fontWeight: 600 }}>Looks like {it.storyCount} separate stories: you will be asked whether to split it into cards.</div>}
                {it.status === "error" && it.error && <div style={{ fontSize: 11.5, color: P.redText, marginTop: 3, lineHeight: 1.4 }}>{it.error}</div>}
                {it.status === "offer" && it.offer && (
                  <div style={{ fontSize: 12, color: P.ink, marginTop: 4, lineHeight: 1.5 }}>
                    <b>{t.splitTitle.replace("{n}", String(it.offer.cards.length))}.</b> {t.splitBody.replace(/\{n\}/g, String(it.offer.cards.length))}
                  </div>
                )}
              </div>
              {it.status === "offer" && it.offer && (
                <>
                  <button className="yyc-btn-primary" style={{ padding: "6px 14px", fontSize: 12.5 }} disabled={splitBusyId === it.id} onClick={() => acceptBulkSplit(it.id)}>
                    {splitBusyId === it.id ? t.splitWorking : t.splitDo.replace("{n}", String(it.offer.cards.length))}
                  </button>
                  <button className="yyc-btn-secondary" style={{ padding: "6px 14px", fontSize: 12.5 }} disabled={bulkRunning || splitBusyId === it.id} title={bulkRunning ? "Wait for the queue to finish" : ""} onClick={() => keepBulkWhole(it.id)}>
                    {t.splitKeep}
                  </button>
                </>
              )}
              {it.status === "done" && (
                <button className="yyc-btn-primary" style={{ padding: "6px 14px", fontSize: 12.5 }} disabled={saving} onClick={() => reviewBulkItem(it.id)}>
                  {t.bulkReviewBtn}
                </button>
              )}
              {it.status === "error" && !bulkRunning && (
                <button className="yyc-btn-secondary" style={{ padding: "6px 14px", fontSize: 12.5 }} onClick={() => retryBulkItem(it.id)}>
                  {t.bulkRetry}
                </button>
              )}
              {(it.status === "ready" || it.status === "done" || it.status === "error" || (it.status === "offer" && splitBusyId !== it.id) || (it.status === "pending" && !bulkRunning)) && (
                <button className="yyc-btn-secondary" style={{ padding: "6px 12px", fontSize: 12.5, borderColor: P.red, color: P.redText }} disabled={saving} onClick={() => askDiscardItem(it)} title={t.bulkDiscardHint} aria-label={`${t.bulkDiscard}: ${it.title}`}>
                  <Icon name="trash" size={13} /> {t.bulkDiscard}
                </button>
              )}
            </div>
          ))}
          {bulkWait > 0 && (
            <div style={{ padding: "10px 14px", fontSize: 12.5, color: P.sub, fontWeight: 600 }}>
              ⏳ {t.bulkWaiting} {bulkWait}s
            </div>
          )}
          {aiNote && <div style={{ padding: "10px 14px", fontSize: 12.5, color: P.sub, fontWeight: 600 }}>⏳ {t.rateWaiting} {aiNote.sec}s</div>}
          {errMsg && <div style={{ padding: "10px 14px", fontSize: 13, color: P.redText, fontWeight: 600, lineHeight: 1.5 }}>{errMsg}</div>}
          {!bulkRunning && pendingN === 0 && doneN > 0 && (
            <div style={{ padding: "12px 14px", fontSize: 13, color: P.greenText, fontWeight: 700 }}>
              {t.bulkDoneAll}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === "add" && isAdmin) {
    return (
      <div>
        <div className="yyc-section-head">
          <div>
            <button className="yyc-btn-secondary" onClick={askCancelAdd} style={{ padding: "7px 12px", marginBottom: 10 }}>
              <Icon name="arrowLeft" size={13} /> {t.cancel}
            </button>
            <h1 className="yyc-section-title">{t.upload}</h1>
            <div className="yyc-section-sub">Paste text or upload a .docx. The AI will categorize the material and extract the 10 levers.</div>
          </div>
        </div>

        <div className="yyc-formcard" style={{ ...S.card, padding: 24 }}>
          <label style={S.label}>{t.titlePh}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.titlePh} className="yyc-input" />
          {mnaAsk && <MnaChoiceModal ask={mnaAsk} onPick={answerMna} />}
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, fontSize: 12.5, color: P.sub, lineHeight: 1.5, cursor: busy ? "default" : "pointer" }}>
            <input type="checkbox" checked={mnaChoice ?? detectedMna} disabled={busy} onChange={(e) => setMnaChoice(e.target.checked)} style={{ marginTop: 3 }} />
            <span><b style={{ color: P.ink }}>This is an M&amp;A document</b> {!text.trim() ? "Ticked automatically when the text has M&A section headings." : mnaChoice !== null ? "You set this by hand; the app checks it against the headings before extracting." : detectedMna ? "Detected from its M&A section headings; untick to read it as a normal case study." : "No M&A headings found, so it is read as a normal case study; tick it if this is an M&A strategy summary."}</span>
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
            <button onClick={() => fileRef.current?.click()} className="yyc-btn-secondary" style={{ background: P.wash, color: P.ink }}>
              <Icon name="upload" size={14} /> {t.uploadDocx}
            </button>
            <input ref={fileRef} type="file" accept=".docx" multiple onChange={onFile} style={{ display: "none" }} />
            <span style={{ color: P.faint, fontSize: 13 }}>{t.orPaste}</span>
            {html && (
              <span style={{ color: P.greenText, fontSize: 12, fontWeight: 700, background: P.greenSoft, padding: "4px 11px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Icon name="check" size={12} /> {t.docView}
              </span>
            )}
          </div>

          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t.textPh} rows={12} className="yyc-input" style={{ marginTop: 14, resize: "none", fontSize: 13, lineHeight: 1.6 }} />

          {aiBanner}
          {errMsg && <div style={{ color: P.redText, fontSize: 13, marginTop: 10, fontWeight: 600 }}>{errMsg}</div>}

          {splitOffer && splitOffer.forText === text && (
            <div role="status" style={{ marginTop: 14, padding: "14px 16px", borderRadius: 10, background: P.goldSoft, border: `1px solid ${P.gold}`, fontSize: 13, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 750, marginBottom: 4 }}>{t.splitTitle.replace("{n}", String(splitOffer.cards.length))}</div>
              <div>{t.splitBody.replace(/\{n\}/g, String(splitOffer.cards.length))}</div>
              <div style={{ marginTop: 6, color: P.sub, fontSize: 12.5 }}>{splitOffer.cards.slice(0, 6).map((c) => c.title).join(" · ")}{splitOffer.cards.length > 6 ? ` · … +${splitOffer.cards.length - 6}` : ""}</div>
              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
                <button className="yyc-btn-primary" onClick={acceptSplit} disabled={busy}>
                  {busy ? t.splitWorking : t.splitDo.replace("{n}", String(splitOffer.cards.length))}
                </button>
                <button className="yyc-btn-secondary" onClick={keepWhole} disabled={busy}>{t.splitKeep}</button>
              </div>
            </div>
          )}

          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 14, fontSize: 12.5, color: P.sub, lineHeight: 1.5, cursor: busy ? "default" : "pointer" }}>
            <input type="checkbox" checked={fastMode} disabled={busy || bulkRunning}
              onChange={(e) => { const on = e.target.checked; setFastMode(on); try { localStorage.setItem("yyc:fast", on ? "1" : "0"); } catch { /* private mode */ } }}
              style={{ marginTop: 3 }} />
            <span><b style={{ color: P.ink }}>Fast extraction</b>: use all the AI keys at once (several parts of a document in parallel, no pause between uploaded files). Untick to go back to the original one-part-at-a-time way. The time taken is shown after each extraction, so you can compare.</span>
          </label>

          <div style={{ display: "flex", gap: 12, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
            <button className="yyc-btn-primary" onClick={runExtract} disabled={busy || !text.trim()}>
              {busy ? (
                <>
                  <span className="yyc-spin" style={{ width: 13, height: 13, borderRadius: "50%", border: "2px solid rgba(255,255,255,.35)", borderTopColor: "#fff", display: "inline-block" }} />
                  {t.extract}
                </>
              ) : (<><Icon name="spark" size={14} /> {t.extract}</>)}
            </button>
            {busy && (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5, fontWeight: 600 }}>
                {[["reading", t.stageReading], ["analyze", t.stageAnalyze], ["levers", t.stageLevers]].map(([k, label]) => {
                  const order = ["reading", "analyze", "levers"];
                  const cur = order.indexOf(stage);
                  const me = order.indexOf(k);
                  const done = me < cur;
                  const activeNow = me === cur;
                  return (
                    <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: done ? P.greenText : activeNow ? P.maroonText : P.faint }}>
                      {done ? <Icon name="check" size={12} /> : activeNow ? (
                        <span className="yyc-spin" style={{ width: 11, height: 11, borderRadius: "50%", border: `2px solid ${P.line}`, borderTopColor: P.maroon, display: "inline-block" }} />
                      ) : "○"}
                      {label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const totalRecords = levers.length;
  const maxPerLever = Math.max(1, ...leverKeys.map((l) => levers.filter((r) => r.lever === l).length));
  const leverCounts = leverKeys.reduce((acc, l) => {
    acc[l] = levers.filter((x) => x.lever === l).length;
    return acc;
  }, {});

  return (
    <div>
      <div className="yyc-section-head">
        <div>
          <h1 className="yyc-section-title">{t.tabs.kb}</h1>
          <div className="yyc-section-sub">
            {isAdmin
              ? t.kbAdmin
              : t.kbUser}
          </div>
        </div>
        {isAdmin && (
          <div className="yyc-head-actions">
            <button className="yyc-btn-secondary yyc-iconify" onClick={() => importRef.current?.click()} title={t.importKB}>
              <Icon name="upload" size={15} /> <span className="yyc-btn-label">{t.importKB}</span>
            </button>
            <input ref={importRef} type="file" accept=".json,application/json" onChange={importBackup} style={{ display: "none" }} />
            <button className="yyc-btn-secondary yyc-iconify" onClick={exportBackup} title={t.exportKB}>
              <Icon name="download" size={15} /> <span className="yyc-btn-label">{t.exportKB}</span>
            </button>
            <button className="yyc-btn-secondary yyc-iconify" onClick={openTrash} title="Recently deleted">
              <Icon name="undo" size={15} /> <span className="yyc-btn-label">Recently deleted</span>
            </button>
            <button className="yyc-btn-primary yyc-iconify" onClick={() => setMode("add")} title={t.upload}>
              <Icon name="plus" size={16} /> <span className="yyc-btn-label">{t.upload}</span>
            </button>
          </div>
        )}
      </div>

      {isAdmin && draftOffer && (
        <div role="region" aria-label="Unsaved draft" className="yyc-draft-banner">
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0, flex: "1 1 260px" }}>
            <span className="yyc-draft-ico" aria-hidden="true"><Icon name="file" size={16} /></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 750, fontSize: 14, overflowWrap: "anywhere" }}>{describeDraft(draftOffer.draft)}</div>
              <div style={{ fontSize: 12.5, color: P.sub, marginTop: 2, lineHeight: 1.5 }}>Saved in this browser {ageLabel(draftOffer.at)}. It was not saved to the library.</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="yyc-btn-primary" onClick={restoreDraft}>Restore</button>
            <button className="yyc-btn-secondary" onClick={askDiscardDraft}>Discard</button>
          </div>
        </div>
      )}

      <div className="yyc-stats">
        <div className="yyc-stat">
          <div className="yyc-stat-inner">
            <div className="yyc-stat-icon is-red"><Icon name="book" size={18} /></div>
            <div style={{ flex: 1 }}>
              <div className="yyc-stat-label">{t.materials}</div>
              <div className="yyc-stat-num">{index.length}</div>
            </div>
          </div>
        </div>
        <div
          className="yyc-stat is-gold is-clickable"
          role="button"
          tabIndex={0}
          title={t.pickLeverTitle}
          onClick={() => setStatPicker(true)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setStatPicker(true)}
          style={{ outline: leverFilter !== "all" ? `2px solid ${P.gold}` : undefined }}
        >
          <div className="yyc-stat-inner">
            <div className="yyc-stat-icon is-gold"><Icon name="scale" size={18} /></div>
            <div className="yyc-stat-col">
              <div className="yyc-stat-label">{t.leverRecords}</div>
              <div className="yyc-stat-num">
                {leverFilter !== "all" ? `${leverCounts[leverFilter] || 0}/${totalRecords}` : totalRecords}
              </div>
            </div>
            <span className="yyc-stat-hint" style={{ fontSize: 11, color: P.faint, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3, maxWidth: "50%", minWidth: 0, textAlign: "right" }}>
              <span className="yyc-stat-hint-text" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {leverFilter !== "all" ? (t.levers[leverFilter] || leverFilter) : t.pickerHint}
              </span>
              <Icon name="arrowRight" size={10} color={P.faint} stroke={2.5} />
            </span>
          </div>
        </div>
        <div className="yyc-stat is-green">
          <div className="yyc-stat-inner">
            <div className="yyc-stat-icon is-green"><Icon name="grid" size={18} /></div>
            <div style={{ flex: 1 }}>
              <div className="yyc-stat-label">{t.coverage}</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 26, marginTop: 6 }}>
                {leverKeys.map((l) => {
                  const n = leverCounts[l];
                  const isActive = leverFilter === l;
                  return (
                    <div
                      key={l}
                      title={`${t.levers[l]}: ${n} — click to filter`}
                      onClick={() => setLeverFilter(isActive ? "all" : l)}
                      style={{
                        width: 6, cursor: "pointer",
                        height: `${Math.max(6, (n / maxPerLever) * 100)}%`,
                        background: isActive ? P.crimson : (n ? P.green : P.line),
                        borderRadius: 2, transition: "all .2s",
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="yyc-toolbar">
        <div className="yyc-filter-row">
          <div className="yyc-search">
            <span className="yyc-search-icon"><Icon name="search" size={15} /></span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.searchPh} className="yyc-input" />
          </div>

          <select className="yyc-filter-select" aria-label="Industry" value={mainCat} onChange={(e) => { setMainCat(e.target.value); setSubCat("all"); }}>
            <option value="all">{t.allMainCat}</option>
            {mainCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <select className="yyc-filter-select" aria-label="Sub-industry" style={{ gap: 100 }} value={subCat} onChange={(e) => setSubCat(e.target.value)} disabled={subCategories.length === 0}>
            <option value="all">{t.allSubCat}</option>
            {subCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <select className="yyc-filter-select" aria-label="Sort by" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
            <option value="az">A to Z</option>
            <option value="levers">Most strategies</option>
          </select>
        </div>

        <div className="yyc-chip-row">
          <span className="yyc-chip-row-label">{t.filterByLever}</span>
          <button
            className={`yyc-lever-chip ${leverFilter === "all" ? "is-active" : ""}`}
            onClick={() => setLeverFilter("all")}
          >
            {t.allLevers}
          </button>
          {leverKeys.map((l) => {
            const n = leverCounts[l];
            const isActive = leverFilter === l;
            return (
              <button
                key={l}
                className={`yyc-lever-chip ${isActive ? "is-active" : ""}`}
                onClick={() => setLeverFilter(isActive ? "all" : l)}
                disabled={n === 0}
              >
                {t.levers[l]}
                <span className="yyc-lever-chip-count">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {index.length > 0 && (
        <div className="yyc-results-bar">
          <span className="yyc-results-count" role="status" aria-live="polite">{resultsText}</span>
          {activeTags.map((tg) => (
            <button key={tg.key} type="button" className="yyc-filter-tag" onClick={tg.remove} aria-label={`Remove filter: ${tg.label}`}>
              {tg.label}<Icon name="close" size={11} />
            </button>
          ))}
          {anyFilterActive && <button type="button" className="yyc-linkbtn-soft" onClick={clearAllFilters}>Clear all</button>}
        </div>
      )}

      {index.length === 0 ? (
        <div className="yyc-empty">
          <div className="yyc-empty-icon"><Icon name="book" size={22} /></div>
          {isAdmin ? t.kbEmpty : t.kbEmptyViewer}
        </div>
      ) : leverFilter !== "all" ? (
        Object.keys(groupedLevers).length === 0 ? (
          <div className="yyc-empty">
            <div className="yyc-empty-icon"><Icon name="filter" size={22} /></div>
            {t.noLeverRecords}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12.5, color: P.sub, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="file" size={13} /> {t.jumpToSection}
            </div>
            {groupedEntries.map(([docId, records]) => {
              const meta = index.find((d) => d.id === docId);
              const { main, sub } = meta ? docMeta(meta) : { main: "General", sub: "" };
              return (
                <div key={docId} className="yyc-lever-group">
                  <div className="yyc-lever-group-head">
                    <Icon name="book" size={14} color={P.maroonText} />
                    <span className="yyc-lever-group-title">{meta?.title || records[0]?.doc_title || "(unknown)"}</span>
                    <span className="yyc-lever-group-count">({records.length})</span>
                    <span style={{ marginLeft: "auto", fontSize: 11.5, color: P.faint, fontWeight: 600 }}>
                      {sub ? `${main} · ${sub}` : main}
                    </span>
                  </div>
                  <div className="yyc-lever-records-stack">
                    {records.map((r, i) => (
                      <LeverRecordCard
                        key={r.id || i}
                        record={r}
                        meta={meta}
                        t={t}
                        lang={lang}
                        onOpenPicker={setPickerRecord}
                        isAdmin={isAdmin}
                        onEdit={setEditLeverRecord}
                        onDelete={deleteLeverRecord}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : filteredIndex.length === 0 ? (
        <div className="yyc-empty">
          <div className="yyc-empty-icon"><Icon name="search" size={22} /></div>
          {t.noResults}
        </div>
      ) : (
        <div className="yyc-grid">
          {sortedIndex.map((d, i) => {
            const { main, sub } = docMeta(d);
            return <DocCard key={d.id} d={d} i={i} t={t} lang={lang} isAdmin={isAdmin} lc={leverCount(d.id)} main={main} sub={sub} on={cardHandlers} />;
          })}
        </div>
      )}

      {isAdmin && !window.storage?.remote && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 36, flexWrap: "wrap", paddingTop: 20, borderTop: `1px solid ${P.line}` }}>
          <span style={{ fontSize: 13, color: P.sub, fontWeight: 600 }}>{t.changePass}:</span>
          <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder={t.newPassPh} className="yyc-input" style={{ width: 200 }} />
          <button className="yyc-btn-secondary" onClick={savePass} style={{ padding: "8px 16px" }}>OK</button>
        </div>
      )}

      {importPlan && isAdmin && <ImportPreviewModal t={t} plan={importPlan} busy={busy} onCancel={() => setImportPlan(null)} onConfirm={confirmImport} />}

      {editLeverRecord && (
        <div className="yyc-modal-backdrop" onClick={() => !busy && setEditLeverRecord(null)}>
          <div className="yyc-modal yyc-edit-record-modal" style={{ width: 700, maxWidth: "100%", padding: 26 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 2, paddingBottom: 16, borderBottom: `1px solid ${P.line}` }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: P.crimsonText, letterSpacing: ".08em", textTransform: "uppercase" }}>{t.levers[editLeverRecord.lever] || editLeverRecord.lever}</div>
                <h2 style={{ margin: "4px 0 0", fontSize: 21, letterSpacing: "-.02em", color: P.title, fontWeight: "bolder"}}>{t.editTitle}</h2>
              </div>
              <button className="yyc-icon-btn" onClick={() => setEditLeverRecord(null)} disabled={busy} title={t.cancel} aria-label={t.cancel}><Icon name="close" size={13} /></button>
            </div>
            <label style={S.label}>Lever</label>
            <select className="yyc-input" aria-label="Lever" value={editLeverRecord.lever || "price"} onChange={(e) => setEditLeverRecord((r) => ({ ...r, lever: e.target.value }))}>
              {leverKeys.map((lever) => <option key={lever} value={lever}>{t.levers[lever]}</option>)}
            </select>
            {editLeverRecord.lever === "others" && (<>
              <label className="yyc-edit-record-field" style={S.label}>{t.otherCat}</label>
              <select className="yyc-input" aria-label="Others sub-category" value={OTHER_CATS.includes(editLeverRecord.other_category) ? editLeverRecord.other_category : "uncategorized"} onChange={(e) => setEditLeverRecord((r) => ({ ...r, other_category: e.target.value }))}>
                {OTHER_CATS.map((k) => <option key={k} value={k}>{t.otherCats[k] || k}</option>)}
              </select>
              <label className="yyc-edit-record-field" style={S.label}>{t.relatedTo}</label>
              <input className="yyc-input" value={editLeverRecord.related_to || ""} onChange={(e) => setEditLeverRecord((r) => ({ ...r, related_to: e.target.value }))} placeholder={t.relatedToPh} />
            </>)}
            <label className="yyc-edit-record-field" style={S.label}>Strategy / claim (English)</label>
            <textarea className="yyc-input yyc-edit-record-textarea" rows={4} value={editLeverRecord.claim_en || ""} onChange={(e) => setEditLeverRecord((r) => ({ ...r, claim_en: e.target.value }))} />
            {/* Chinese claim editing is intentionally hidden in the frontend for now.
            <label style={{ ...S.label, marginTop: 14 }}>策略 / 内容（中文）</label>
            <textarea className="yyc-input" rows={3} value={editLeverRecord.claim_zh || ""} onChange={(e) => setEditLeverRecord((r) => ({ ...r, claim_zh: e.target.value }))} />
            */}
            <label className="yyc-edit-record-field" style={S.label}>Impact</label>
            <textarea className="yyc-input yyc-edit-record-textarea" rows={3} value={editLeverRecord.impact || ""} onChange={(e) => setEditLeverRecord((r) => ({ ...r, impact: e.target.value }))} />
            <label className="yyc-edit-record-field" style={S.label}>Source section</label>
            <input className="yyc-input" value={editLeverRecord.section || ""} onChange={(e) => setEditLeverRecord((r) => ({ ...r, section: e.target.value }))} />
            {errMsg && <div style={{ color: P.redText, fontSize: 12.5, marginTop: 12 }}>{errMsg}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${P.line}` }}>
              <button className="yyc-btn-secondary" onClick={() => setEditLeverRecord(null)} disabled={busy}>{t.cancel}</button>
              <button className="yyc-btn-primary" onClick={saveLeverRecord} disabled={busy}>{busy ? "Saving…" : t.saveChanges}</button>
            </div>
          </div>
        </div>
      )}

      {statPicker && (
        <LeverPickerModal
          t={t}
          currentLever={leverFilter}
          counts={leverCounts}
          onSelect={(l) => setLeverFilter(leverFilter === l ? "all" : l)}
          onClear={() => setLeverFilter("all")}
          onClose={() => setStatPicker(false)}
        />
      )}

      {pickerRecord && (
        <LeverPickerModal
          t={t}
          currentLever={leverFilter}
          counts={leverCounts}
          onSelect={(l) => setLeverFilter(l)}
          onClose={() => setPickerRecord(null)}
          onOpenSource={() => {
            openPreview(pickerRecord.doc_id, pickerRecord.section);
            setPickerRecord(null);
          }}
        />
      )}
    </div>
  );
}