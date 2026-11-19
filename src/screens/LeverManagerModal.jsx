// The "manage lever categories" window.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { useEffect, useState } from "react";
import { P, S } from "../theme.js";
import { T } from "../i18n.js";
import { BUILTIN_LEVER_DEFAULTS, OTHER_CATS, OTHER_CAT_DEFAULT_DEFS, splitHeadings } from "../lib/levers.js";
import { uid } from "../lib/util.js";
import { askAI, describeAIError } from "../lib/ai.js";
import { Icon } from "../ui/Icon.jsx";

/* Layout helpers for LeverManagerModal. Module level on purpose: components defined inside another component are rebuilt on every
   keystroke, which would drop the focus from the text boxes. */
const MgrField = ({ label, children, hint }) => (
  <div style={{ marginTop: 12 }}>
    <label style={{ ...S.label, display: "block", marginBottom: 5 }}>{label}</label>
    {children}
    {hint && <div style={{ fontSize: 12, lineHeight: 1.5, color: P.sub, marginTop: 5 }}>{hint}</div>}
  </div>
);
const MgrFooter = ({ children }) => <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>{children}</div>;
const MgrSection = ({ title, children }) => (
  <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${P.line}` }}>
    <div style={{ fontSize: 14, fontWeight: 750 }}>{title}</div>
    {children}
  </div>
);

/* Admin tool opened from the Lever Explorer. Two tabs: "Edit existing" (built-in levers, Others + its sub-categories, custom levers)
   and "Create new" (a custom lever or an Others sub-category). Nothing here touches records already saved, except deleting a custom
   sub-category, which moves its records to "Uncategorized". */
export function LeverManagerModal({ t, config, setConfig, setConfirm, setAdminLocked, flash, refreshKB, onClose }) {
  const [tab, setTab] = useState("edit");
  const [createKind, setCreateKind] = useState("lever");
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [target, setTarget] = useState("price"); // lever being edited: a built-in id, "others", or a custom lever id
  const draftFor = (id) => {
    const o = (config?.leverOverrides || {})[id] || {};
    return { name: o.name || T.en.levers[id] || id, description: o.description || BUILTIN_LEVER_DEFAULTS[id] || "", headings: o.headings || "" };
  };
  const [builtinDraft, setBuiltinDraft] = useState(() => draftFor("price"));
  const [customDraft, setCustomDraft] = useState(null); // an existing custom lever being edited
  const [newLever, setNewLever] = useState({ name: "", description: "", example: "", headings: "" });
  const subDraftFor = (id) => {
    const c = (config?.customOtherCats || []).find((x) => x.id === id);
    if (c) return { name: c.name, description: c.description };
    const o = (config?.otherCatOverrides || {})[id] || {};
    return { name: o.name || T.en.otherCats[id] || id, description: o.description || OTHER_CAT_DEFAULT_DEFS[id] || "" };
  };
  const [subId, setSubId] = useState(OTHER_CATS[0]);
  const [subDraft, setSubDraft] = useState(() => subDraftFor(OTHER_CATS[0]));
  const [newSub, setNewSub] = useState({ name: "", description: "" });
  useEffect(() => { if (!setAdminLocked) return; setAdminLocked(true); return () => setAdminLocked(false); }, [setAdminLocked]); // admin cannot be locked out while this is open

  const saveCfg = async (cfg) => { await window.db.saveConfig(cfg); setConfig(cfg); };
  const customLevers = config?.customLevers || [];
  const customSubs = config?.customOtherCats || [];
  const isBuiltin = !!BUILTIN_LEVER_DEFAULTS[target];
  const isOthers = target === "others";
  const customTarget = customLevers.find((c) => c.id === target);
  const nameTaken = (name, exceptId) => {
    const n = name.trim().toLowerCase();
    return [...Object.keys(T.en.levers).map((k) => [k, ((config?.leverOverrides || {})[k] || {}).name || T.en.levers[k]]), ...customLevers.map((c) => [c.id, c.name])]
      .some(([k, v]) => k !== exceptId && String(v || "").trim().toLowerCase() === n);
  };
  const pick = (id) => {
    setErrMsg(""); setTarget(id);
    const c = customLevers.find((x) => x.id === id);
    if (c) setCustomDraft({ ...c });
    else setBuiltinDraft(draftFor(id));
  };

  // ── built-in levers + Others (name only) ──
  const saveBuiltin = async () => {
    const d = builtinDraft;
    const name = d.name.trim(), description = (d.description || "").trim(), headings = splitHeadings(d.headings).join(", ");
    if (!name || (isBuiltin && !description)) { setErrMsg("Enter a name" + (isBuiltin ? " and a definition." : ".")); return; }
    if (nameTaken(name, target)) { setErrMsg("Another lever already uses this name."); return; }
    const o = isBuiltin
      ? { name: name === T.en.levers[target] ? "" : name, description: description === BUILTIN_LEVER_DEFAULTS[target] ? "" : description, headings }
      : { name: name === T.en.levers[target] ? "" : name };
    const leverOverrides = { ...(config?.leverOverrides || {}) };
    if (Object.values(o).every((v) => !v)) delete leverOverrides[target]; else leverOverrides[target] = o;
    await saveCfg({ ...config, leverOverrides }); setErrMsg(""); flash("Lever saved");
  };
  const resetBuiltin = async () => {
    const leverOverrides = { ...(config?.leverOverrides || {}) };
    delete leverOverrides[target];
    await saveCfg({ ...config, leverOverrides });
    setBuiltinDraft({ name: T.en.levers[target] || target, description: BUILTIN_LEVER_DEFAULTS[target] || "", headings: "" });
    setErrMsg(""); flash("Reset to the original lever");
  };

  // ── Others sub-categories ──
  const pickSub = (id) => { setErrMsg(""); setSubId(id); setSubDraft(subDraftFor(id)); };
  const subNameTaken = (name, exceptId) => OTHER_CATS.some((k) => k !== exceptId && String(t.otherCats[k] || "").trim().toLowerCase() === name.trim().toLowerCase());
  const saveSub = async () => {
    const name = subDraft.name.trim(), description = subDraft.description.trim();
    if (!name || !description) { setErrMsg("Enter a name and a definition for the sub-category."); return; }
    if (subNameTaken(name, subId)) { setErrMsg("Another sub-category already uses this name."); return; }
    if (customSubs.some((c) => c.id === subId)) {
      await saveCfg({ ...config, customOtherCats: customSubs.map((c) => (c.id === subId ? { ...c, name, description } : c)) });
    } else {
      const otherCatOverrides = { ...(config?.otherCatOverrides || {}) };
      const o = { name: name === T.en.otherCats[subId] ? "" : name, description: description === OTHER_CAT_DEFAULT_DEFS[subId] ? "" : description };
      if (!o.name && !o.description) delete otherCatOverrides[subId]; else otherCatOverrides[subId] = o;
      await saveCfg({ ...config, otherCatOverrides });
    }
    setErrMsg(""); flash("Sub-category saved");
  };
  const resetSub = async () => {
    const otherCatOverrides = { ...(config?.otherCatOverrides || {}) };
    delete otherCatOverrides[subId];
    await saveCfg({ ...config, otherCatOverrides });
    setSubDraft({ name: T.en.otherCats[subId] || subId, description: OTHER_CAT_DEFAULT_DEFS[subId] || "" });
    setErrMsg(""); flash("Reset to the original sub-category");
  };
  const deleteSub = () => {
    const c = customSubs.find((x) => x.id === subId); if (!c) return;
    setConfirm({
      message: `Delete the sub-category "${c.name}"? Records filed under it move to "${T.en.otherCats.uncategorized}".`,
      onConfirm: async () => {
        try {
          await window.db.recategorize(c.id, "uncategorized");
          await saveCfg({ ...config, customOtherCats: customSubs.filter((x) => x.id !== c.id) });
          if (refreshKB) await refreshKB();
          pickSub(OTHER_CATS.find((k) => k !== c.id) || OTHER_CATS[0]);
          flash("Sub-category deleted");
        } catch { setErrMsg(t.loadErr); }
      },
    });
  };
  const createSub = async () => {
    const name = newSub.name.trim(), description = newSub.description.trim();
    if (!name || !description) { setErrMsg("Enter a name and a definition for the sub-category."); return; }
    if (subNameTaken(name, "")) { setErrMsg("Another sub-category already uses this name."); return; }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "custom";
    await saveCfg({ ...config, customOtherCats: [...customSubs, { id: `oc_${slug}_${uid()}`, name, description }] });
    setNewSub({ name: "", description: "" }); setErrMsg(""); flash("Sub-category created");
  };

  // ── custom levers (create + edit), checked by the AI first ──
  const persistCustomLever = async (draft) => {
    const normalizedName = draft.name.trim().toLowerCase();
    if (nameTaken(draft.name, draft.id)) { setErrMsg("A lever with this name already exists."); return; }
    const slug = normalizedName.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "custom";
    const item = { ...draft, id: draft.id || `custom_${slug}_${uid()}`, name: draft.name.trim(), description: draft.description.trim(), example: draft.example.trim(), headings: splitHeadings(draft.headings).join(", ") };
    const next = draft.id ? customLevers.map((e) => (e.id === draft.id ? item : e)) : [...customLevers, item];
    await saveCfg({ ...config, customLevers: next });
    if (draft.id) setCustomDraft(item); else setNewLever({ name: "", description: "", example: "", headings: "" });
    setErrMsg(""); flash("Lever category saved");
  };
  const validateAndSaveLever = async (raw) => {
    const draft = { ...raw, name: raw.name.trim(), description: raw.description.trim(), example: raw.example.trim() };
    if (!draft.name || !draft.description || !draft.example) { setErrMsg("Enter a name, definition, and example before validating."); return; }
    setBusy(true); setErrMsg("");
    try {
      const existingCategories = Object.fromEntries(Object.entries(t.levers).filter(([key]) => key !== draft.id));
      const result = await askAI(`Review this proposed knowledge-base lever category. Judge whether its name, definition, and example are coherent and useful for classifying business strategies, and whether its scope is distinct enough from the existing categories. Return JSON only: {"valid": true|false, "reason": "short explanation"}. Existing categories: ${JSON.stringify(existingCategories)}. Proposed category: ${JSON.stringify({ name: draft.name, description: draft.description, example: draft.example })}`, 350);
      if (result.valid === true) {
        await persistCustomLever(draft);
      } else {
        const reason = String(result.reason || "The AI could not confirm that this category is clear and distinct.");
        setConfirm({ message: `${reason}\n\nDo you want to save this category anyway? Please confirm again.`, onConfirm: () => persistCustomLever(draft) });
      }
    } catch (e) { setErrMsg(describeAIError(e, t)); }
    setBusy(false);
  };

  const tabBtn = (id, label) => (
    <button className={`yyc-lever-chip ${tab === id ? "is-active" : ""}`} style={{ padding: "8px 18px", fontSize: 13 }} onClick={() => { setTab(id); setErrMsg(""); }}>{label}</button>
  );

  return (
    <div className="yyc-modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="yyc-modal yyc-edit-record-modal" style={{ width: 640, maxWidth: "100%", padding: 24, maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: P.crimsonText, fontWeight: 750, letterSpacing: ".08em", textTransform: "uppercase" }}>Admin settings</div>
            <h2 style={{ margin: "4px 0 0", fontSize: 20, color: P.title, fontWeight: "bolder" }}>Lever Categories</h2>
          </div>
          <button className="yyc-icon-btn" onClick={onClose} disabled={busy} title={t.close} aria-label={t.close}><Icon name="close" size={13} /></button>
        </div>
        <div style={{ display: "flex", gap: 8, margin: "16px 0 4px" }}>
          {tabBtn("edit", "Edit existing")}
          {tabBtn("create", "Create new")}
        </div>

        {tab === "edit" && (<>
          <MgrField label="Lever">
            <select className="yyc-input" aria-label="Category to edit" value={target} onChange={(e) => pick(e.target.value)}>
              <optgroup label="Built-in levers">
                {[...Object.keys(BUILTIN_LEVER_DEFAULTS), "others"].map((id) => <option key={id} value={id}>{t.levers[id] || id}</option>)}
              </optgroup>
              {customLevers.length > 0 && (
                <optgroup label="Custom levers">
                  {customLevers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              )}
            </select>
          </MgrField>

          {(isBuiltin || isOthers) && (<>
            <MgrField label="Name"><input className="yyc-input" value={builtinDraft.name} onChange={(e) => setBuiltinDraft((d) => ({ ...d, name: e.target.value }))} /></MgrField>
            {isBuiltin && (<>
              <MgrField label="Definition the AI uses"><textarea className="yyc-input yyc-edit-record-textarea" rows={3} value={builtinDraft.description} onChange={(e) => setBuiltinDraft((d) => ({ ...d, description: e.target.value }))} /></MgrField>
              <MgrField label="Extra heading words (comma separated)" hint="A document heading that starts with one of these words is filed under this lever.">
                <input className="yyc-input" value={builtinDraft.headings} onChange={(e) => setBuiltinDraft((d) => ({ ...d, headings: e.target.value }))} placeholder="e.g. Tariffs, Rates" />
              </MgrField>
            </>)}
            {isOthers && <div style={{ fontSize: 12, lineHeight: 1.5, color: P.sub, marginTop: 8 }}>"Others" catches every strategy that fits no other lever; its meaning is fixed, its name and sub-categories are editable.</div>}
            <MgrFooter>
              <button className="yyc-btn-secondary" onClick={resetBuiltin}>Reset to original</button>
              <button className="yyc-btn-primary" onClick={saveBuiltin}>Save lever</button>
            </MgrFooter>
          </>)}

          {isOthers && (
            <MgrSection title="Sub-categories of Others">
              <MgrField label="Sub-category">
                <select className="yyc-input" aria-label="Sub-category to edit" value={subId} onChange={(e) => pickSub(e.target.value)}>
                  {OTHER_CATS.map((k) => <option key={k} value={k}>{t.otherCats[k] || k}</option>)}
                </select>
              </MgrField>
              <MgrField label="Name"><input className="yyc-input" value={subDraft.name} onChange={(e) => setSubDraft((d) => ({ ...d, name: e.target.value }))} /></MgrField>
              <MgrField label="Definition the AI uses"><textarea className="yyc-input yyc-edit-record-textarea" rows={3} value={subDraft.description} onChange={(e) => setSubDraft((d) => ({ ...d, description: e.target.value }))} /></MgrField>
              <MgrFooter>
                {customSubs.some((c) => c.id === subId)
                  ? <button className="yyc-btn-secondary" onClick={deleteSub}>Delete</button>
                  : <button className="yyc-btn-secondary" onClick={resetSub}>Reset to original</button>}
                <button className="yyc-btn-primary" onClick={saveSub}>Save sub-category</button>
              </MgrFooter>
            </MgrSection>
          )}

          {customTarget && customDraft && (<>
            <MgrField label="Name"><input className="yyc-input" value={customDraft.name} onChange={(e) => setCustomDraft((d) => ({ ...d, name: e.target.value }))} /></MgrField>
            <MgrField label="Definition and classification guidance"><textarea className="yyc-input yyc-edit-record-textarea" rows={3} value={customDraft.description} onChange={(e) => setCustomDraft((d) => ({ ...d, description: e.target.value }))} /></MgrField>
            <MgrField label="Example strategy" hint="The AI checks that the category is clear and distinct. If it flags a concern you can review the reason and save anyway."><textarea className="yyc-input yyc-edit-record-textarea" rows={2} value={customDraft.example} onChange={(e) => setCustomDraft((d) => ({ ...d, example: e.target.value }))} /></MgrField>
            <MgrField label="Extra heading words (comma separated)" hint="A document heading that starts with one of these words (or is this lever's own name) is filed under this lever."><input className="yyc-input" value={customDraft.headings || ""} onChange={(e) => setCustomDraft((d) => ({ ...d, headings: e.target.value }))} placeholder="e.g. Loyalty, Retention" /></MgrField>
            <MgrFooter><button className="yyc-btn-primary" onClick={() => validateAndSaveLever(customDraft)} disabled={busy}>{busy ? "Checking with AI…" : "Validate and save changes"}</button></MgrFooter>
          </>)}
        </>)}

        {tab === "create" && (<>
          <div className="yyc-chip-row" style={{ marginTop: 12 }}>
            <button className={`yyc-lever-chip ${createKind === "lever" ? "is-active" : ""}`} onClick={() => { setCreateKind("lever"); setErrMsg(""); }}>New lever</button>
            <button className={`yyc-lever-chip ${createKind === "sub" ? "is-active" : ""}`} onClick={() => { setCreateKind("sub"); setErrMsg(""); }}>New "Others" sub-category</button>
          </div>
          {createKind === "lever" ? (<>
            <MgrField label="Name"><input className="yyc-input" value={newLever.name} onChange={(e) => setNewLever((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Customer Retention" /></MgrField>
            <MgrField label="Definition and classification guidance"><textarea className="yyc-input yyc-edit-record-textarea" rows={3} value={newLever.description} onChange={(e) => setNewLever((d) => ({ ...d, description: e.target.value }))} placeholder="Describe which strategies belong in this category." /></MgrField>
            <MgrField label="Example strategy" hint="The AI checks that the category is clear and distinct. If it flags a concern you can review the reason and save anyway."><textarea className="yyc-input yyc-edit-record-textarea" rows={2} value={newLever.example} onChange={(e) => setNewLever((d) => ({ ...d, example: e.target.value }))} placeholder="Give the AI a concrete example." /></MgrField>
            <MgrField label="Extra heading words (comma separated)" hint="A document heading that starts with one of these words (or is this lever's own name) is filed under this lever."><input className="yyc-input" value={newLever.headings || ""} onChange={(e) => setNewLever((d) => ({ ...d, headings: e.target.value }))} placeholder="e.g. Loyalty, Retention" /></MgrField>
            <MgrFooter><button className="yyc-btn-primary" onClick={() => validateAndSaveLever(newLever)} disabled={busy}>{busy ? "Checking with AI…" : "Validate and create"}</button></MgrFooter>
          </>) : (<>
            <MgrField label="Name"><input className="yyc-input" value={newSub.name} onChange={(e) => setNewSub((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Technology & Systems" /></MgrField>
            <MgrField label="Definition the AI uses" hint="Strategies that fit no lever are filed under Others, then into one of its sub-categories; this tells the AI what belongs here."><textarea className="yyc-input yyc-edit-record-textarea" rows={3} value={newSub.description} onChange={(e) => setNewSub((d) => ({ ...d, description: e.target.value }))} placeholder="Describe which strategies belong in this sub-category." /></MgrField>
            <MgrFooter><button className="yyc-btn-primary" onClick={createSub}>Create sub-category</button></MgrFooter>
          </>)}
        </>)}

        {errMsg && <div style={{ color: P.redText, fontSize: 12.5, marginTop: 12 }}>{errMsg}</div>}
      </div>
    </div>
  );
}