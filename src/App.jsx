import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import mammoth from "mammoth";

const P = {
  paper: "#FAF7F2", paperDeep: "#F3EDE3", card: "#FFFFFF",
  ink: "#1A1614", sub: "#6E675E", faint: "#766E64",
  line: "#EDE7DE", lineDark: "#D8CFC2",
  crimson: "#C00000", crimsonDark: "#9A0000", crimsonSoft: "#FDEDED",
  maroon: "#7A0A0A", gold: "#B8860B", goldDark: "#8A6508", goldSoft: "#FFF6DC",
  green: "#0E7C4A", greenSoft: "#E6F5EC",
  red: "#B42318", redSoft: "#FDECEC",
  blue: "#3D4B6E", blueSoft: "#EEF0F5",
  wash: "#F5F0E8",
  s1: "0 1px 2px rgba(26,22,20,0.04), 0 1px 3px rgba(26,22,20,0.03)",
  s2: "0 2px 4px rgba(26,22,20,0.05), 0 6px 16px rgba(26,22,20,0.06)",
  s3: "0 4px 12px rgba(26,22,20,0.08), 0 16px 40px rgba(26,22,20,0.10)",
  focus: "0 0 0 3px rgba(192,0,0,0.12)",
};

const fontStack =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif";

const S = {
  card: { background: P.card, border: `1px solid ${P.line}`, borderRadius: 14, boxShadow: P.s1 },
  input: {
    width: "100%", border: `1px solid ${P.lineDark}`, background: P.card,
    fontSize: 13.5, padding: "10px 13px", outline: "none", borderRadius: 9,
    fontFamily: "inherit", color: P.ink, transition: "border-color .15s, box-shadow .15s",
  },
  label: { fontSize: 12, fontWeight: 600, color: P.sub, marginBottom: 6, display: "block", letterSpacing: ".01em" },
};

const btnBase = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
  fontWeight: 650, borderRadius: 9, cursor: "pointer", border: "none",
  fontFamily: "inherit", transition: "background .15s, box-shadow .15s, transform .08s",
};
const btnP = (disabled) => ({
  ...btnBase, padding: "10px 20px", fontSize: 13.5,
  background: disabled ? P.faint : P.crimson, color: "#fff",
  boxShadow: disabled ? "none" : "0 1px 3px rgba(154,0,0,0.2)",
  cursor: disabled ? "default" : "pointer",
});
const btnG = { ...btnBase, padding: "9px 15px", fontSize: 13, fontWeight: 600, border: `1px solid ${P.lineDark}`, background: P.card, color: P.sub };

const LEVERS = ["price", "volume", "cogs", "overheads", "ar_days", "inventory_days", "ap_days", "talent_strategy", "product_differentiation", "acquisition_expansion_valuation", "others"];

/* Records are always listed in lever order (price → volume → cogs → overheads → ar_days → inventory_days → ap_days →
   talent → product differentiation → others). Stable: records of the same lever keep their existing (document) order. */
const sortByLever = (arr) => (arr || [])
  .map((r, i) => ({ r, i, k: LEVERS.indexOf(r.lever) < 0 ? LEVERS.length : LEVERS.indexOf(r.lever) }))
  .sort((a, b) => a.k - b.k || a.i - b.i)
  .map((x) => x.r);

const OTHER_CATS_BASE = ["legal_regulatory_ip","business_model_execution","financing_capital","operations_process","partnerships_alliances","shareholder_governance"];
const OTHER_CAT_DEFAULT_DEFS = {
  "legal_regulatory_ip": "legal, regulatory and IP matters combined: trademark / IP protection and enforcement, licences, regulation, contracts and legal clauses (e.g. exclusive lease clauses).",
  "business_model_execution": "the strategy for HOW the business chooses to run and continue itself: its sales / go-to-market model, positioning, strategic focus and the choices that keep the model going (e.g. a strict direct-to-customer sales model, hyper-focused positioning, doubling down on what works, staying focused instead of diversifying).",
  "financing_capital": "how the business is funded: debt, equity or investors, capital structure, self-funding / reinvesting profit, cash reserves.",
  "operations_process": "SOPs and operating processes: standard procedures, workflows, logistics, quality control, how work is organised and carried out.",
  "partnerships_alliances": "brand tie-ups, distribution or supply deals, joint ventures, alliances and partner networks.",
  "shareholder_governance": "ownership and role structure between owners: avoid 50:50 ownership, divide roles clearly, shareholder rights, governance.",
  "uncategorized": "ONLY if none of the above fit."
};
/* The "Others" sub-categories are admin-editable too: config.otherCatOverrides[id] = { name, description } for the built-in ones and
   config.customOtherCats = [{ id, name, description }] for new ones. OTHER_CATS is updated IN PLACE (custom ones sit before "uncategorized"),
   so every place that loops over it sees the current list. With no edits the prompt text is exactly the original. */
const OTHER_CATS = [...OTHER_CATS_BASE, "uncategorized"];
let OTHER_CAT_OVERRIDES = {}, CUSTOM_OTHER_CATS = [];
function setOtherCatConfig(overrides, custom) {
  OTHER_CAT_OVERRIDES = overrides && typeof overrides === "object" ? overrides : {};
  CUSTOM_OTHER_CATS = Array.isArray(custom) ? custom.filter((c) => c && c.id && c.name) : [];
  OTHER_CATS.length = 0;
  OTHER_CATS.push(...OTHER_CATS_BASE, ...CUSTOM_OTHER_CATS.map((c) => c.id), "uncategorized");
}
const otherCatDefinition = (id) => {
  const c = CUSTOM_OTHER_CATS.find((x) => x.id === id);
  if (c) return `${c.name}: ${c.description}`;
  return String((OTHER_CAT_OVERRIDES[id] && OTHER_CAT_OVERRIDES[id].description) || "").trim() || OTHER_CAT_DEFAULT_DEFS[id];
};
// What each "Others" category means (shared by the extraction prompt and the classifier call, so they can never drift apart)
const otherCatDefs = () => OTHER_CATS.map((id) => `  - ${id} = ${otherCatDefinition(id)}`).join("\n");
/* The 10 built-in levers are admin-editable (Admin settings > Edit built-in levers). These are the defaults; an admin override
   (config.leverOverrides[id] = { name, description, headings }) replaces the display name, the definition the AI is given, and
   adds extra heading words that map to the lever. With no overrides the extraction prompt is exactly what it always was. */
const BUILTIN_LEVER_DEFAULTS = {
  price: "pricing strategy, discounts, price sensitivity, value-based pricing, revenue per unit",
  volume: "sales volume, customer count, traffic, repeat purchases, cross-sell, market expansion",
  cogs: "cost of goods sold, gross margin, unit cost, supplier cost, wastage, warranty recovery (NOT receivable or payable days)",
  overheads: "fixed costs, rent/lease, payroll, staff headcount, occupancy, admin expenses (NOT receivable or payable days — those are ar_days / ap_days)",
  ar_days: "receivables, DSO, collections, credit terms, unpaid invoices, cash collection discipline",
  inventory_days: "stock levels, turnover, stock turns, obsolescence, holding days, WIP",
  ap_days: "payables, supplier payment terms, creditor days, negotiated payment windows, payable days",
  talent_strategy: "hiring, training, retention, culture, succession, incentives, employee capability",
  product_differentiation: "product design, IP, unique features, brand equity, customer experience, co-creation, exclusivity, service differentiation",
  acquisition_expansion_valuation: "M&A strategy, target sourcing/screening, acquisition criteria, buy-and-build, platform/bolt-on acquisitions, deal valuation, ownership/earn-out approach, long-term ownership, and post-acquisition integration/operating model when explicitly tied to acquisitions.",
};
let LEVER_OVERRIDES = {}; // set from the saved config by setLeverOverrides(); read by the prompt builder and the heading matcher
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const splitHeadings = (s) => String(s || "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
let EXTRA_HEADING_LEVER = []; // checked BEFORE the built-in heading rules: a custom lever named "Customer Retention" must not be swallowed by the built-in "Customers" rule
let CUSTOM_LEVERS = []; // custom levers from the lever definitions (the levers table when the shared database is on)
// words that send a document heading to a custom lever: the admin's heading words, plus the lever's own name
const customHeadingWords = (l) => [...new Set([...splitHeadings(l.headings), String(l.name || "").trim()].filter(Boolean))];
function setLeverOverrides(ov, custom) {
  LEVER_OVERRIDES = ov && typeof ov === "object" ? ov : {};
  CUSTOM_LEVERS = Array.isArray(custom) ? custom.filter((l) => l && l.id && l.name) : [];
  const toRe = (h) => new RegExp("^" + escRe(h) + "(?![A-Za-z])", "i");
  EXTRA_HEADING_LEVER = [
    ...Object.entries(LEVER_OVERRIDES).flatMap(([id, o]) => (BUILTIN_LEVER_DEFAULTS[id] ? splitHeadings(o && o.headings).map((h) => [toRe(h), id]) : [])),
    ...CUSTOM_LEVERS.flatMap((l) => customHeadingWords(l).map((h) => [toRe(h), l.id])),
  ];
}
const leverDefinition = (id) => String((LEVER_OVERRIDES[id] && LEVER_OVERRIDES[id].description) || "").trim() || BUILTIN_LEVER_DEFAULTS[id];
const leverDefLine = (id) => {
  const nm = String((LEVER_OVERRIDES[id] && LEVER_OVERRIDES[id].name) || "").trim();
  return `- ${id}:${nm ? ` (shown to users as "${nm}")` : ""} ${leverDefinition(id)}`;
};
const extraHeadingNote = () => {
  const rows = [
    ...Object.entries(LEVER_OVERRIDES).filter(([id]) => BUILTIN_LEVER_DEFAULTS[id]).map(([id, o]) => [id, splitHeadings(o && o.headings)]),
    ...CUSTOM_LEVERS.map((l) => [l.id, customHeadingWords(l)]),
  ].filter(([, h]) => h.length);
  return rows.length ? `\nAlso: ${rows.map(([id, h]) => `${h.join(" / ")} → ${id}`).join(" · ")}` : "";
};
const LEGACY_OTHER_CATEGORY = {
  legal_ip: "legal_regulatory_ip", regulatory: "legal_regulatory_ip",
  partnerships: "partnerships_alliances", financing: "financing_capital",
  operations: "operations_process", tech_systems: "business_model_execution",
  moat: "business_model_execution", risk_lessons: "uncategorized", misc: "uncategorized",
};

function normalizeOther(r) {
  const category = LEGACY_OTHER_CATEGORY[r.other_category] || r.other_category;
  if (r.lever === "others" && r.other_category === "expansion") {
    const migrated = { ...r, lever: "acquisition_expansion_valuation" };
    delete migrated.other_category; delete migrated.related_to;
    return migrated;
  }
  if (r.lever !== "others") { const rest = { ...r }; delete rest.other_category; delete rest.related_to; return rest; }
  return { ...r, other_category: OTHER_CATS.includes(category) ? category : "uncategorized", related_to: String(r.related_to || "").trim() };
}

/* claim_en is always stored as "Strategy name: description". The name is shown in bold, the
   document's actual impact sits in a light-brown box underneath (older records fall back to their quote). */
function splitClaim(text) {
  const s = String(text || "").trim();
  const i = s.indexOf(": ");
  return i > 0 && i <= 120 ? { name: s.slice(0, i), desc: s.slice(i + 2) } : { name: "", desc: s };
}
// The UI prints its own "Actual impact:" heading, so a label copied from the document ("Actual Impact: …") must never stay in the text
function stripImpactLabel(s) {
  let out = String(s || "").trim();
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/^\s*(?:actual\s+impacts?(?:\s*&\s*power\s+cash\s+link)?|financial\s+impact|impact|results?)\s*[:：\-–—]\s*/i, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}
const impactOf = (r) => stripImpactLabel(r?.impact || r?.quote || "");
function ClaimText({ text }) {
  const { name, desc } = splitClaim(text);
  return <>{name && <b>{name}</b>}{name && ": "}<span style={{ whiteSpace: "pre-line" }}>{desc}</span></>; // pre-line keeps the bullet lines
}
function ImpactBox({ record, style }) {
  const txt = impactOf(record);
  if (!txt) return null;
  return (
    <div style={{ fontSize: 12.5, color: P.sub, lineHeight: 1.55, padding: "8px 12px", background: P.wash, borderRadius: 8, borderLeft: `3px solid ${P.lineDark}`, ...style }}>
      <span style={{ fontWeight: 700, color: P.ink }}>Actual impact: </span>{txt}
    </div>
  );
}

function leverTag(t, r) {
  const base = t.levers[r.lever] || r.lever;
  return r.lever === "others" && t.otherCats[r.other_category] ? `${base} · ${t.otherCats[r.other_category]}` : base;
}

function normalizeMainCategory(raw) {
  const s = String(raw || "").toLowerCase();
  if (!s.trim()) return "General";
  if (s.includes("trading") && s.includes("retail")) return "Trading / Retail";
  if (s.includes("trading")) return "Trading";
  if (s.includes("retail")) return "Retail";
  if (s.includes("manufactur")) return "Manufacturing";
  if (s.includes("construction")) return "Construction";
  if (s.includes("healthcare") || s.includes("health care")) return "Healthcare";
  if (s.includes("service") || s.includes("advisory") || s.includes("consult")) return "Services";
  if (s.includes("tech")) return "Technology";
  if (s.includes("education")) return "Education";
  if (s.includes("hospitality") || s.includes("food") || s.includes("f&b")) return "F&B / Hospitality";
  return raw;
}

function parseIndustry(industry, doc) {
  if (doc && doc.industry_main) {
    return { main: doc.industry_main, sub: doc.industry_sub || "" };
  }
  if (!industry) return { main: "General", sub: "" };
  const s = String(industry).trim();
  const m = s.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    return { main: normalizeMainCategory(m[2].trim()), sub: m[1].trim() };
  }
  return { main: s, sub: "" };
}

const T = {
  en: {
    appTitle: "Advisory Brain", appSub: "Internal knowledge · Closed-book",
    workspace: "Workspace",
    tabs: { kb: "Knowledge Base", chat: "Ask the Brain", explorer: "Lever Explorer", gap: "Gap Log" },
    kbUser: "Browse the materials uploaded by the YYC team. Click any card to read the summary or full document.",
    kbAdmin: "Upload case studies, playbooks and frameworks. The AI extracts the 10 levers automatically.",
    admin: "Admin", unlockAdmin: "Unlock admin", lockAdmin: "Exit admin",
    exitBlocked: "Finish the current action before exiting admin.",
    passPrompt: "Enter admin passcode", passWrong: "Wrong passcode. Try again.",
    passNote: "Enter the admin passcode to unlock the admin features. ",
    unlock: "Unlock", cancel: "Cancel",
    kbEmpty: "No materials yet. Upload the first case study or playbook.",
    kbEmptyViewer: "No materials yet. Ask an admin to upload the first documents.",
    upload: "Add material", uploadDocx: " Upload .docx", orPaste: "or paste text",
    titlePh: "Document title (e.g. Sweetwater Case Study)",
    textPh: "Paste the material text here…",
    extract: "Extract with AI",
    extracting: "Reading, categorizing and plucking the 10 levers…",
    reviewTitle: "Review extraction before saving",
    reviewNote: "Check the tags and lever records — your confirmation keeps the knowledge base clean.",
    saveDoc: "Confirm & save", discard: "Discard",
    docType: "Type", industry: "Industry", problemSig: "Problem signature",
    sections: "Sections", leverRecords: "Lever records",
    del: "Delete", delConfirm: "Delete this material and its lever records?",
    edit: "Edit", editTitle: "Edit material", saveChanges: "Save changes",
    addRecord: "+ Add lever record", addSection: "+ Add section",
    fullText: "Full text", docView: "Document", sumView: "Summary",
    materials: "Materials", coverage: "Lever coverage",
    chatIntro: "Ask anything covered by the uploaded materials. Answers cite their sources — anything outside the knowledge base is refused.",
    chatPh: "Ask anything… type @ to tag a material",
    send: "Ask", clearChat: "Clear chat", thinking: "Searching the knowledge base…",
    refused: "This isn't covered in the YYC knowledge base yet. The question has been logged for the content team.",
    refs: "References", noDocsChat: "The knowledge base is empty — upload materials first.",
    gapIntro: "Every refused question lands here — this is the content-production roadmap.",
    gapEmpty: "No rejected questions yet.", clearGap: "Clear log", close: "Close",
    saved: "Saved to the shared knowledge base",
    loadErr: "Couldn't reach storage. Reload and try again.",
    apiErr: "The AI call failed. Try again in a moment.",
    rateDaily: "AI Tool's DAILY token limit is used up (free plan: 200,000 tokens/day). It resets in about {time}. Wait until then, or upgrade the AI plan to continue now.",
    rateMinute: "AI per-minute rate limit hit repeatedly. Wait about {time} and press retry.",
    rateWaiting: "Rate limit reached — retrying automatically in",
    changePass: "Change passcode", newPassPh: "New passcode", passChanged: "Passcode updated.",
    sharedNote: "Shared knowledge base — visible to everyone using this app.",
    searchPh: "Search materials…", noResults: "No matching materials.", exportKB: "Export backup",
    allLevers: "All levers", allMainCat: "All industries", allSubCat: "All sub-industries",
    filterByLever: "Filter by lever", recordsByLever: "Lever records",
    jumpToSection: "Click a record to open the source document at the relevant section.",
    noLeverRecords: "No lever records match the current filters.",
    clearFilters: "Clear filters",
    filterByThisLever: "Filter by this lever",
    showLeversFromDoc: "Other levers in this book",
    hideLeversFromDoc: "Hide other levers",
    pickLeverTitle: "Filter by lever",
    pickLeverHint: "Choose a lever to filter the list.",
    openSource: "Open source document",
    closeMenu: "Close",
    whyThis: "Why this answer",
    evidenceMatch: "match",
    closestMatch: "Closest material found",
    belowThresholdNote: "below threshold — not enough to answer from YYC materials",
    checkedDocs: "Checked for this question",
    tryAsking: "Try asking",
    loadingSuggestions: "Preparing example questions…",
    bulkTitle: "Bulk upload",
    bulkHint: "Documents are extracted one by one, ~70s apart, to stay inside the AI 8k tokens/minute limit. You can leave this running.",
    bulkStop: "Stop queue",
    bulkWaiting: "Rate-limit pacing — next document in",
    bulkReviewBtn: "Review & save",
    bulkRetry: "Retry",
    bulkDoneAll: "Queue finished — review and save each document above.",
    backToLibrary: "Back to library",
    statusPending: "queued",
    statusExtracting: "extracting…",
    statusDone: "ready to review",
    statusError: "failed",
    stageReading: "Reading document",
    stageAnalyze: "Categorizing & summarizing",
    stageLevers: "Extracting lever strategies",
    importKB: "Import backup",
    importConfirm: "Import {n} materials from this backup? Existing materials are kept & duplicates are skipped.",
    importDone: "Imported {n} new materials",
    importErr: "Import failed — this is not a valid YYC backup file.",
    importQuotaErr: "Import failed — browser storage is full (5MB limit). Delete some materials and retry.",
    explorerIntro: "Pick a lever to see every strategy across the whole library, side by side — with its impact and source.",
    explorerStats: "{n} strategies across {m} materials",
    explorerSearchPh: "Search strategies…",
    explorerEmpty: "No strategies match — try another lever or clear the filters.",
    greetReply: "Hello! I'm the YYC Advisory Brain — ask me anything covered by our materials, or type @ to tag a specific one.",
    hintTip: "💡 Tip: Ctrl+K jumps anywhere · type @ in chat to tag a material",
    gotIt: "Got it",
    kbarPh: "Jump to a material, page, or lever…",
    kbarEmpty: "No matches",
    kbarDoc: "Material",
    kbarPage: "Page",
    kbarLever: "Filter by lever",
    similarExisting: "Similar existing claim",
    skipRecord: "Don't save",
    skippedNote: "Skipped — click to keep",
    levers: {
      price: "Price", volume: "Volume", cogs: "COGS", overheads: "Overheads",
      ar_days: "AR days", inventory_days: "Inventory days", ap_days: "AP days",
      talent_strategy: "Talent Strategies", product_differentiation: "Product Differentiation",
      acquisition_expansion_valuation: "Acquisition, Expansion & Valuation", others: "Others",
    },
    docTypes: { case_study: "Case study", playbook: "Playbook", framework: "Framework", notes: "Key notes" },
    otherCats: {
      legal_regulatory_ip: "Legal, Regulatory & IP",
      business_model_execution: "Business Model / Execution",
      financing_capital: "Financing & Capital",
      operations_process: "Operations & Process (SOPs)",
      partnerships_alliances: "Partnerships & Alliances",
      shareholder_governance: "Shareholder Governance",
      uncategorized: "Uncategorized",
    },
    otherCat: "Category", relatedTo: "Related to",
    relatedToPh: "What it relates to (e.g. trademark enforcement against copycats)",
    allOtherCats: "All categories",
  },
  zh: {
    appTitle: "顾问知识大脑", appSub: "内部知识库",
    workspace: "工作台",
    tabs: { kb: "知识库", chat: "智能问答", explorer: "杠杆总览", gap: "缺口日志" },
    admin: "管理员", unlockAdmin: "解锁管理员", lockAdmin: "退出管理员",
    kbUser: "浏览并阅读YYC团队上传的资料。点击任何一张卡片来阅读总结或是原文。",
    kbAdmin: "上传案例研究，指南，等等。AI会自动生成10个杠杆",
    exitBlocked: "请先完成当前操作,再退出管理员。",
    passPrompt: "输入管理员密码", passWrong: "密码错误,请重试。",
    passNote: "请输入管理员密码来解锁更多管理功能。",
    unlock: "解锁", cancel: "取消",
    kbEmpty: "暂无资料。请上传第一份案例或手册。",
    kbEmptyViewer: "暂无资料。请管理员先上传文件。",
    upload: "新增资料", uploadDocx: "上传 .docx", orPaste: "或粘贴文字",
    titlePh: "文件标题 (例:Sweetwater 案例)", textPh: "在此粘贴资料内容…",
    extract: "AI 提取", extracting: "正在阅读、分类并提取十大杠杆…",
    reviewTitle: "保存前请核对提取结果",
    reviewNote: "请检查标签与杠杆记录——您的确认能保持知识库干净。",
    saveDoc: "确认并保存", discard: "放弃",
    docType: "类型", industry: "行业", problemSig: "问题特征",
    sections: "章节", leverRecords: "杠杆记录",
    del: "删除", delConfirm: "删除此资料及其杠杆记录?",
    edit: "编辑", editTitle: "编辑资料", saveChanges: "保存修改",
    addRecord: "+ 新增杠杆记录", addSection: "+ 新增章节",
    fullText: "全文", docView: "文档", sumView: "摘要",
    materials: "资料", coverage: "杠杆覆盖",
    chatIntro: "提问范围限于已上传资料。答案附来源引用，知识库以外的问题一律拒答。",
    chatPh: "输入问题… 输入 @ 可标记资料",
    send: "提问", clearChat: "清空对话", thinking: "正在检索知识库…",
    refused: "YYC 知识库暂未涵盖此问题，已记录给内容团队。",
    refs: "参考来源", noDocsChat: "知识库为空,请先上传资料。",
    gapIntro: "所有被拒答的问题都会记录在此——这就是内容生产路线图。",
    gapEmpty: "暂无被拒答的问题。", clearGap: "清空日志", close: "关闭",
    saved: "已保存到共享知识库",
    loadErr: "无法连接存储,请刷新重试。",
    apiErr: "AI 调用失败,请稍后重试。",
    rateDaily: "AI 今日的 token 额度已用完(免费版每日 200,000 tokens)。约 {time} 后重置。请等待,或升级 AI 方案(console.groq.com --> Billing)以立即继续。",
    rateMinute: "AI 每分钟限速多次触发。请等待约 {time} 后点击重试。",
    rateWaiting: "已触发限速——自动重试倒计时",
    changePass: "修改密码", newPassPh: "新密码", passChanged: "密码已更新。",
    sharedNote: "共享知识库———所有使用此应用的人都能看到。",
    searchPh: "搜索资料…", noResults: "没有匹配的资料。", exportKB: "导出备份",
    allLevers: "全部杠杆", allMainCat: "全部行业", allSubCat: "全部子行业",
    filterByLever: "按杠杆筛选", recordsByLever: "杠杆记录",
    jumpToSection: "点击记录以打开来源文档的对应章节。",
    noLeverRecords: "当前筛选条件下没有杠杆记录。",
    clearFilters: "清除筛选",
    filterByThisLever: "按此杠杆筛选",
    showLeversFromDoc: "此书的其他杠杆",
    hideLeversFromDoc: "隐藏其他杠杆",
    pickLeverTitle: "按杠杆筛选",
    pickLeverHint: "选择杠杆以筛选列表。",
    openSource: "打开来源文档",
    closeMenu: "关闭",
    whyThis: "答案依据",
    evidenceMatch: "匹配",
    closestMatch: "最接近的资料",
    belowThresholdNote: "低于门槛，不足以从 YYC 资料作答",
    checkedDocs: "本次搜索的相关资料",
    tryAsking: "试试提问",
    loadingSuggestions: "正在生成示例问题…",
    bulkTitle: "批量上传",
    bulkHint: "AI,文件将逐份提取、间隔约 70 秒。您可以让它在后台运行。",
    bulkStop: "停止队列",
    bulkWaiting: "限速等待——下一份文件还有",
    bulkReviewBtn: "核对并保存",
    bulkRetry: "重试",
    bulkDoneAll: "队列完成——请逐份核对并保存。",
    backToLibrary: "返回知识库",
    statusPending: "排队中",
    statusExtracting: "提取中…",
    statusDone: "待核对",
    statusError: "失败",
    stageReading: "读取文件",
    stageAnalyze: "分类与摘要",
    stageLevers: "提取杠杆策略",
    importKB: "导入备份",
    importConfirm: "从备份导入 {n} 份材料?现有材料将保留, 重复的将被跳过。",
    importDone: "已导入 {n} 份新材料",
    importErr: "导入失败———这不是有效的 YYC 备份文件。",
    importQuotaErr: "导入失败——浏览器存储已满(5MB 上限)。请删除部分材料后重试。",
    explorerIntro: "选择一个杠杆,横向查看整个知识库中的所有策略——包括实际影响与来源。",
    explorerStats: "{m} 份材料中共 {n} 项策略",
    explorerSearchPh: "搜索策略…",
    explorerEmpty: "没有匹配的策略——请更换杠杆或清除筛选。",
    greetReply: "你好! 我是 YYC 顾问知识大脑——欢迎提问资料涵盖的任何内容,输入 @ 可指定资料。",
    hintTip: "💡 提示: Ctrl+K 快速跳转 · 聊天中输入 @ 可标记资料",
    gotIt: "知道了",
    kbarPh: "跳转到资料、页面或杠杆…",
    kbarEmpty: "没有匹配结果",
    kbarDoc: "资料",
    kbarPage: "页面",
    kbarLever: "按杠杆筛选",
    similarExisting: "与现有记录相似",
    skipRecord: "不保存",
    skippedNote: "已跳过——点击恢复",
    levers: {
      price: "价格", volume: "销量", cogs: "销售成本", overheads: "经常开销",
      ar_days: "应收天数", inventory_days: "库存天数", ap_days: "应付天数",
      talent_strategy: " 人才战略", product_differentiation: "产品差异化", others: "其他",
    },
    docTypes: { case_study: "案例研究", playbook: "实战手册", framework: "框架理论", notes: "重点笔记" },
    otherCats: {
      legal_ip: "法律与知识产权", partnerships: "合作与联盟", regulatory: "监管与合规",
      moat: "竞争护城河", expansion: "并购与扩张", financing: "融资与资本",
      tech_systems: "科技与系统", operations: "营运与流程", risk_lessons: "风险与经验教训",
      misc: "未分类",
    },
    otherCat: "类别", relatedTo: "相关于",
    relatedToPh: "相关内容（例:打击仿冒商标）",
    allOtherCats: "全部类别",
  },
};

const TYPE_COLORS = {
  case_study: { bg: "#FDEDED", fg: "#9A0000" },
  playbook: { bg: "#FFF6DC", fg: "#8A6508" },
  framework: { bg: "#E6F5EC", fg: "#0E7C4A" },
  notes: { bg: "#EEF0F5", fg: "#3D4B6E" },
};

// Personal, per-browser values only (UI hints). The library itself is read and written through window.db (src/db.js).
async function sget(key, shared = true) {
  try { const r = await window.storage.get(key, shared); return r ? JSON.parse(r.value) : null; }
  catch { return null; }
}
async function sset(key, val, shared = true) {
  const r = await window.storage.set(key, JSON.stringify(val), shared);
  if (!r) throw new Error("storage write failed");
}

/* Nothing is hard-deleted. Every stored item (document, index entry, lever record, chat message, gap-log entry) has a status:
   "active" (missing = active, for older data) or "deleted" (kept in storage with deleted_at, hidden everywhere in the app). */
const isLive = (x) => !x || x.status !== "deleted";
const live = (arr) => (Array.isArray(arr) ? arr.filter(isLive) : []);
const me = () => (window.storage?.user && window.storage.user.email) || undefined; // signed-in user (shared database), for the audit trail
const softDelete = (x) => ({ ...x, status: "deleted", deleted_at: Date.now(), deleted_by: me() });

const GROQ_URL = "/api/groq/chat"; // proxied server-side so the API key never reaches the browser
const GROQ_MODEL = "openai/gpt-oss-120b";

const fmtElapsed = (ms) => { const sec = Math.round(ms / 1000); return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`; };
function estimateTokens(str) { return Math.ceil((str || "").length / 3.5); }


function tokenizeQuery(qstr) {
  /* "m&a" -> "mna" so single-letter-ampersand terms survive; 2-digit numbers ("50" in 50/50, "60/40") are kept as tokens too */
  const lowered = (qstr || "").toLowerCase().replace(/\b([a-z])&([a-z])\b/g, "$1n$2");
  /* light stemming so "reinvesting" matches "reinvest" and "dividends" matches "dividend" (applied the same way to documents) */
  const stem = (w) => (w.length > 5 ? w.replace(/ies$/, "y").replace(/(ing|ed|es|s)$/, "") : w);
  const latin = (lowered.match(/[a-z0-9]{3,}|\b\d{2}\b/g) || []).map(stem);
  const runs = (qstr || "").match(/[\u4e00-\u9fff]+/g) || [];
  const cjk = [];
  runs.forEach((run) => {
    if (run.length === 1) cjk.push(run);
    for (let k = 0; k + 1 < run.length; k++) cjk.push(run.slice(k, k + 2));
  });
  return [...new Set([...latin, ...cjk])];
}

// BM25 (Okapi) ranking for the local knowledge base. The corpus is small enough
// to index in the browser; it does not require a hosted search or vector service.
function bm25Rank(query, documents, textOf, extraQuery = "", extraWeight = 0.5) {
  /* extraQuery = AI-suggested synonyms/keywords: they widen the search but count for less than the user's own words */
  const own = tokenizeQuery(query);
  const weight = new Map(own.map((tk) => [tk, 1]));
  tokenizeQuery(extraQuery).forEach((tk) => { if (!weight.has(tk)) weight.set(tk, extraWeight); });
  const terms = [...weight.keys()];
  if (!terms.length || !documents.length) return [];
  const tokenized = documents.map((item) => tokenizeQuery(textOf(item)));
  const avgLength = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / tokenized.length || 1;
  const documentFrequency = new Map();
  tokenized.forEach((tokens) => new Set(tokens).forEach((token) => documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1)));
  const k1 = 1.2;
  const b = 0.75;
  const scored = documents.map((item, i) => {
    const tokens = tokenized[i];
    const frequencies = new Map();
    tokens.forEach((token) => frequencies.set(token, (frequencies.get(token) || 0) + 1));
    let score = 0;
    terms.forEach((term) => {
      const tf = frequencies.get(term) || 0;
      if (!tf) return;
      const df = documentFrequency.get(term) || 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      score += weight.get(term) * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * tokens.length / avgLength)));
    });
    return { item, score };
  });
  return scored.sort((a, b) => b.score - a.score).filter((x) => x.score > 0);
}

/* Split a document into overlapping ~800-character chunks on line boundaries, remembering the section heading each chunk sits under,
   so retrieval can rank paragraphs instead of whole documents. */
function chunkDocument(doc, size = 800, overlap = 160) {
  const headings = new Set((doc.sections || []).map((s) => String(s.heading || "").trim().toLowerCase()).filter(Boolean));
  const lines = String(doc.full_text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const chunks = [];
  let buf = "";
  let heading = "";
  let chunkHeading = "";
  const push = () => {
    if (buf.trim().length > 40) chunks.push({ doc_id: doc.id, pos: chunks.length, title: doc.title, industry: doc.industry, heading: chunkHeading, text: buf.trim() });
    // carry the tail of this chunk into the next one, starting at a word boundary
    let tail = buf.length > overlap ? buf.slice(buf.length - overlap) : "";
    const sp = tail.search(/\s/);
    buf = sp >= 0 ? tail.slice(sp + 1) : tail;
    chunkHeading = heading;
  };
  for (const line of lines) {
    const isHeading = headings.has(line.toLowerCase());
    // a single very long line is cut so no chunk balloons past the budget
    for (let p = 0; p < line.length || p === 0; p += size) {
      const piece = line.slice(p, p + size);
      if (buf.length + piece.length + 1 > size && buf.length > 0) push();
      if (p === 0 && isHeading) heading = line; // the heading applies from this line on, after the previous chunk was closed
      if (!buf) chunkHeading = heading;
      buf += (buf ? "\n" : "") + piece;
      if (line.length <= size) break;
    }
  }
  push();
  return chunks;
}

/* Ask the model for search keywords/synonyms for the question (used only to widen BM25). Never throws: on any failure or timeout
   it returns [] and the search proceeds with the original question alone. */
async function expandQuery(question, history) {
  const prompt = `Rewrite a search question for a keyword search over business case studies (pricing, volume, cost, inventory, talent, ownership, funding, strategy).
Return ONLY JSON: {"keywords": ["..."]} with 6-12 short words or phrases: synonyms, alternative wordings, related concepts and any numbers or ratios in other formats (e.g. "50 50" -> "50:50", "equal ownership", "equal shareholding", "deadlock", "joint control"). Do not answer the question. Do not repeat words already in it.
${history ? `RECENT CONVERSATION (resolve follow-ups such as "what about 60/40?" from this):\n${history}\n` : ""}QUESTION: ${question}`;
  try {
    const j = await Promise.race([
      askAI(prompt, 300, 0),
      new Promise((_, reject) => setTimeout(() => reject(new Error("rewrite timeout")), 8000)),
    ]);
    return (Array.isArray(j?.keywords) ? j.keywords : [])
      .filter((k) => typeof k === "string" && k.trim().length > 1 && k.length <= 40)
      .slice(0, 12);
  } catch {
    return [];
  }
}

function claimSimilarity(a, b) {
  const A = new Set(tokenizeQuery(a));
  const B = new Set(tokenizeQuery(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter++; });
  return inter / (A.size + B.size - inter);
}
/* Tie each bullet of a list answer to the lever record it came from, so references can point at the exact claim.
   Order of trust: the [R#] tag the model was asked to add -> closest wording among records not yet used -> no link (caller keeps the
   document+section reference). Tags are always removed from the displayed text, including invalid ones. */
function linkBulletsToRecords(answer, records) {
  const used = new Set();
  const linked = [];
  const claimTokens = (records || []).map((r) => new Set(tokenizeQuery(`${r.claim_en || r.claim_zh || ""} ${r.lever || ""}`)));
  const lines = String(answer || "").split("\n").map((line) => {
    const tags = [...line.matchAll(/\[R(\d{1,2})\]/gi)].map((m) => Number(m[1]) - 1);
    const clean = line.replace(/\s*\[R\d{1,2}\]/gi, "");
    if (!/^\s*(?:[-*•]|\d+[.)])\s+/.test(line) || !records?.length) return clean;
    let idx = tags.find((i) => i >= 0 && i < records.length);
    if (idx === undefined) {
      /* share of the bullet's own words found in the claim; accept only a clear winner */
      const words = tokenizeQuery(clean);
      const scores = claimTokens.map((set, i) => ({ i, hits: used.has(i) ? 0 : words.filter((w) => set.has(w)).length }));
      scores.sort((a, b) => b.hits - a.hits);
      const best = scores[0];
      const next = scores[1] ? scores[1].hits : 0;
      if (best && words.length >= 3 && best.hits >= 3 && best.hits / words.length >= 0.5 && best.hits >= next + 2) idx = best.i;
    }
    if (idx !== undefined) { used.add(idx); linked.push(records[idx]); }
    return clean;
  });
  return { text: lines.join("\n"), records: linked };
}
function isSmallTalk(qstr) {
  const s = (qstr || "").trim().toLowerCase();
  if (s.length > 25) return false; // real questions are longer
  return /^(hi+|hello+|hey+|yo|good (morning|afternoon|evening)|thanks?( you)?|thank u|tq|bye|goodbye|ok(ay)?|哈啰|你好|您好|早上好|下午好|晚上好|谢谢|多谢|再见|拜拜)[!.?~\s]*$/.test(s);
}
function assertUnderLimit(messages, maxTokens) {
  const inputTokens = messages.reduce((s, m) => s + estimateTokens(m.content), 0);
  const total = inputTokens + (maxTokens || 0);
  const LIMIT = 7500;
  if (total > LIMIT) throw new Error(`Payload ${total} tokens exceeds safe limit ${LIMIT}. Reduce context.`);
  return total;
}
/* ---- client-side TPM budget: Groq admits a request as (input tokens + max_tokens),
   so every call reserves its estimated footprint in a rolling 60s window and waits
   its turn instead of colliding into 429s ---- */
const PER_KEY_TPM = 7600; // slightly under the 8,000 TPM limit of ONE Groq key: also the biggest a single request may be
const tpmLog = []; // {at, tokens}
/* Fast extraction (on by default; the tick box on the Add material screen, stored as localStorage "yyc:fast"): the server holds several
   Groq keys and spreads load over them, so the per-minute budget is PER_KEY_TPM x the number of keys and several chunks of one document
   are extracted at once. Off = the original behaviour: one key's budget, one chunk at a time, a pause between bulk documents. */
const fastExtraction = () => { try { return localStorage.getItem("yyc:fast") !== "0"; } catch { return true; } };
let groqKeysPromise = null;
function groqKeyCount() { // asked once from the server; 1 when unknown
  if (!groqKeysPromise) groqKeysPromise = fetch(GROQ_URL).then((r) => (r.ok ? r.json() : {})).then((j) => Math.max(1, Math.min(8, Number(j && j.keys) || 1))).catch(() => 1);
  return groqKeysPromise;
}
const keysInUse = async () => (fastExtraction() ? groqKeyCount() : 1);
async function reserveTPM(need) {
  const limit = PER_KEY_TPM * (await keysInUse());
  for (; ;) {
    const now = Date.now();
    while (tpmLog.length && now - tpmLog[0].at > 60000) tpmLog.shift();
    const used = tpmLog.reduce((sum, x) => sum + x.tokens, 0);
    if (used + need <= limit) { tpmLog.push({ at: now, tokens: need }); return; }
    const waitMs = tpmLog.length ? 61000 - (now - tpmLog[0].at) : 2000;
    await new Promise((r) => setTimeout(r, Math.min(Math.max(waitMs, 1000), 61000)));
  }
}

const SYSTEM_MSG = "You are a precise JSON engine. Always respond with a single valid JSON object and nothing else.";

/* Typed AI failure so the UI can say WHY (daily quota vs per-minute limit vs other), not just "call failed" */
class AIError extends Error {
  constructor(kind, waitSec, detail) { super(detail || kind); this.kind = kind; this.waitSec = waitSec; }
}
// Groq says e.g. "Please try again in 9m10.36s" / "1h2m3.5s" / "45.2s"
function parseRetryHint(msg) {
  const m = String(msg || "").match(/try again in\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*([\d.]+)s/i);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + parseFloat(m[3]) : 0;
}
let aiListener = null; // the visible panel subscribes to show live rate-limit waits
const setAiListener = (fn) => { aiListener = fn; };
const aiNotify = (n) => { try { aiListener && aiListener(n); } catch { /* UI gone */ } };
function fmtWait(sec) {
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.ceil((sec % 3600) / 60)}m`;
  if (sec >= 60) return `${Math.ceil(sec / 60)} min`;
  return `${sec}s`;
}
function describeAIError(e, t) {
  if (e instanceof AIError && e.kind === "daily") return t.rateDaily.replace("{time}", fmtWait(e.waitSec));
  if (e instanceof AIError && e.kind === "minute") return t.rateMinute.replace("{time}", fmtWait(e.waitSec));
  return t.apiErr;
}

async function askAI(userContent, maxTokens = 1500, maxRetries = 2) {
  let useReasoningParam = true; // gpt-oss is a reasoning model: cap hidden thinking so it doesn't eat the JSON budget
  let rateWaits = 0; // 429s: wait out the TPM window instead of failing (max 3)
  const inputTok = estimateTokens(SYSTEM_MSG + userContent) + 60;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      /* clamp so input + max_tokens always fits inside one minute's quota */
      const effMax = Math.max(600, Math.min(maxTokens * (i + 1), PER_KEY_TPM - inputTok - 100));
      await reserveTPM(inputTok + effMax);
      const body = {
        model: GROQ_MODEL, temperature: 0.1,
        max_tokens: effMax,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_MSG },
          { role: "user", content: userContent },
        ],
      };
      if (useReasoningParam) body.reasoning_effort = "low";
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...((await window.storage?.authHeader?.()) || {}) },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.text();
        if (useReasoningParam && e.includes("reasoning_effort")) { useReasoningParam = false; i--; continue; }
        if (res.status === 400 && /json_validate_failed/i.test(e)) throw new AIError("json_output", 0, e);
        if (res.status === 429) {
          const ra = parseFloat(res.headers.get("retry-after")) || parseRetryHint(e) || 60;
          // Daily quota (TPD): waiting inside the request would look like a hang and can take hours. Fail fast, tell the user.
          if (/tokens per day|\(TPD\)/i.test(e)) throw new AIError("daily", Math.ceil(parseRetryHint(e) || ra), e);
          if (rateWaits < 3) {
            rateWaits++;
            const total = Math.ceil(ra + 2);
            for (let left = total; left > 0; left--) { aiNotify({ kind: "wait", sec: left }); await new Promise((r) => setTimeout(r, 1000)); }
            aiNotify(null);
            i--; continue; // rate wait doesn't burn a retry
          }
          throw new AIError("minute", Math.ceil(ra), e);
        }
        throw new AIError("http", 0, `Groq ${res.status}: ${e.slice(0, 200)}`);
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "";
      const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
      const start = clean.indexOf("{"); const end = clean.lastIndexOf("}");
      if (start === -1 || end === -1) throw new Error("no json in response");
      return JSON.parse(clean.slice(start, end + 1));
    } catch (e) {
      console.error("Groq call error:", e);
      aiNotify(null);
      if (e.message?.includes("exceeds safe limit")) throw e;
      if (e instanceof AIError && (e.kind === "daily" || e.kind === "minute" || e.kind === "json_output")) throw e; // retrying the same input cannot help
      if (i === maxRetries) throw e;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const Icon = ({ name, size = 16, stroke = 2, color = "currentColor", className }) => {
  const paths = {
    book: <><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z" /><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H19" /></>,
    chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
    scale: <><path d="M12 3v18" /><path d="M5 7h14" /><path d="M7.5 7 4 14a3.5 3.5 0 0 0 7 0z" /><path d="M16.5 7 13 14a3.5 3.5 0 0 0 7 0z" /></>,
    alert: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>,
    close: <path d="M18 6 6 18M6 6l12 12" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    trash: <><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></>,
    check: <path d="M20 6 9 17l-5-5" />,
    lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
    unlock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></>,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
    spark: <path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3" />,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>,
    arrowLeft: <path d="M19 12H5M12 19l-7-7 7-7" />,
    arrowRight: <path d="M5 12h14M12 5l7 7-7 7" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    brain: <><path d="M12 4a4 4 0 0 0-4 4v1a3 3 0 0 0-1 5.8V17a3 3 0 0 0 5 2V4z" /><path d="M12 4a4 4 0 0 1 4 4v1a3 3 0 0 1 1 5.8V17a3 3 0 0 1-5 2V4z" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    filter: <path d="M3 4h18l-7 9v6l-4 2v-8z" />,
    tag: <><path d="M20 12 12 20l-8-8V4h8z" /><circle cx="8" cy="8" r="1.2" /></>,
  };
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {paths[name] || null}
    </svg>
  );
};

export default function App() {
  const [lang] = useState("en"); // [ZH disabled for now] was: const [lang, setLang] = useState("en");
  const [tab, setTab] = useState("kb");
  const [kbWorking, setKbWorking] = useState(false); // an extraction / save is running inside the Knowledge Base tab
  const [isAdmin, setIsAdmin] = useState(!!(window.storage?.remote && window.storage.user?.isAdmin)); // with sign-in, admin accounts are admins as soon as they log in
  const [config, setConfig] = useState(null);
  const [index, setIndex] = useState([]);
  const [levers, setLevers] = useState([]);
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [gateOpen, setGateOpen] = useState(false);
  const signedUser = window.storage?.remote ? window.storage.user : null; // { id, email, isAdmin } when the shared database is on
  const isGuest = !!(window.storage?.remote && !window.storage.user); // "continue as guest": may only browse the knowledge base and lever records
  const [toast, setToast] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [chatAll, setChatAll] = useState([]); // every message, deleted ones included
  const chatOkRef = useRef(false);
  const chatMsgs = useMemo(() => chatAll.filter(isLive), [chatAll]);
  // The chat panel works on the visible messages; anything it removes (Clear chat) is kept, marked deleted
  const setChatMsgs = useCallback((upd) => setChatAll((all) => {
    const liveNow = all.filter(isLive);
    const next = typeof upd === "function" ? upd(liveNow) : upd;
    const stamped = next.map((m) => (m.id ? m : { ...m, id: uid(), status: "active", at: Date.now() }));
    const keep = new Set(stamped.map((m) => m.id));
    const removed = liveNow.filter((m) => !keep.has(m.id)).map(softDelete);
    return [...all.filter((m) => !isLive(m)), ...removed, ...stamped];
  }), []);
  const [adminLocked, setAdminLocked] = useState(false);
  const [palette, setPalette] = useState(false);
  const [paletteLever, setPaletteLever] = useState(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const t = useMemo(() => {
    setOtherCatConfig(config?.otherCatOverrides, config?.customOtherCats);
    setLeverOverrides(config?.leverOverrides, config?.customLevers); // the lever definitions (built-in edits + custom levers) reach the extraction prompt and heading matcher
    const renamed = Object.fromEntries(Object.entries(config?.leverOverrides || {}).filter(([id, o]) => (BUILTIN_LEVER_DEFAULTS[id] || id === "others") && o && String(o.name || "").trim()).map(([id, o]) => [id, String(o.name).trim()]));
    return {
      ...T[lang],
      levers: {
        ...T[lang].levers,
        ...renamed,
        ...Object.fromEntries((config?.customLevers || []).map((lever) => [lever.id, lever.name])),
      },
      otherCats: {
        ...T[lang].otherCats,
        ...Object.fromEntries(Object.entries(config?.otherCatOverrides || {}).filter(([, o]) => o && String(o.name || "").trim()).map(([id, o]) => [id, String(o.name).trim()])),
        ...Object.fromEntries((config?.customOtherCats || []).map((c) => [c.id, c.name])),
      },
    };
  }, [lang, config]);
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2600); };
  // The bottom-left button. With sign-in it is Log in (guest) / Log out (signed in); the SERVER decides who is an admin, so there is no
  // passcode. Without the shared database it stays "Unlock admin" with the passcode.
  const authLabel = window.storage?.remote ? (isGuest ? "Log in" : "Log out") : (isAdmin ? t.lockAdmin : t.unlockAdmin);
  const authBtnClick = () => {
    if (exitBlocked) { flash(t.exitBlocked); return; }
    if (window.storage?.remote) { if (isGuest) window.dispatchEvent(new Event("yyc-show-login")); else window.storage.signOut(); return; }
    if (isAdmin) setIsAdmin(false); else setGateOpen(true);
  };
  const exitBlocked = isAdmin && (adminLocked || confirm !== null || previewDoc !== null);

  useEffect(() => {
    (async () => {
      try {
        // Paint from the copy kept in this browser at once (shared database only), then replace it with the fresh copy
        const kept = window.storage?.remote ? window.db.peek() : null;
        if (kept) { setConfig(kept.config || {}); setIndex(kept.index); setLevers(kept.records); setReady(true); }
        // config, documents and lever records arrive in ONE request (it was usually already prefetched while the sign-in screen showed)
        const lib = await window.db.loadLibrary();
        setConfig(lib.config);
        setIndex(lib.index);
        setLevers(lib.records);
        /* [ZH disabled for now — English only] restore saved UI language
        const savedLang = await sget("ui:lang", false);
        if (savedLang) setLang(savedLang);
        */
        try { // the chat must not stop the library from loading, and is only saved back once it has been read successfully
          if (window.storage?.remote && !window.storage.user) throw new Error("guest: no chat"); // guests have no chat history
          const savedChat = await window.db.chatLoad();
          if (Array.isArray(savedChat) && savedChat.length) setChatAll(savedChat.map((m) => (m.id ? m : { ...m, id: uid(), status: "active" })));
          chatOkRef.current = true;
        } catch { chatOkRef.current = false; }
        setReady(true);
      } catch { setLoadErr(true); }
    })();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { setPreviewDoc(null); setGateOpen(false); setConfirm(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!ready || !chatOkRef.current) return;
    window.db.chatSave(chatAll).catch(() => { });
  }, [chatAll, ready]);

  // [ZH disabled for now — English only] language switcher handler
  // const switchLang = (l) => { setLang(l); sset("ui:lang", l, false).catch(() => { }); };

  const openPreview = useCallback(async (docId, targetSection, targetRecordId) => {
    const doc = await window.db.getDocument(docId);
    if (doc) setPreviewDoc({ doc, targetSection: targetSection || null, targetRecordId: targetRecordId || null });
  }, []);

  const refreshKB = async () => {
    const kb = await window.db.loadKB();
    setIndex(kb.index);
    setLevers(kb.records);
  };

  const navItems = [
    { key: "kb", icon: "book", label: t.tabs.kb },
    ...(isGuest ? [] : [{ key: "chat", icon: "chat", label: t.tabs.chat }]), // guests cannot use Ask the Brain
    { key: "explorer", icon: "scale", label: t.tabs.explorer },
    ...(isAdmin ? [{ key: "gap", icon: "alert", label: t.tabs.gap }] : []),
  ];

  if (loadErr) {
    return (
      <div style={{ background: P.paper, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: P.ink, fontFamily: fontStack, padding: 24, textAlign: "center" }}>
        <div>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: P.crimsonSoft, color: P.crimson, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Icon name="alert" size={26} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{T.en.loadErr}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="yyc-root" style={{ fontFamily: fontStack }}>
      <GlobalStyles />
      <div className="yyc-brandbar" />

      <div className="yyc-shell">
        <aside className="yyc-sidebar">
          <div className="yyc-brand">
            <div className="yyc-brand-mark"><img src="/logo.png" alt="YYC Logo" /></div>
            <div className="yyc-brand-text">
              <div className="yyc-brand-name">{t.appTitle}</div>
              <div className="yyc-brand-sub">{t.appSub}</div>
            </div>
          </div>

          <nav className="yyc-nav">
            <div className="yyc-nav-label">{t.workspace}</div>
            {navItems.map((item) => {
              const active = tab === item.key;
              return (
                <button key={item.key} className={`yyc-nav-item ${active ? "is-active" : ""}`} onClick={() => setTab(item.key)}>
                  <Icon name={item.icon} size={16} /><span>{item.label}</span>{item.key === "kb" && kbWorking && <span className="yyc-spin" title="Extracting in the background…" style={{ marginLeft: "auto", width: 11, height: 11, borderRadius: "50%", border: "2px solid rgba(128,0,0,.25)", borderTopColor: P.maroon, display: "inline-block", flexShrink: 0 }} />}
                </button>
              );
            })}
          </nav>

          <div className="yyc-sidebar-foot">
            {/* [ZH disabled for now — English only] language switcher
            <div className="yyc-lang">
              {["en", "zh"].map((l) => (
                <button key={l} className={`yyc-lang-btn ${lang === l ? "is-active" : ""}`} onClick={() => switchLang(l)}>
                  {l === "en" ? "EN" : "中文"}
                </button>
              ))}
            </div>
            */}
            <button
              className={`yyc-admin-btn ${isAdmin ? "is-on" : ""}`}
              disabled={exitBlocked}
              title={exitBlocked ? t.exitBlocked : authLabel}
              onClick={authBtnClick}
              style={exitBlocked ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            >
              <Icon name={window.storage?.remote ? (isGuest ? "lock" : "unlock") : (isAdmin ? "unlock" : "lock")} size={13} />
              {authLabel}
            </button>
            {window.storage?.remote && (
              <div style={{ fontSize: 12, color: P.sub, margin: "8px 2px 0", lineHeight: 1.5, wordBreak: "break-all" }}>
                {signedUser ? <>{signedUser.email}{signedUser.isAdmin ? " · admin" : ""}</> : "Guest · browse only"}
              </div>
            )}
            <div className="yyc-foot-note">{t.sharedNote}</div>
          </div>
        </aside>

        <main className="yyc-main">
          <header className="yyc-topbar">
            <div className="yyc-brand">
              <div className="yyc-brand-mark"><img src="/logo.png" alt="YYC Logo" /></div>
              <div className="yyc-brand-text">
                <div className="yyc-brand-name">{t.appTitle}</div>
                <div className="yyc-brand-sub">{t.appSub}</div>
              </div>
            </div>
            <div className="yyc-topbar-actions">
              {/* [ZH disabled for now — English only] language switcher
              <div className="yyc-lang">
                {["en", "zh"].map((l) => (
                  <button key={l} className={`yyc-lang-btn ${lang === l ? "is-active" : ""}`} onClick={() => switchLang(l)}>
                    {l === "en" ? "EN" : "中"}
                  </button>
                ))}
              </div>
              */}
              <button
                className={`yyc-admin-btn ${isAdmin ? "is-on" : ""}`}
                disabled={exitBlocked}
                title={exitBlocked ? t.exitBlocked : authLabel}
                onClick={authBtnClick}
                style={exitBlocked ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
              >
                <Icon name={window.storage?.remote ? (isGuest ? "lock" : "unlock") : (isAdmin ? "unlock" : "lock")} size={13} />
                {window.storage?.remote ? <span style={{ marginLeft: 6 }}>{authLabel}</span> : null}
              </button>
            </div>
          </header>

          <div className="yyc-content">{/* no key={tab}: re-keying rebuilt every panel on each tab change and threw away a running extraction */}
            {!ready ? (
              <div style={{ color: P.sub, padding: 40 }}>…</div>
            ) : (
              <>
                {/* Always mounted, only hidden: switching tabs must not discard a running extraction or an unsaved review */}
                <div className="yyc-fade" style={{ display: tab === "kb" ? "block" : "none" }}>
                  <KnowledgePanel
                    onWorking={setKbWorking}
                    t={t} lang={lang} isAdmin={isAdmin} index={index} levers={levers}
                    refreshKB={refreshKB} openPreview={openPreview} flash={flash}
                    config={config} setConfig={setConfig} setConfirm={setConfirm}
                    setAdminLocked={setAdminLocked}
                    paletteLever={paletteLever} clearPaletteLever={() => setPaletteLever(null)}
                  />
                </div>
                {tab !== "kb" && (
                  <div className="yyc-fade" key={tab}>
                  {tab === "chat" && (
                    <ChatPanel
                      t={t}
                      lang={lang}
                      index={index}
                      levers={levers}
                      openPreview={openPreview}
                      msgs={chatMsgs}
                      setMsgs={setChatMsgs}
                    />
                  )}
                  {tab === "explorer" && (
                    <ExplorerPanel t={t} lang={lang} levers={levers} index={index} openPreview={openPreview} isAdmin={isAdmin} config={config} setConfig={setConfig} setConfirm={setConfirm} setAdminLocked={setAdminLocked} flash={flash} refreshKB={refreshKB} />
                  )}
                  {tab === "gap" && isAdmin && <GapPanel t={t} flash={flash} setConfirm={setConfirm} />}
                  </div>
                )}
              </>
            )}
          </div>

          <nav className="yyc-botnav">
            {navItems.map((item) => {
              const active = tab === item.key;
              return (
                <button key={item.key} className={`yyc-botnav-item ${active ? "is-active" : ""}`} onClick={() => setTab(item.key)}>
                  <Icon name={item.icon} size={18} /><span>{item.label}</span>{item.key === "kb" && kbWorking && <span className="yyc-spin" title="Extracting in the background…" style={{ marginLeft: 4, width: 11, height: 11, borderRadius: "50%", border: "2px solid rgba(128,0,0,.25)", borderTopColor: P.maroon, display: "inline-block", flexShrink: 0 }} />}
                </button>
              );
            })}
          </nav>
        </main>
      </div>

      {previewDoc && <PreviewModal t={t} lang={lang} data={previewDoc} levers={levers} index={index} onClose={() => setPreviewDoc(null)} />}
      {gateOpen && <AdminGate t={t} config={config} onOk={() => { setIsAdmin(true); setGateOpen(false); }} onClose={() => setGateOpen(false)} />}
      {palette && (
        <CommandPalette
          t={t} index={index} isAdmin={isAdmin} isGuest={isGuest}
          onClose={() => setPalette(false)}
          onTab={(id) => setTab(id)}
          onDoc={(id) => openPreview(id)}
          onLever={(id) => { setTab("kb"); setPaletteLever(id); }}
        />
      )}
      {confirm && <ConfirmModal message={confirm.message} onCancel={() => setConfirm(null)} onConfirm={() => { confirm.onConfirm(); setConfirm(null); }} />}
      {toast && (<div className="yyc-toast"><div className="yyc-toast-dot" />{toast}</div>)}
    </div>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body::-webkit-scrollbar { display: none; }
      body { background: ${P.paper}; }
      .yyc-root { background: ${P.paper}; color: ${P.ink}; min-height: 100vh; }
      .yyc-brandbar { height: 3px; background: linear-gradient(90deg, ${P.crimson} 0%, ${P.maroon} 60%, ${P.gold} 100%); position: sticky; top: 0; z-index: 50; }
      .yyc-shell { display: flex; min-height: calc(100vh - 3px); max-width: 1560px; margin: 0 auto; }
      @media (min-width: 1580px) { .yyc-shell { border-left: 1px solid ${P.line}; border-right: 1px solid ${P.line}; } }
      .yyc-sidebar { width: 248px; flex-shrink: 0; background: ${P.card}; border-right: 1px solid ${P.line}; display: none; flex-direction: column; padding: 22px 14px 16px; position: sticky; top: 3px; height: calc(100vh - 3px); overflow-y: auto; }
      @media (min-width: 900px) { .yyc-sidebar { display: flex; } }
      .yyc-brand { display: flex; align-items: center; gap: 5px; padding: 0 8px 22px; }
      .yyc-brand-mark { background: transparent; padding: 0; display: flex; align-items: center; justify-content: center; }
      .yyc-brand-mark img { width: 60px; height: 50px; object-fit: contain; display: block; }
      .yyc-brand-text { min-width: 0; }
      .yyc-brand-name { font-size: 14px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .yyc-brand-sub { color: ${P.faint}; font-size: 11px; line-height: 1.3; margin-top: 1px; }
      .yyc-nav { display: flex; flex-direction: column; gap: 3px; flex: 1; }
      .yyc-nav-label { font-size: 10.5px; font-weight: 700; color: ${P.faint}; text-transform: uppercase; letter-spacing: 0.09em; padding: 0 10px 8px; }
      .yyc-nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 9px; background: transparent; border: none; cursor: pointer; font-size: 13.5px; font-weight: 600; color: ${P.sub}; text-align: left; font-family: inherit; transition: background .15s, color .15s; position: relative; }
      .yyc-nav-item:hover { background: ${P.wash}; color: ${P.ink}; }
      .yyc-nav-item.is-active { background: ${P.crimsonSoft}; color: ${P.crimson}; font-weight: 700; }
      .yyc-nav-item.is-active::before { content: ""; position: absolute; left: -14px; top: 8px; bottom: 8px; width: 3px; background: ${P.crimson}; border-radius: 0 3px 3px 0; }
      .yyc-sidebar-foot { padding-top: 16px; border-top: 1px solid ${P.line}; margin-top: 16px; display: flex; flex-direction: column; gap: 8px; }
      .yyc-lang { display: flex; border: 1px solid ${P.lineDark}; border-radius: 8px; overflow: hidden; background: ${P.card}; }
      .yyc-lang-btn { flex: 1; padding: 6px 8px; font-size: 12px; font-weight: 650; background: transparent; color: ${P.sub}; border: none; cursor: pointer; font-family: inherit; }
      .yyc-lang-btn:hover { background: ${P.wash}; }
      .yyc-lang-btn.is-active { background: ${P.ink}; color: #fff; }
      .yyc-admin-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; border-radius: 8px; border: 1px solid ${P.lineDark}; background: ${P.card}; color: ${P.sub}; font-size: 12.5px; font-weight: 650; cursor: pointer; font-family: inherit; }
      .yyc-admin-btn:hover { background: ${P.wash}; border-color: ${P.ink}; color: ${P.ink}; }
      .yyc-admin-btn.is-on { background: ${P.maroon}; border-color: ${P.maroon}; color: #fff; }
      .yyc-foot-note { font-size: 10.5px; color: ${P.faint}; line-height: 1.5; padding: 0 4px; }
      .yyc-main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: ${P.paper}; }
      .yyc-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; background: rgba(255,255,255,0.9); backdrop-filter: blur(10px); border-bottom: 1px solid ${P.line}; position: sticky; top: 3px; z-index: 30; }
      @media (min-width: 900px) { .yyc-topbar { display: none; } }
      .yyc-topbar .yyc-brand { padding: 0; }
      .yyc-topbar-actions { display: flex; align-items: center; gap: 8px; }
      .yyc-topbar-actions .yyc-lang { width: 84px; }
      .yyc-content { flex: 1; padding: 26px 28px; max-width: 1360px; width: 100%; margin: 0 auto; }
      .yyc-fade { animation: yycFadeUp .3s ease-out; } /* replays whenever a hidden panel is shown again (display none → block) */
      @media (min-width: 900px) { .yyc-content { padding: 30px 36px; } }
      @media (max-width: 899px) { .yyc-content { padding: 18px 16px 90px; } }
      @keyframes yycFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes yycPopIn { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
      @keyframes yycFade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes yycSpin { to { transform: rotate(360deg); } }
      @keyframes yycToastIn { from { opacity: 0; transform: translate(-50%, 16px); } to { opacity: 1; transform: translate(-50%, 0); } }
      @keyframes yycDot { 0%, 80%, 100% { opacity: .3; transform: scale(.8); } 40% { opacity: 1; transform: scale(1); } }
      .yyc-botnav { display: flex; position: fixed; left: 0; right: 0; bottom: 0; background: rgba(255,255,255,0.96); backdrop-filter: blur(12px); border-top: 1px solid ${P.line}; padding: 6px 4px 8px; z-index: 40; }
      @media (min-width: 900px) { .yyc-botnav { display: none; } }
      .yyc-botnav-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 4px; background: transparent; border: none; cursor: pointer; font-family: inherit; font-size: 10.5px; font-weight: 600; color: ${P.faint}; }
      .yyc-botnav-item.is-active { color: ${P.crimson}; }
      .yyc-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
      .yyc-section-title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; margin: 0; color: #270303}
      .yyc-section-sub { color: ${P.sub}; font-size: 13.5px; margin-top: 6px; line-height: 1.5; max-width: 640px; }
      .yyc-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px; }
      .yyc-stat { position: relative; background: ${P.card}; border: 1px solid ${P.line}; border-radius: 14px; padding: 16px 18px; box-shadow: ${P.s1}; overflow: hidden; }
      .yyc-stat::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: ${P.crimson}; }
      .yyc-stat.is-gold::before { background: ${P.gold}; }
      .yyc-stat.is-green::before { background: ${P.green}; }
      .yyc-stat-inner { display: flex; align-items: center; gap: 12px; min-height: 44px; }
      .yyc-stat.is-clickable { cursor: pointer; transition: box-shadow .15s, transform .15s; }
      .yyc-stat.is-clickable:hover, .yyc-stat.is-clickable:focus-visible { box-shadow: ${P.s2}; transform: translateY(-1px); outline: none; }
      .yyc-stat-icon { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .yyc-stat-icon.is-red { background: ${P.crimsonSoft}; color: ${P.crimson}; }
      .yyc-stat-icon.is-gold { background: ${P.goldSoft}; color: ${P.goldDark}; }
      .yyc-stat-icon.is-green { background: ${P.greenSoft}; color: ${P.green}; }
      .yyc-stat-label { font-size: 10px; color: ${P.sub}; font-weight: 650; letter-spacing: .00em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .yyc-stat-num { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1; margin-top: 3px; }
      .yyc-toolbar { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
      .yyc-search { position: relative; flex: 1; min-width: 220px; max-width: 380px; }
      .yyc-search input { padding-left: 38px !important; }
      .yyc-search-icon { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: ${P.faint}; pointer-events: none; }
      .yyc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
      .yyc-doc { background: ${P.card}; border: 1px solid ${P.line}; border-radius: 14px; padding: 18px; cursor: pointer; box-shadow: ${P.s1}; display: flex; flex-direction: column; gap: 12px; transition: box-shadow .2s, transform .2s, border-color .2s; }
      .yyc-doc:hover { box-shadow: ${P.s3}; transform: translateY(-2px); border-color: ${P.lineDark}; }
      .yyc-doc:focus-visible { outline: none; box-shadow: ${P.focus}; border-color: ${P.crimson}; }
      .yyc-doc:focus-within .yyc-doc-actions { opacity: 1; }
      .yyc-doc-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .yyc-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 999px; text-wrap: nowrap; }
      .yyc-doc-title { font-size: 15.5px; font-weight: 750; line-height: 1.35; color: ${P.ink}; }
      .yyc-doc-sig { font-size: 12.5px; color: ${P.sub}; line-height: 1.55; }
      .yyc-doc-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 10px; border-top: 1px solid ${P.line}; }
      .yyc-lever-pill {
        display: inline-block;
        padding: 3px 10px;
        font-size: 11px;
        font-weight: 700;
        border-radius: 999px;
        background: ${P.goldSoft};
        color: ${P.goldDark};
        border: 1px solid rgba(184,134,11,0.25);
        max-width: 100%;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
        line-height: 1.35;
        text-align: center;
        vertical-align: middle;
      }
      .yyc-lever-record-head .yyc-lever-pill,
      .yyc-lever-picker-item .yyc-lever-pill {
        flex: 0 1 auto;
        min-width: 0;
      }
      .yyc-lever-pill.is-empty { background: transparent; color: ${P.faint}; border: 1px dashed ${P.lineDark}; }
      .yyc-doc-actions { display: flex; gap: 6px; opacity: 0; transition: opacity .15s; }
      .yyc-doc:hover .yyc-doc-actions { opacity: 1; }
      .yyc-lever-group-head .yyc-doc-actions { opacity: 1; }
      @media (max-width: 899px) { .yyc-doc-actions { opacity: 1; } }
      .yyc-icon-btn { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 7px; border: 1px solid ${P.lineDark}; background: ${P.card}; color: ${P.sub}; cursor: pointer; }
      .yyc-icon-btn:hover { background: ${P.wash}; border-color: ${P.ink}; color: ${P.ink}; }
      .yyc-icon-btn.is-danger { border-color: rgba(180,35,24,0.35); color: ${P.red}; }
      .yyc-icon-btn.is-danger:hover { background: ${P.redSoft}; border-color: ${P.red}; }
      .yyc-empty { background: ${P.card}; border: 1px dashed ${P.lineDark}; border-radius: 14px; padding: 56px 32px; text-align: center; color: ${P.sub}; font-size: 13.5px; line-height: 1.6; }
      .yyc-empty-icon { width: 52px; height: 52px; border-radius: 14px; background: ${P.wash}; color: ${P.faint}; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; }
      .yyc-chip-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
      .yyc-chip-row-label { font-size: 11px; font-weight: 700; color: ${P.faint}; text-transform: uppercase; letter-spacing: .06em; margin-right: 4px; }
      .yyc-lever-chip { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; font-size: 12px; font-weight: 650; border-radius: 999px; border: 1px solid ${P.lineDark}; background: ${P.card}; color: ${P.sub}; cursor: pointer; font-family: inherit; transition: all .15s; }
      .yyc-lever-chip:hover:not(:disabled) { background: ${P.wash}; border-color: ${P.ink}; color: ${P.ink}; }
      .yyc-lever-chip.is-active { background: ${P.crimsonSoft}; border-color: ${P.crimson}; color: ${P.crimson}; }
      .yyc-lever-chip:disabled { opacity: 0.4; cursor: default; }
      .yyc-lever-chip-count { font-size: 10.5px; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: ${P.wash}; color: ${P.sub}; }
      .yyc-lever-chip.is-active .yyc-lever-chip-count { background: ${P.crimson}; color: #fff; }
      .yyc-filter-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      .yyc-filter-select { display: inline-flex; align-items: center; gap: 6px; border: 1px solid ${P.lineDark}; background: ${P.card}; color: ${P.ink}; padding: 8px 12px; border-radius: 9px; font-size: 12.5px; font-family: inherit; font-weight: 600; cursor: pointer; min-width: 150px; }
      .yyc-filter-select:focus { outline: none; border-color: ${P.crimson}; box-shadow: ${P.focus}; }
      .yyc-lever-group { margin-bottom: 24px; }
      .yyc-lever-group-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid ${P.line}; }
      .yyc-lever-group-title { font-size: 14px; font-weight: 750; color: ${P.ink}; }
      .yyc-lever-group-count { font-size: 11.5px; color: ${P.faint}; font-weight: 650; }
      .yyc-lever-record { background: ${P.card}; border: 1px solid ${P.line}; border-radius: 12px; padding: 16px 18px; cursor: pointer; box-shadow: ${P.s1}; transition: box-shadow .2s, border-color .2s, transform .15s; display: flex; flex-direction: column; gap: 9px; outline: none; }
      .yyc-lever-record:hover { box-shadow: ${P.s2}; border-color: ${P.gold}; transform: translateY(-1px); }
      .yyc-lever-record:focus-visible { box-shadow: ${P.focus}; border-color: ${P.crimson}; }
      .yyc-lever-record-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      .yyc-lever-record-doc { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 650; color: ${P.sub}; }
      .yyc-lever-record-claim { font-size: 13.5px; line-height: 1.6; color: ${P.ink}; }
      .yyc-lever-record-quote { font-size: 12.5px; color: ${P.sub}; font-style: italic; line-height: 1.55; padding: 8px 12px; background: ${P.wash}; border-radius: 8px; border-left: 3px solid ${P.lineDark}; }
      .yyc-lever-record-meta { font-size: 11px; color: ${P.faint}; font-weight: 600; }
      .yyc-lever-record-hint { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: ${P.faint}; font-weight: 650; }
      .yyc-lever-record-chevron { transition: transform .15s, color .15s; }
      .yyc-lever-record:hover .yyc-lever-record-chevron { transform: translateX(2px); color: ${P.gold}; }
      .yyc-lever-records-stack { display: grid; gap: 10px; }
      .yyc-lever-picker-list { display: grid; gap: 6px; margin-top: 4px; }
      .yyc-lever-picker-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 9px; border: 1px solid ${P.line}; background: ${P.card}; cursor: pointer; font-family: inherit; transition: all .15s; text-align: left; }
      .yyc-lever-picker-item:hover:not(:disabled) { border-color: ${P.gold}; background: ${P.goldSoft}; transform: translateX(2px); }
      .yyc-lever-picker-item.is-active { border-color: ${P.crimson}; background: ${P.crimsonSoft}; }
      .yyc-lever-picker-item:disabled { opacity: .4; cursor: not-allowed; }
      .yyc-lever-picker-count { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: ${P.wash}; color: ${P.sub}; }
      .yyc-lever-picker-item.is-active .yyc-lever-picker-count { background: ${P.crimson}; color: #fff; }
      .yyc-lever-picker-foot { display: flex; gap: 8px; justify-content: space-between; margin-top: 16px; padding-top: 14px; border-top: 1px solid ${P.line}; }
      .yyc-chat-wrap { background: ${P.card}; border: 1px solid ${P.line}; border-radius: 16px; box-shadow: ${P.s1}; display: flex; flex-direction: column; height: calc(100vh - 160px); min-height: 440px; max-height: 720px; overflow: hidden; }
      @media (max-width: 899px) { .yyc-chat-wrap { height: auto; min-height: 500px; max-height: none; } }
      .yyc-chat-scroll { flex: 1; overflow-y: auto; padding: 22px; display: flex; flex-direction: column; gap: 18px; scroll-behavior: smooth; }
      .yyc-msg-row { display: flex; gap: 10px; align-items: flex-start; }
      .yyc-msg-row.is-user { justify-content: flex-end; }
      .yyc-avatar { width: 28px; height: 28px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 10.5px; font-weight: 800; flex-shrink: 0; }
      .yyc-avatar.is-ai { background: ${P.maroon}; color: #fff; }
      .yyc-avatar.is-ai.is-refused { background: ${P.wash}; color: ${P.faint}; }
      .yyc-avatar.is-user { background: ${P.wash}; color: ${P.sub}; }
      .yyc-bubble { padding: 12px 16px; font-size: 14px; line-height: 1.6; max-width: 100%; border-radius: 14px; white-space: pre-wrap; word-break: break-word; text-align: left; }
      .yyc-bubble.is-ai { white-space: normal; }
      .yyc-md > :first-child { margin-top: 0; }
      .yyc-md > :last-child { margin-bottom: 0; }
      .yyc-md p { margin: 0 0 8px; }
      .yyc-md ul, .yyc-md ol { margin: 4px 0 8px; padding-left: 22px; }
      .yyc-md li { margin-bottom: 4px; }
      .yyc-md-h { font-weight: 750; margin: 10px 0 4px; }
      .yyc-bubble.is-user { background: linear-gradient(135deg, ${P.crimson}, ${P.maroon}); color: #fff; border-radius: 16px 4px 16px 16px; box-shadow: 0 2px 8px rgba(154,0,0,0.18); }
      .yyc-bubble.is-ai { background: ${P.card}; color: ${P.ink}; border: 1px solid ${P.line}; border-left: 3px solid ${P.crimson}; border-radius: 4px 16px 16px 16px; box-shadow: ${P.s2}; }
      .yyc-bubble.is-refused { background: ${P.wash}; color: ${P.sub}; border: 1px solid ${P.lineDark}; border-left: 3px solid ${P.faint}; font-style: italic; box-shadow: none; }
      .yyc-cites { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; align-items: center; }
      .yyc-why-toggle { display: inline-flex; align-items: center; gap: 5px; background: none; border: none; padding: 2px 0; font-family: inherit; font-size: 11.5px; font-weight: 650; color: ${P.sub}; cursor: pointer; }
      .yyc-why-toggle:hover { color: ${P.crimson}; }
      .yyc-why-panel { margin-top: 6px; border: 1px solid ${P.line}; border-left: 3px solid ${P.gold}; border-radius: 10px; background: ${P.card}; padding: 10px 12px; box-shadow: ${P.s1}; animation: yycFadeUp .2s ease-out; }
      .yyc-why-row { padding: 8px 8px; border-radius: 8px; cursor: pointer; transition: background .15s; }
      .yyc-why-row:hover { background: ${P.wash}; }
      .yyc-why-row + .yyc-why-row { border-top: 1px solid ${P.line}; }
      .yyc-why-row-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .yyc-why-doc { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 700; color: ${P.maroon}; min-width: 0; }
      .yyc-why-pct { font-size: 11px; font-weight: 750; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .yyc-why-passage { font-size: 12.5px; color: ${P.ink}; font-style: italic; line-height: 1.55; margin-top: 4px; }
      .yyc-why-bar { height: 4px; border-radius: 999px; background: ${P.wash}; margin-top: 7px; overflow: hidden; }
      .yyc-why-bar > div { height: 100%; border-radius: 999px; transition: width .3s ease-out; }
      .yyc-why-checked { font-size: 11px; color: ${P.faint}; margin-top: 8px; padding: 6px 8px 0; border-top: 1px dashed ${P.line}; line-height: 1.5; }
      .yyc-why-doclink { background: none; border: none; padding: 0; font-family: inherit; font-size: inherit; font-weight: 700; color: ${P.maroon}; text-decoration: underline; cursor: pointer; }
      .yyc-sugg-chip { display: block; width: 100%; max-width: 420px; text-align: left; padding: 10px 14px; margin-top: 8px; border: 1px solid ${P.lineDark}; background: ${P.card}; color: ${P.ink}; border-radius: 11px; font-family: inherit; font-size: 13px; font-weight: 550; cursor: pointer; transition: all .15s; box-shadow: ${P.s1}; }
      .yyc-sugg-chip:hover { border-color: ${P.crimson}; color: ${P.crimson}; background: ${P.crimsonSoft}; transform: translateY(-1px); }
      .yyc-kbar-overlay { position: fixed; inset: 0; background: rgba(34,29,24,0.4); z-index: 70; display: flex; align-items: flex-start; justify-content: center; padding: 12vh 16px 16px; }
      .yyc-kbar { width: 560px; max-width: 100%; background: ${P.card}; border: 1px solid ${P.lineDark}; border-radius: 14px; box-shadow: ${P.s2}; overflow: hidden; animation: yycFadeUp .15s ease-out; }
      .yyc-kbar-inputrow { display: flex; align-items: center; gap: 10px; padding: 13px 16px; border-bottom: 1px solid ${P.line}; }
      .yyc-kbar-input { flex: 1; border: none; outline: none; background: transparent; font-family: inherit; font-size: 14.5px; color: ${P.ink}; }
      .yyc-kbar-kbd { font-size: 10.5px; font-weight: 700; color: ${P.faint}; border: 1px solid ${P.lineDark}; border-radius: 5px; padding: 2px 6px; }
      .yyc-kbar-list { max-height: 340px; overflow-y: auto; padding: 6px; }
      .yyc-kbar-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: none; border: none; border-left: 3px solid transparent; border-radius: 8px; padding: 9px 10px; font-family: inherit; font-size: 13.5px; font-weight: 600; color: ${P.ink}; cursor: pointer; }
      .yyc-kbar-item.is-active { background: ${P.wash}; border-left-color: ${P.crimson}; }
      .yyc-kbar-badge { flex-shrink: 0; font-size: 10.5px; font-weight: 750; color: ${P.maroon}; background: ${P.goldSoft}; border-radius: 999px; padding: 2px 9px; }
      .yyc-kbar-sub { color: ${P.faint}; font-weight: 500; font-size: 12.5px; }
      .yyc-kbar-empty { padding: 18px; font-size: 13px; color: ${P.faint}; text-align: center; }
      .yyc-mention-pop { position: absolute; bottom: calc(100% + 8px); left: 0; width: min(420px, 100%); background: ${P.card}; border: 1px solid ${P.lineDark}; border-radius: 12px; box-shadow: ${P.s2}; padding: 6px; z-index: 40; animation: yycFadeUp .12s ease-out; }
      .yyc-tag-row { position: absolute; bottom: calc(100% + 4px); right: 0; display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; max-width: 100%; }
      .yyc-tag-chip { display: inline-flex; align-items: center; gap: 5px; background: ${P.goldSoft}; color: ${P.maroon}; border: 1px solid rgba(184,134,11,0.45); border-radius: 999px; padding: 3px 10px; font-size: 11.5px; font-weight: 700; }
      .yyc-tag-chip button { background: none; border: none; color: ${P.maroon}; font-size: 13px; line-height: 1; cursor: pointer; padding: 0; }
      .yyc-cites-label { font-size: 11px; color: ${P.faint}; font-weight: 600; }
      .yyc-cite-btn { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; padding: 5px 11px; border: 1px solid rgba(184,134,11,0.4); background: ${P.goldSoft}; color: ${P.maroon}; cursor: pointer; border-radius: 999px; font-weight: 650; font-family: inherit; transition: all .15s; }
      .yyc-cite-btn:hover { background: #FBE9B8; border-color: ${P.gold}; transform: translateY(-1px); }
      .yyc-typing { display: inline-flex; align-items: center; gap: 4px; padding: 12px 16px; background: ${P.card}; border: 1px solid ${P.line}; border-left: 3px solid ${P.crimson}; border-radius: 4px 16px 16px 16px; box-shadow: ${P.s1}; }
      .yyc-typing span { width: 6px; height: 6px; border-radius: 50%; background: ${P.faint}; animation: yycDot 1.2s infinite; }
      .yyc-typing span:nth-child(2) { animation-delay: .15s; }
      .yyc-typing span:nth-child(3) { animation-delay: .3s; }
      .yyc-chat-input-wrap { border-top: 1px solid ${P.line}; padding: 14px 16px; background: ${P.card}; display: flex; gap: 10px; align-items: center; }
      .yyc-chat-input { flex: 1; border: 1px solid ${P.lineDark}; background: ${P.paper}; padding: 12px 16px; border-radius: 12px; font-size: 13.5px; font-family: inherit; color: ${P.ink}; outline: none; }
      .yyc-chat-input:focus { border-color: ${P.crimson}; background: ${P.card}; box-shadow: ${P.focus}; }
      .yyc-modal-backdrop { position: fixed; inset: 0; background: rgba(26,22,20,0.5); backdrop-filter: blur(4px); z-index: 55; display: flex; align-items: center; justify-content: center; padding: 16px; }
      .yyc-modal {
        background: ${P.paper};
        border-radius: 16px;
        box-shadow: ${P.s3};
        max-width: 100%;
        max-height: 92vh;
        display: flex;
        flex-direction: column;
        overflow: auto;
        animation: yycPopIn .2s ease-out;
      }
      .yyc-modal::-webkit-scrollbar { display: none; }
      .yyc-modal { scrollbar-width: none; -ms-overflow-style: none; }
      .yyc-modal-head { padding: 20px 26px; border-bottom: 2px solid ${P.crimson}; background: ${P.card}; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .yyc-toast { position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%); background: ${P.ink}; color: #fff; padding: 12px 22px; font-size: 13px; font-weight: 600; z-index: 70; border-radius: 11px; box-shadow: ${P.s3}; display: inline-flex; align-items: center; gap: 10px; animation: yycToastIn .28s cubic-bezier(.2,.8,.3,1.2); font-family: inherit; }
      .yyc-toast-dot { width: 6px; height: 6px; border-radius: 50%; background: ${P.green}; box-shadow: 0 0 0 3px rgba(14,124,74,0.25); }
      .yyc-btn-primary { ${Object.entries(btnP(false)).map(([k, v]) => `${k.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${v};`).join(" ")} ; border-radius: 20px; }
      .yyc-btn-primary:hover:not(:disabled) { background: ${P.crimsonDark} !important; box-shadow: 0 3px 10px rgba(154,0,0,0.25) !important; }
      .yyc-btn-primary:active:not(:disabled) { transform: translateY(1px); }
      .yyc-btn-primary:disabled { cursor: default; }
      .yyc-btn-secondary { ${Object.entries(btnG).map(([k, v]) => `${k.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${v};`).join(" ")} ; border-radius: 20px; }
      .yyc-btn-secondary:hover { background: ${P.wash}; border-color: ${P.ink}; color: ${P.ink}; }
      .yyc-input { ${Object.entries(S.input).map(([k, v]) => `${k.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${v};`).join(" ")} ; border-radius: 10px ;}
      .yyc-input:focus { border-color: ${P.crimson}; box-shadow: ${P.focus}; }
      .yyc-edit-record-modal { max-height: calc(100vh - 32px); overflow-y: auto; }
      .yyc-edit-record-field { margin-top: 16px; }
      .yyc-edit-record-textarea { resize: none; min-height: 108px; line-height: 1.55; }
      .yyc-chat-scroll::-webkit-scrollbar, .yyc-content::-webkit-scrollbar, .yyc-sidebar::-webkit-scrollbar { width: 10px; }
      .yyc-chat-scroll::-webkit-scrollbar-thumb, .yyc-content::-webkit-scrollbar-thumb, .yyc-sidebar::-webkit-scrollbar-thumb { background: ${P.lineDark}; border-radius: 999px; border: 3px solid ${P.paper}; }
      .yyc-chat-scroll::-webkit-scrollbar-thumb:hover { background: ${P.faint}; }
      .yyc-spin { animation: yycSpin .8s linear infinite; }
    `}</style>
  );
}

function CommandPalette({ t, index, isAdmin, isGuest, onClose, onTab, onDoc, onLever }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const items = useMemo(() => [
    ...Object.entries(t.tabs)
      .filter(([k]) => (k !== "gap" || isAdmin) && !(k === "chat" && isGuest))
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

  useEffect(() => { setActive(0); }, [q]);

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

function ConfirmModal({ message, onCancel, onConfirm }) {
  return (
    <div className="yyc-modal-backdrop" onClick={onCancel}>
      <div className="yyc-modal" style={{ width: 400, padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 18 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: P.redSoft, color: P.red, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="alert" size={18} />
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.5, paddingTop: 6 }}>{message}</div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="yyc-btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="yyc-btn-primary" style={{ background: P.red }} onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

function AdminGate({ t, config, onOk, onClose }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState(false);
  const tryUnlock = async () => {
    if (window.storage?.remote) { // shared database: the server checks the password and returns an admin session
      let ok = false;
      try { ok = await window.storage.login(pass); } catch { ok = false; }
      if (ok) onOk(); else setErr(true);
    } else if (pass === (config?.adminPass || "12345")) onOk();
    else setErr(true);
  };
  return (
    <div className="yyc-modal-backdrop" onClick={onClose}>
      <div className="yyc-modal" style={{ width: 400, padding: 26 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: P.crimson, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="lock" size={18} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 750 }}>{t.passPrompt}</div>
        </div>
        <input type="password" value={pass} autoFocus
          onChange={(e) => { setPass(e.target.value); setErr(false); }}
          onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
          className="yyc-input"
          style={{ borderColor: err ? P.red : undefined }} />
        {err && <div style={{ color: P.red, fontSize: 12.5, marginTop: 8, fontWeight: 600 }}>{t.passWrong}</div>}
        <div style={{ color: P.faint, fontSize: 12, marginTop: 12, lineHeight: 1.55 }}>{t.passNote}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 22 }}>
          <button className="yyc-btn-secondary" onClick={onClose}>{t.cancel}</button>
          <button className="yyc-btn-primary" onClick={tryUnlock}>{t.unlock}</button>
        </div>
      </div>
    </div>
  );
}

function LeverRecordCard({ record, meta, t, lang, onOpenPicker, isAdmin, onEdit, onDelete }) {
  const isZh = lang === "zh";
  const claim = isZh
    ? (record.claim_zh || record.claim_en)
    : (record.claim_en || record.claim_zh);
  const { main, sub } = parseIndustry(meta?.industry || "", meta);

  return (
    <div
      className="yyc-lever-record"
      role="button"
      tabIndex={0}
      onClick={() => onOpenPicker(record)}
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
      {claim && <div className="yyc-lever-record-claim"><ClaimText text={claim} /></div>}
      <ImpactBox record={record} />


      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="yyc-lever-record-meta" style={{ flex: 1 }}>
          {sub ? `${main} · ${sub}` : main}
          {record.section ? ` · ${record.section}` : ""}
        </div>
        {isAdmin && (
          <div className="yyc-doc-actions" style={{ opacity: 1 }} onClick={(e) => e.stopPropagation()}>
            <button className="yyc-icon-btn" onClick={() => onEdit(record)} title={t.edit}><Icon name="edit" size={13} /></button>
            <button className="yyc-icon-btn is-danger" onClick={() => onDelete(record)} title={t.del}><Icon name="trash" size={13} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

function LeverPickerModal({ t, currentLever, counts, onSelect, onClose, onOpenSource, onClear }) {
  return (
    <div className="yyc-modal-backdrop" onClick={onClose}>
      <div className="yyc-modal" style={{ width: 420, padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 750, letterSpacing: "-0.01em" }}>{t.pickLeverTitle}</div>
            <div style={{ fontSize: 12.5, color: P.sub, marginTop: 4, lineHeight: 1.5 }}>{t.pickLeverHint}</div>
          </div>
          <button className="yyc-icon-btn" onClick={onClose} style={{ width: 30, height: 30 }}>
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

/* ---------- extraction pipeline (shared by single + bulk upload) ---------- */
function capMaterial(text) {
  const BUDGET = 16500; // whole doc is kept and sent in ~5.5k-char chunks (see extractDocument), so each call still fits one 8k-TPM minute
  if (text.length <= BUDGET) return text;
  const m = text.search(/Power Cash Links|Analysis/);
  if (m > 0) {
    const tail = text.slice(m, m + BUDGET);
    const headroom = BUDGET - tail.length;
    const head = headroom > 500 ? text.slice(0, headroom) : "";
    return head + (head ? "\n[\u2026narrative trimmed\u2026]\n" : "") + tail;
  }
  return text.slice(0, BUDGET);
}

/* Split on blank lines so a named strategy's paragraphs stay together. One giant call
   made the model (and its hidden reasoning) run out of output budget and silently drop
   the LAST sections (Talent, Other Strategies, Failed Strategies). Small chunks = every
   part of the doc gets its own full output budget. */
/* A lever heading is a SHORT line with no sentence punctuation that names a lever (Pricing, Volume, "Unique Product
   Differentiation/Position", "Talent Strategy:"…) or an "other strategies" group ("Other Key Strategies For Growth",
   "Strategies Used to Grow MadeGood"). Detected structurally, so new heading wordings in new documents still work. */
function leverHeadingRaw(p) {
  const x = String(p || "").trim().replace(/:$/, "").trim();
  if (!x || x.length > 90 || /\n/.test(x) || /[.!?]$/.test(x)) return null;
  if (MNA_SECTION_RE.test(x)) return x; // M&A section headings may be long ("What <Company> Brings to Acquired Companies")
  const words = wordCount(x);
  // the line must BE a heading phrase, not merely start with a lever word ("Customer pays before fulfilment" is a strategy title, not "Customers")
  const hit = words <= 5 ? [...EXTRA_HEADING_LEVER, ...HEADING_LEVER].find(([re]) => re.test(x)) : null;
  if (hit) {
    const rest = x.slice(x.match(hit[0])[0].length);
    if (/^[\s/&,-]*(and\s+)?(days?|strateg(y|ies)|position(ing)?|growth|levers?)?[\s:]*$/i.test(rest)) return x; // "Receivable Days", "Payable Days", "Talent Strategy"
  }
  if (words <= 8 && /^(other\b[^.]*strateg|strategies\s+(used\s+)?(to|for)\b|key strategies\b|shareholders?\b[^.]*strateg|ownership\b[^.]*strateg|(additional|further|supporting|more)\b[^.]*(strateg|growth))/i.test(x)) return x;
  // a short line that ends with a colon and names strategies/growth is a group heading ("Additional Cash & Growth Strategies:")
  if (words <= 8 && /:\s*$/.test(String(p || "").trim()) && /\b(strateg(y|ies)|growth)\b/i.test(x)) return x;
  return null;
}
// numbering ("4. Acquisition Criteria") is not part of the heading's name
function leverHeadingOf(p) { const h = leverHeadingRaw(p); return h ? h.replace(/^\s*\d+\s*[.)]\s*/, "") : h; }
const KNOWN_HEADING = { test: (p) => !!leverHeadingOf(p) }; // keeps the old .test() call sites working
// A heading-looking line right after a paragraph that ends with ":" is a LIST ITEM of that paragraph ("The two major reasons deals fail are:" → "Valuation"), not a heading.
const isHeadingAt = (arr, i) => !!leverHeadingOf(arr[i]) && !(i > 0 && /:\s*$/.test(String(arr[i - 1] || "").trim()));

/* M&A case studies ("M&A Strategy Summary") are organised by section headings such as "3. Acquisition M&A Appetite",
   "4. Acquisition Criteria", "5. Post-Acquisition Strategy", "6. What <Company> Brings to Acquired Companies".
   Matching is on the WHOLE heading line, never on a keyword somewhere in the text, so an ordinary case study that merely
   mentions an acquisition (Build A Bear's UK acquisition, an "acquisition engine") is NOT treated as an M&A document. */
const MNA_SECTION_RE = /^(?:\d+\s*[.)]?\s*)?(?:(?:acquisition\s+)?m\s*&\s*a\s+(?:appetite|criteria|approach|thesis|strategy(?:\s+summary)?)|acquisition\s+(?:criteria|appetite|approach)|post[- ]?(?:acquisition|merger|deal)\s+(?:strategy|approach|integration|model)|what\s+.{1,50}?\s+brings?\s+to\s+(?:acquired|portfolio|target)\s+(?:compan(?:y|ies)|businesses))\s*:?\s*$/i;
function mnaSectionKind(p) {
  const label = String(p || "").trim().replace(/^\s*\d+\s*[.)]\s*/, "").replace(/[:：]\s*$/, "");
  if (!MNA_SECTION_RE.test(label)) return "";
  if (/criteria/i.test(label)) return "criteria";
  if (/post/i.test(label)) return "post_acquisition";
  if (/brings?\s+to/i.test(label)) return "company_support";
  return "appetite";
}

/* The lever is decided by the HEADING a strategy sits under, not by how the strategy "sounds" (e.g. a USP or brand-value
   strategy listed under "Pricing" is still a price strategy). The model gets this wrong, so code enforces it. */
const HEADING_LEVER = [
  [MNA_SECTION_RE, "acquisition_expansion_valuation"],
  [/^(pricing|price)\b/i, "price"],
  [/^(volume|sales|customers?|demand)\b/i, "volume"],
  [/^(cost of goods sold|cogs|cost of sales|margin)\b/i, "cogs"],
  [/^(overheads?|fixed costs?)\b/i, "overheads"],
  [/^(inventory|stock)\b/i, "inventory_days"],
  [/^(accounts )?(receivables?|collections?)\b|^ar\b/i, "ar_days"],
  [/^(accounts )?payables?\b|^ap\b/i, "ap_days"],
  [/^(talent|people|hiring)\b/i, "talent_strategy"],
  [/^(unique )?(product )?differentiation\b|^unique product\b/i, "product_differentiation"],
  [/^(acquisitions?\s*,?\s*(expansion\s*|\w+\s*)?(&|and)\s*valuation|expansion\s*&\s*valuation|acquisition\s*&\s*expansion|mergers?\s*(and|&)\s*acquisitions?|m\s*&\s*a\s*$|post[- ]merger integration|business combinations?)(?![A-Za-z])/i, "acquisition_expansion_valuation"],
  [/^(other\b|strategies\s+(used\s+)?(to|for)\b|key strategies\b|shareholders?\b[^.]*strateg|ownership\b[^.]*strateg|(additional|further|supporting|more)\b[^.]*(strateg|growth))/i, "others"], // "Other Strategies…", "Strategies Used to Grow X", "Shareholder Strategy"
];
const leverFromHeading = (h) => { const x = String(h || "").trim(); const hit = [...EXTRA_HEADING_LEVER, ...HEADING_LEVER].find(([re]) => re.test(x)); return hit ? hit[1] : null; };
const isTitleLike = (p) => { const t = p.trim(); return t.length <= 80 && !/\n/.test(t) && !/[.!?]$/.test(t); };

function chunkMaterial(text, size = 3800) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = [];
  let curLen = 0;
  let heading = ""; // last lever heading seen so far
  let startHeading = ""; // heading in force when the current chunk began
  let sc = 0; // strategies ("Title: description" paragraphs) in the current chunk — capped so one answer never has to hold a dozen
  let prevP = ""; // previous paragraph (a heading-looking line right after a ":" intro is a list item)
  const isStrat = (q) => TITLE_COLON.test(q) && !/^(actual\s+impacts?|impacts?|power\s+cash\s+link|financial\s+impact|results?|problems?|solutions?)\b/i.test(q);
  const flush = () => {
    // never end a chunk on a heading / strategy title: its description would land in the next chunk without it
    const carry = [];
    while (cur.length > 1 && isTitleLike(cur[cur.length - 1])) carry.unshift(cur.pop());
    const body = cur.join("\n\n");
    chunks.push(chunks.length && startHeading && !KNOWN_HEADING.test(cur[0]) ? `[CONTINUES UNDER HEADING: ${startHeading}]\n\n${body}` : body);
    startHeading = carry.length && KNOWN_HEADING.test(carry[0]) ? "" : heading;
    // heading in force at the carried paragraphs' start
    cur = carry; curLen = carry.join("\n\n").length; sc = 0;
  };
  for (const p of paras) {
    // an "Actual Impact:" / "Power Cash Link:" paragraph belongs to the strategy above it — never start a new chunk on one
    const isLabel = /^(actual\s+impacts?|impacts?|power\s+cash\s+link|financial\s+impact|results?)\b[^:：\n]{0,30}[:：]/i.test(p);
    if (cur.length && !isLabel && (curLen + p.length + 2 > size || (sc >= 6 && isStrat(p)))) flush();
    cur.push(p); curLen += p.length + 2;
    if (isStrat(p)) sc++;
    if (KNOWN_HEADING.test(p) && !/:\s*$/.test(prevP)) heading = leverHeadingOf(p);
    prevP = p;
  }
  if (cur.length) {
    const body = cur.join("\n\n");
    chunks.push(chunks.length && startHeading && !KNOWN_HEADING.test(cur[0]) ? `[CONTINUES UNDER HEADING: ${startHeading}]\n\n${body}` : body);
  }
  // a tiny tail isn't worth its own API call (~1 TPM window); fold it into the previous chunk
  if (chunks.length > 1 && chunks[chunks.length - 1].length < 1200 && chunks[chunks.length - 1].length + chunks[chunks.length - 2].length <= size * 1.15) {
    const tail = chunks.pop();
    chunks[chunks.length - 1] += "\n\n" + tail;
  }
  return chunks;
}

// Split only at existing paragraph/line/sentence boundaries. Slicing retains every
// original character, so retrying a failed JSON response cannot alter source text.
function splitMaterialForRetry(text) {
  const source = String(text || "");
  const midpoint = Math.floor(source.length / 2);
  const boundaryPatterns = [/\n\s*\n/g, /\n/g, /(?<=[.!?])\s+/g];
  for (const pattern of boundaryPatterns) {
    const cuts = [];
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const cut = match.index + match[0].length;
      if (cut > 0 && cut < source.length) {
        const previousPara = source.slice(0, cut).trimEnd().split(/\n\s*\n/).pop() || "";
        const separatesTitleFromEvidence = isTitleLike(previousPara) && !KNOWN_HEADING.test(previousPara);
        if (!separatesTitleFromEvidence) cuts.push(cut);
      }
      if (!match[0].length) pattern.lastIndex++;
    }
    if (!cuts.length) continue;
    const cut = cuts.reduce((best, candidate) => Math.abs(candidate - midpoint) < Math.abs(best - midpoint) ? candidate : best, cuts[0]);
    const left = source.slice(0, cut);
    const right = source.slice(cut);
    if (left.trim() && right.trim()) return [left, right];
  }
  return null;
}

const KEY_STRATEGY_LABEL = /^\s*key strateg/i;
const FIELD_LABEL_SECTION = /^\s*(problem|formula|theory|result|results|outcome|kpis?|fail|lesson|timeline|history|background|chronolog)/i;
const normWs = (s) => String(s || "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

/* The description and the impact must be the document's ORIGINAL words, of any length. The model sometimes condenses or
   rewords them anyway, so after extraction the text is replaced with the run of consecutive source sentences it matches
   best (Jaccard word overlap >= 0.5). No word limit: a 120-word paragraph is kept whole.
   `prefixOnly` = descriptions, which always start at the first sentence of the strategy's paragraph. */
const wordCount = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const sentencesOf = (s) => String(s || "").split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 1);
const tokSet = (s) => new Set(normWs(s).replace(/[^\p{L}\p{N}%$.\s-]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
function snapToSource(modelText, sents, prefixOnly = false) {
  const want = tokSet(modelText);
  if (!want.size || !sents.length) return modelText;
  // a fragment that sits inside one original sentence ("brought both cash and a strong operator") → that whole sentence
  const mn = normWs(modelText);
  const whole = sents.find((x) => normWs(x).includes(mn));
  if (whole) return whole;
  let best = null, bestScore = 0;
  for (let i = 0; i < sents.length; i++) {
    if (prefixOnly && i > 0) break;
    let run = "";
    for (let j = i; j < sents.length && j < i + 14; j++) {
      run = run ? `${run} ${sents[j]}` : sents[j];
      const have = tokSet(run);
      let hit = 0; want.forEach((w) => { if (have.has(w)) hit++; });
      const score = hit / (want.size + have.size - hit); // Jaccard
      if (score > bestScore) { bestScore = score; best = run; }
    }
  }
  return best && bestScore >= 0.5 ? best : modelText;
}
// index of the first original sentence of the run that best matches `modelText` (-1 when nothing matches well)
function windowStart(modelText, sents) {
  const want = tokSet(modelText);
  if (!want.size || !sents.length) return -1;
  const mn = normWs(modelText);
  const whole = sents.findIndex((x) => normWs(x).includes(mn));
  if (whole >= 0) return whole;
  let best = -1, bestScore = 0;
  for (let i = 0; i < sents.length; i++) {
    let run = "";
    for (let j = i; j < sents.length && j < i + 14; j++) {
      run = run ? `${run} ${sents[j]}` : sents[j];
      const have = tokSet(run);
      let hit = 0; want.forEach((w) => { if (have.has(w)) hit++; });
      const score = hit / (want.size + have.size - hit);
      if (score > bestScore) { bestScore = score; best = i; }
    }
  }
  return bestScore >= 0.4 ? best : -1;
}

/* Cut the document down to its Key Strategies part in CODE (the model can't be trusted to ignore a timeline
   once it has read it): start at the "Power Cash" analysis, stop at Failed Strategies / timeline headings.
   The narrative before it is kept as a short background-only header for industry/title detection. */
function scopeMaterial(text) {
  const start = text.search(/Power Cash (Links?|Strategy)|^\s*Analysis\s*$/im);
  if (start <= 0) return { context: "", body: text };
  let body = text.slice(start);
  const end = body.search(/^\s*(Failed Strategies|Problems? Encountered|Problems? (and|&) Solutions?|Lessons? Learn|Financial Milestones|Timeline|Key (Dates|Milestones)|Chronology)|^.{0,40}\bwebsite\s*:/im);
  if (end > 0) body = body.slice(0, end);
  return { context: text.slice(0, start).slice(0, 1500), body };
}

// M&A extraction is deliberately limited in code to the sections the advisor
// wants classified. Summary/recap sections never reach the model as strategy text.
function scopeMnaSections(text) {
  const paras = String(text || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const sectionKey = (p) => mnaSectionKind(p);
  const selected = [];
  let active = false;
  let activeSection = "";
  let activeNumber = null;
  let firstHeading = "";
  for (const para of paras) {
    const target = sectionKey(para);
    if (target) {
      active = true;
      activeSection = target;
      activeNumber = Number(para.match(/^\s*(\d+)\s*[.)]/)?.[1]) || null;
      if (!firstHeading) firstHeading = para;
      selected.push(para);
      continue;
    }
    const isSummary = /^(?:summary\b|conclusion\b|key takeaway\b|catcha.{0,8}m\s*&\s*a\s+model\s+in\s+one\s+line\b)/i.test(para.replace(/^\s*\d+\s*[.)]\s*/, ""));
    if (active && isSummary) { active = false; activeSection = ""; activeNumber = null; continue; }
    const numberedHeading = para.match(/^\s*(\d+)\s*[.)]\s+(.+)$/);
    // Acquisition criteria often contain numbered criteria (1–6); those belong
    // to that section. In the other target sections, a later numbered heading
    // marks the end of the current section unless it is another target above.
    if (active && activeSection !== "criteria" && activeNumber && numberedHeading && Number(numberedHeading[1]) > activeNumber) {
      active = false; activeSection = ""; activeNumber = null;
    }
    if (active) selected.push(para);
  }
  const firstAt = firstHeading ? String(text || "").indexOf(firstHeading) : -1;
  return {
    context: firstAt > 0 ? String(text).slice(0, firstAt).slice(0, 1500) : "",
    body: selected.join("\n\n"),
  };
}

/* Every "Strategy title: description" paragraph in the strategy part, with the lever heading it sits under and the
   Actual Impact / Power Cash Link paragraphs that follow it. Used to verify the model did not skip anything. */
const LABEL_PARA = /^(actual\s+impacts?|impacts?|power\s+cash\s+link|financial\s+impact|results?|problems?|solutions?|notes?|source|key\s+strategy|formula)\b/i;
function findStrategyParas(body) {
  const paras = String(body || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let heading = "";
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (isHeadingAt(paras, i)) { heading = leverHeadingOf(p); continue; }
    const m = p.match(/^([A-Za-z0-9"“‘'][^:\n]{2,299}?):\s+\S/);
    if (!m || LABEL_PARA.test(p) || wordCount(m[1]) > 45 || m[1].split(/[\s-]+/).filter(Boolean).length < 2) continue; // "Buy-and-Build" is a title; a one-word "Roy:" bullet is not
    let full = p;
    for (let j = i + 1; j < paras.length && LABEL_PARA.test(paras[j]); j++) full += "\n\n" + paras[j];
    out.push({ title: m[1].trim(), heading, text: full });
  }
  return out;
}

const TITLE_COLON = /^[A-Za-z0-9"“‘'][^:\n]{2,299}?:\s+\S/;

/* Tidy the strategy part before the model sees it:
   - drops leftover table-template cells ("What Sweetwater Did") that look like titles;
   - rewrites the table layout  [title line] + [description paragraph]  as  "Title: description",
     so every strategy has ONE shape and the model never has to guess where a strategy starts. */
function normalizeParas(body) {
  const raw = String(body || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let curLever = null; // lever of the heading we are currently under
  const shortPlain = (q) => q.length <= 80 && !/\n/.test(q) && !/[.!?:]$/.test(q);
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i], next = raw[i + 1];
    if (isHeadingAt(raw, i)) curLever = leverFromHeading(leverHeadingOf(p));
    if (/^what\b.{0,40}\bdid$/i.test(p)) continue; // leftover table-template cell
    // numbered GROUP heading ("1.Understand the Business Well") directly above "Title: description" paragraphs: not a strategy
    if (out.length && /^\d+\s*[.)]\s*\S/.test(p) && next && TITLE_COLON.test(next) && !/^problem\b/i.test(next)) continue;
    // a description may itself contain a colon ("…three needs at once: parents wanted…"), so a colon in `next` does not disqualify it
    // (a description may lack a final full stop; a paragraph ending in ":" is the intro of a list, not a description)
    const nextIsProse = next && wordCount(next) >= 12 && !/:$/.test(next) && !LABEL_PARA.test(next);
    const shortMnaEvidence = curLever === "acquisition_expansion_valuation" && next && wordCount(next) >= 5 && /[.!?]$/.test(next) && !/:$/.test(next) && !LABEL_PARA.test(next);
    // a real title line has no colon of its own and is at least 2 words ("No discounts", "Timeless designs"); the other guards
    // (heading, label, bullet-run) keep headings and outline bullets out
    const nW = wordCount(p);
    const enoughWords = nW >= 2;
    const titleLine = p.length <= 140 && !/\n/.test(p) && !/[.!?:]$/.test(p) && !TITLE_COLON.test(p) && !LABEL_PARA.test(p) && enoughWords;
    // two short lines in a row are outline bullets (e.g. YETI "Roy 50.5% / Ryan 49.5%" then "Equity was not given for free…"), not title + description
    const prev = out[out.length - 1];
    const afterBullet = prev && ((shortPlain(prev) && !leverHeadingOf(prev)) || /:$/.test(prev)); // also: the line after a list intro ("They settled on:") is a list item
    if (titleLine && (nextIsProse || shortMnaEvidence) && !afterBullet && !leverHeadingOf(p) && !/^(analysis|power cash)/i.test(p)) {
      out.push(`${p.replace(/^\d+\s*[.)]\s*/, "")}: ${next}`);
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}

/* Section + lever come from WHERE the strategy sits in the document (the nearest lever heading above it),
   not from the model's guess. */
function lever_headings_with_pos(paras, normBody) {
  const heads = [];
  let cur = 0;
  for (const p of paras) {
    const h = leverHeadingOf(p);
    if (!h) continue;
    const i = normBody.indexOf(normWs(p), cur);
    if (i < 0) continue;
    heads.push({ pos: i, text: h });
    cur = i + 1;
  }
  return heads;
}

/* Where does this record's strategy sit in the document? Matches on the strategy TITLE (robust even if the model
   condensed the description). If the same title appears under two headings, prefer the occurrence under the heading
   that matches the record's lever. Returns -1 when not found. */
function locateClaim(nBody, claim, heads, modelLever, paraStarts) {
  const nm = normWs(splitClaim(claim).name || claim).slice(0, 80);
  if (!nm) return -1;
  // a strategy title sits at the START of a paragraph; a mention inside another description (e.g. "...a Find-A-Bear
  // identification system…" under Pricing) must not count
  let all = (paraStarts || []).filter((x) => x.n.startsWith(nm)).map((x) => x.pos);
  if (!all.length) for (let i = nBody.indexOf(nm); i >= 0; i = nBody.indexOf(nm, i + 1)) all.push(i);
  if (!all.length) return -1;
  if (all.length === 1) return all[0];
  const headOf = (p) => [...heads].reverse().find((x) => x.pos <= p);
  return all.find((p) => { const h = headOf(p); return h && leverFromHeading(h.text) === modelLever; }) ?? all[0];
}

const mnaTitle = (t) => { const x = String(t || ""); return x ? x.charAt(0).toUpperCase() + x.slice(1) : x; };

/* M&A mode is decided by STRUCTURE: the document must contain at least two of the M&A section headings (or one plus "M&A" in
   its title / first line). The word "acquisition" appearing in the text is not enough. */
function detectMnaDocument(text, title) {
  const paras = String(text || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const kinds = new Set(paras.map((p) => mnaSectionKind(p)).filter(Boolean));
  if (kinds.size >= 2) return true;
  return kinds.size === 1 && /\bm\s*&\s*a\b|mergers?\s*(?:and|&)\s*acquisitions?/i.test(`${title || ""} ${paras[0] || ""}`);
}

/* Give the M&A material one shape before the model sees it: every strategy / criterion becomes ONE paragraph
   "Title: <all of its text>" (sentences, quote lines, list items and bullet fragments stay inside it, one per line), so the model
   never has to guess where a strategy starts and a quote or bullet can never become a record of its own.
   Titles are detected structurally:
   - "Title: text" paragraphs;
   - numbered criteria ("5. Synergy with Existing Platform");
   - a short Title-Case line followed by a prose paragraph ("Buy-and-Build"), or by a long list-intro sentence ("Highly Selective"
     then "The interview describes … approximately:"). Role labels ("Operating Companies" then "Continue to manage:") and list
     items ("Valuation", "People / Culture Fit") are NOT titles.
   A block with no title (e.g. the whole "Post-Acquisition Strategy" section) stays an untitled paragraph for the model to name. */
const MNA_SMALL_WORDS = new Set(["a", "an", "and", "or", "of", "on", "in", "to", "for", "with", "the", "at", "by", "from", "vs", "as", "into", "over"]);
const mnaIsShort = (p) => { const t = String(p || "").trim(); return !!t && !/\n/.test(t) && t.length <= 90 && wordCount(t) <= 12 && !/[.!?;:,]["”’']?$/.test(t); };
const mnaIsIntro = (p) => /:\s*$/.test(String(p || "").trim());
// prose = a real paragraph, not a list item: 8+ words, not a list intro, and either ends like a sentence, contains a sentence break, or is long
const mnaIsProse = (p) => { const t = String(p || "").trim(); return wordCount(t) >= 8 && !/[:;]$/.test(t) && (/[.!?]["”’']?$/.test(t) || /[.!?]\s+[A-Z“"]/.test(t) || wordCount(t) >= 14); };
const mnaTitleCase = (p) => {
  const sig = String(p || "").replace(/^\s*\d+\s*[.)]\s*/, "").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  return sig.length > 0 && sig.every((w) => w.split("-").every((part) => !part || MNA_SMALL_WORDS.has(part.toLowerCase()) || /^[A-Z0-9“"(]/.test(part)));
};
function mnaIsTitleAt(paras, i) {
  const p = paras[i], prev = paras[i - 1], next = paras[i + 1];
  if (!next || !mnaIsShort(p)) return false;
  if (/^\d+\s*[.)]\s*\S/.test(p)) return true; // numbered criterion
  if (!mnaTitleCase(p)) return false;
  if (mnaIsProse(next) && !(prev && mnaIsIntro(prev))) return true;
  if (mnaIsIntro(next) && wordCount(next) >= 6 && !(prev && mnaIsIntro(prev))) return true;
  return false;
}
function structureMnaParas(body) {
  const paras = String(body || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    if (cur.raw) out.push([cur.raw, ...cur.lines].join("\n"));
    else if (cur.title) { if (cur.lines.length) out.push(`${cur.title}: ${cur.lines.join("\n")}`); } // a title with no text under it is not a strategy
    else if (cur.lines.length) out.push(cur.lines.join("\n"));
    cur = null;
  };
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (isHeadingAt(paras, i)) { flush(); out.push(p); continue; }
    if (TITLE_COLON.test(p) && !LABEL_PARA.test(p)) { flush(); cur = { raw: p, lines: [] }; continue; }
    if (mnaIsTitleAt(paras, i)) { flush(); cur = { title: p.replace(/^\s*\d+\s*[.)]\s*/, "").trim(), lines: [] }; continue; }
    if (!cur) cur = { title: "", lines: [] };
    cur.lines.push(p);
  }
  flush();
  return out;
}

/* "Others" records need a category (legal / business model / financing / operations / partnerships / governance). Picking it inside the big
   extraction prompt is unreliable, and a record the code moves to Others (because it sits under an "Other…" heading) arrives with none at all.
   So one small dedicated call files every Others record into exactly ONE category. If that call fails, the category the model gave is kept. */
async function classifyOthers(levers) {
  const at = levers.map((l, i) => (l.lever === "others" ? i : -1)).filter((i) => i >= 0);
  if (!at.length) return levers;
  const items = at.map((i, n) => { const { name, desc } = splitClaim(levers[i].claim_en); return `${n}. ${name || "(untitled)"} — ${String(desc).replace(/\s+/g, " ").slice(0, 380)}`; });
  const prompt = `You classify business strategies for an advisory knowledge base. File EACH strategy below into exactly ONE category, judged by what the strategy is really about.

CATEGORIES:
${otherCatDefs()}

Guidance: money coming in or being kept (debt, investors, equity sold, reinvested profit, cash reserves, conservative profit targets) = financing_capital. Contracts, leases, trademarks, IP, regulation = legal_regulatory_ip. How owners split ownership or roles (avoid 50:50, divide roles clearly) = shareholder_governance. A sales model, positioning, focus or the choice to keep the model going = business_model_execution. Written procedures and how work is organised = operations_process. Use uncategorized only when truly nothing fits.

STRATEGIES:
${items.join("\n")}

Return ONLY JSON: {"items":[{"i":0,"category":"<one category id>"}, ...]} with one entry per strategy.`;
  let res;
  try { res = await askAI(prompt, 300 + 40 * at.length); } catch { return levers; }
  const out = levers.slice();
  (res && Array.isArray(res.items) ? res.items : []).forEach((it) => {
    const i = at[Number(it && it.i)];
    const c = String((it && it.category) || "").trim();
    if (i !== undefined && OTHER_CATS.includes(c)) out[i] = { ...out[i], other_category: c };
  });
  return out;
}

/* Bullet lists. Plain-text extraction loses the list markers, but the .docx HTML still has the real <li> items. A description
   keeps its words untouched; the document's own list items are only moved onto their own "• item" lines. */
const htmlText = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
function listItemsOf(html) {
  const out = [];
  const re = /<li\b[^>]*>((?:(?!<\/?(?:li|ul|ol)\b)[\s\S])*)/gi; // an item's own text, up to a nested list or its end
  let m;
  while ((m = re.exec(String(html || "")))) { const t = htmlText(m[1]); if (t && t.length <= 600) out.push(t); }
  return out;
}
function withBullets(desc, items) {
  const s = String(desc || "").replace(/\s+/g, " ").trim();
  if (!s || !items || !items.length) return desc;
  const marks = [];
  let cursor = 0;
  for (const it of items) {
    const at = s.indexOf(it, cursor);
    if (at < 0) continue;
    const endAt = at + it.length;
    if ((at > 0 && s[at - 1] !== " ") || (endAt < s.length && s[endAt] !== " ")) continue;
    const prev = marks[marks.length - 1];
    const continuesRun = prev && at === prev.end + 1;
    const before = s.slice(0, at).trimEnd();
    // the first item of a list follows its intro ("...are:") or the start; a short word elsewhere is just prose
    if (!continuesRun && at > 0 && !(/:$/.test(before) || (wordCount(it) >= 4 && /[.!?;]$/.test(before)))) continue;
    marks.push({ start: at, end: endAt });
    cursor = endAt;
  }
  if (!marks.length) return desc;
  let res = "", pos = 0, lastBullet = false;
  marks.forEach((m) => {
    const gap = s.slice(pos, m.start).trim();
    if (gap) res += (res ? (lastBullet ? "\n" : " ") : "") + gap;
    res += (res ? "\n" : "") + "• " + s.slice(m.start, m.end);
    pos = m.end; lastBullet = true;
  });
  const rest = s.slice(pos).trim();
  return rest ? `${res}\n${rest}` : res;
}

async function extractDocument(text, title, customLevers = [], html = "") {
  const listItems = listItemsOf(html);
  const isMnaDocument = detectMnaDocument(text, title); // by section headings, never by the word "acquisition" appearing somewhere in the text
  const scoped = isMnaDocument ? scopeMnaSections(text) : scopeMaterial(text);
  const { context, body: rawBody } = scoped;
  const bodyParas = isMnaDocument ? structureMnaParas(rawBody) : normalizeParas(rawBody);
  const body = bodyParas.join("\n\n");
  const chunks = chunkMaterial(capMaterial(body));
  if (context) chunks[0] = `[BACKGROUND ONLY — use just to identify title/industry; extract NOTHING from this block]
${context}
[END BACKGROUND]

` + chunks[0];
  // normalized text of every "Power Cash Link:" paragraph in the document, used to reject a PCL passed off as an impact
  const pclTexts = bodyParas.filter((p) => /^power\s+cash\s+link\s*[:：]/i.test(p)).map((p) => normWs(p.replace(/^power\s+cash\s+link\s*[:：]\s*/i, ""))).filter((t) => t.length > 12);
  let merged = null;
  const seenSec = new Set();
  const seenLev = new Set();
  const ingest = (j) => {
    if (!merged) { merged = { ...j, sections: [], levers: [] }; delete merged.strategy_titles; }
    for (const s of j.sections || []) {
      const key = normWs(s.heading);
      if (!key || seenSec.has(key)) continue;
      seenSec.add(key); merged.sections.push(s);
    }
    for (const l of j.levers || []) {
      // model returns name + description separately; store them as ONE claim ("Name: description") so search/chat/edit keep working
      // the model likes to swap "-" for a non-breaking hyphen (U+2011) and use odd spaces: restore plain characters so text matches the document exactly
      const plain = (x) => String(x || "").split(String.fromCharCode(0x2011)).join("-").split(String.fromCharCode(0xA0)).join(" ").split(String.fromCharCode(0x202F)).join(" ");
      l.strategy_name = plain(l.strategy_name); l.description = plain(l.description); l.impact = plain(l.impact);
      // table/template cells ("What Sweetwater Did", "Differentiation", a lever heading) are never strategies
      {
        const nm0 = String(l.strategy_name || "").trim(), ds0 = String(l.description || "").trim();
        if (/^what\b.{0,40}\bdid$/i.test(nm0) || leverHeadingOf(nm0) || (nm0 && !ds0 && wordCount(nm0) < 5)) continue;
      }
      if (l.strategy_name) {
        const nm = String(l.strategy_name).trim().replace(/[:：]\s*$/, "");
        let ds = String(l.description || "").trim();
        // Remove only a repeated exact title prefix; source matching below restores the original description.
        const escapedName = nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        ds = ds.replace(new RegExp(`^${escapedName}\\s*[:\\uFF1A]\\s*`, "i"), "");
        if (normWs(ds) === normWs(nm)) ds = "";
        l.claim_en = ds ? `${nm}: ${ds}` : nm; // title and description were the same text: keep it once, no dangling colon
        delete l.strategy_name; delete l.description;
      } else if (String(l.description || "").trim() && !String(l.claim_en || "").trim()) {
        // no title returned (untitled strategy or summary card): keep the original-wording text as the claim instead of losing the record
        l.claim_en = String(l.description).trim();
        delete l.strategy_name; delete l.description;
      }
      // no actual impact in the doc → exactly "N/A" (never blank, never a Power Cash Link substitute)
      // a Power Cash Link is never the impact: drop it if the model copied one (with or without the label)
      const pclHit = (x) => { const n = normWs(stripImpactLabel(x)); return !!n && (/^\s*power\s+cash\s+link/i.test(x) || pclTexts.some((t) => t === n || t.includes(n) || n.includes(t))); };
      const imp = pclHit(l.impact) ? "" : stripImpactLabel(l.impact);
      const isNone = (x) => !x || /^(n\/?a|none|nil|not (available|stated|specified)|-+|—)\.?$/i.test(x);
      const snapped = isNone(imp) ? "" : imp; // snapped to the document's own sentences in the final stage
      l.impact = isNone(snapped) ? "N/A" : snapped;
      const key =`${l.lever}|${normWs(l.claim_en).slice(0, 40)}`;
      if (seenLev.has(key)) continue;
      seenLev.add(key); merged.levers.push(l);
    }
  };
  // the model's answers for one piece of material, in order (a piece whose answer is not valid JSON is halved and retried)
  const extractResults = async (material, part, totalParts = chunks.length, depth = 0) => {
    try {
      return [await askAI(buildExtractionPrompt(material, title, part, totalParts, customLevers, isMnaDocument), 3000)];
    } catch (error) {
      if (!(error instanceof AIError) || error.kind !== "json_output") throw error;
      const halves = depth < 7 ? splitMaterialForRetry(material) : null;
      if (!halves) throw new Error("AI could not return valid JSON for this source text. No text was shortened or discarded; split this material into smaller complete paragraphs and try again.");
      return [...(await extractResults(halves[0], part, totalParts, depth + 1)), ...(await extractResults(halves[1], part, totalParts, depth + 1))];
    }
  };
  const extractAndIngest = async (material, part, totalParts = chunks.length) => { for (const r of await extractResults(material, part, totalParts)) ingest(r); };
  const parallel = Math.max(1, Math.min(await keysInUse(), 4, chunks.length));
  if (parallel <= 1) {
    for (let k = 0; k < chunks.length; k++) await extractAndIngest(chunks[k], k + 1, chunks.length);
  } else {
    // several chunks at once (one per key, at most 4); the answers are merged in document order afterwards, exactly as if done one by one
    const answers = new Array(chunks.length);
    let next = 0, failed = false;
    await Promise.all(Array.from({ length: parallel }, async () => {
      while (!failed && next < chunks.length) {
        const k = next++;
        try { answers[k] = await extractResults(chunks[k], k + 1, chunks.length); } catch (e) { failed = true; throw e; }
      }
    }));
    answers.forEach((rs) => rs.forEach(ingest));
  }

  /* COVERAGE GUARANTEE — the model sometimes quietly skips a strategy (esp. ones with only a Power Cash Link and no
     Actual Impact). Find every "Title: description" paragraph in the strategy part of the document; any title without a
     record gets re-sent, alone with its own paragraphs, in ONE recovery call. */
  const have = () => merged.levers.map((l) => normWs(l.claim_en));
  const missing = findStrategyParas(body).filter((p) => {
    const probe = normWs(p.title).slice(0, 25);
    return !have().some((c) => c.includes(probe));
  }).slice(0, 12);
  if (missing.length) {
    const byHeading = new Map();
    missing.forEach((p) => { const h = p.heading || ""; byHeading.set(h, [...(byHeading.get(h) || []), p.text]); });
    const recText = [...byHeading].map(([h, ps]) => `${h ? h + "\n\n" : ""}${ps.join("\n\n")}`).join("\n\n");
    const recoveryPart = chunks.length + 1;
    try {
      await extractAndIngest(recText, recoveryPart, recoveryPart);
    } catch (error) {
      // Preserve the existing single recovery call's failure behavior.
      throw error;
    }
  }
  const src = normWs(text);
  // "Key Strategy" is the field that HOLDS the strategy, so a record filed under it is valid — it just needs a real
  // section name (the case/company heading). Only Result/Formula/Problem/KPI/failed/timeline sections are dropped.
  const firstLine = (text.split(/\r?\n/).find((x) => x.trim()) || "").replace(/^\s*\d+[.)]\s*/, "").trim();
  const caseHeading = firstLine.length <= 120 ? firstLine : (merged.title || title || "");
  const relabel = (h) => (KEY_STRATEGY_LABEL.test(h || "") && caseHeading ? caseHeading : h);
  merged.sections = merged.sections
    .filter((s) => !FIELD_LABEL_SECTION.test(s.heading || ""))
    .map((s) => ({ ...s, heading: relabel(s.heading) }));
  if (merged.levers.some((l) => KEY_STRATEGY_LABEL.test(l.section || "")) && !merged.sections.some((s) => s.heading === caseHeading) && caseHeading) {
    merged.sections.unshift({ heading: caseHeading, summary_en: merged.problem_signature || "", summary_zh: "" });
  }
  const nBody = normWs(body);
  // exact start of every paragraph: search from the END of the previous paragraph, so the word "volume" inside an earlier
  // description can never be mistaken for the "Volume" heading
  const paraStarts = (() => { const out = []; let cur = 0; for (const p of bodyParas) { const n = normWs(p); const i = nBody.indexOf(n, cur); if (i >= 0) { out.push({ pos: i, n, p }); cur = i + n.length; } } return out; })();
  const plainParas = paraStarts.map((x) => x.p);
  const heads = paraStarts.map((x, i) => ({ pos: x.pos, text: isHeadingAt(plainParas, i) ? leverHeadingOf(x.p) : null })).filter((x) => x.text);
  // where is this record's strategy in the document? (M&A: an untitled block falls back to the opening words of its description)
  const posOf = (l) => {
    const pos = locateClaim(nBody, l.claim_en, heads, l.lever, paraStarts);
    if (pos >= 0 || !isMnaDocument) return pos;
    const dk = normWs(splitClaim(l.claim_en).desc).slice(0, 60);
    if (dk.length >= 20) { const ix = nBody.indexOf(dk); if (ix >= 0) return ix; }
    // a paraphrased description: the (non-heading) paragraph that contains most of its words
    const want = tokSet(splitClaim(l.claim_en).desc);
    if (want.size < 5) return -1;
    let best = -1, bestScore = 0;
    paraStarts.forEach((x, i) => {
      if (isHeadingAt(plainParas, i)) return;
      const have = tokSet(x.p);
      let hit = 0; want.forEach((w) => { if (have.has(w)) hit++; });
      const score = hit / want.size;
      if (score > bestScore) { bestScore = score; best = x.pos; }
    });
    return bestScore >= 0.6 ? best : -1;
  };
  const paraIndexAt = (pos) => { let k = -1; for (let q = 0; q < paraStarts.length; q++) { if (paraStarts[q].pos <= pos) k = q; else break; } return k; };
  const regionIndex = (l) => { const pos = posOf(l); if (pos < 0) return -1; return isMnaDocument ? paraIndexAt(pos) : paraStarts.findIndex((x) => x.pos === pos); };
  // the strategy's own paragraph + the label / follow-up paragraphs under it, up to the next strategy or heading
  const regionAt = (k) => {
    if (k < 0) return null;
    const paras = [paraStarts[k].p];
    for (let q = k + 1; q < paraStarts.length; q++) {
      const pq = paraStarts[q].p;
      if (isHeadingAt(plainParas, q) || (TITLE_COLON.test(pq) && !LABEL_PARA.test(pq))) break;
      paras.push(pq);
    }
    return paras;
  };
  // how many records point at the same block: an untitled block the model split into several records must not be copied whole into each
  const regionUse = new Map();
  // an M&A list intro ("Acquisition opportunities may come from:") is dropped later: it must not take a share of its strategy's block
  const isListIntro = (l) => isMnaDocument && /^acquisition opportunities may come from\b/i.test(splitClaim(l.claim_en).name || l.claim_en || "");
  merged.levers.forEach((l) => { if (isListIntro(l)) return; const k = regionIndex(l); if (k >= 0) regionUse.set(k, (regionUse.get(k) || 0) + 1); });
  const descSentsOf = (paras) => {
    const first = paras[0].replace(TITLE_COLON.test(paras[0]) ? /^[^:\n]{2,299}?:\s+/ : /^$/, "");
    return [first, ...paras.slice(1).filter((q) => !LABEL_PARA.test(q) && !/^power\s+cash\s+link/i.test(q))].flatMap((q) => sentencesOf(q));
  };
  // records that share one block: divide the block's sentences between them in document order, so every original sentence
  // belongs to exactly one record (the first record also keeps the block's opening lines)
  const sharedSlices = new Map(); // claim text -> its sentences
  regionUse.forEach((count, k) => {
    if (count < 2) return;
    const sents = descSentsOf(regionAt(k));
    const recs = merged.levers.filter((l) => regionIndex(l) === k && !isListIntro(l)).map((l) => ({ l, st: windowStart(splitClaim(l.claim_en).desc, sents) }));
    if (recs.some((r) => r.st < 0)) return;
    recs.sort((a, b) => a.st - b.st);
    if (new Set(recs.map((r) => r.st)).size !== recs.length) return;
    recs.forEach((r, i) => sharedSlices.set(r.l.claim_en, sents.slice(i === 0 ? 0 : r.st, i + 1 < recs.length ? recs[i + 1].st : sents.length)));
  });
  merged.levers = merged.levers
    .filter((l) => !FIELD_LABEL_SECTION.test(l.section || ""))
    .map((l) => ({ ...l, section: relabel(l.section) }))
    // section + lever from the strategy's real position under its heading (overrides the model's guess)
    .map((l) => {
      const pos = posOf(l);
      const h = pos < 0 ? null : [...heads].reverse().find((x) => x.pos <= pos);
      return h ? { ...l, section: h.text } : l;
    })
    // lever follows the heading (Pricing → price even if the strategy reads like differentiation; "Other…" headings → others)
    .map((l) => { const fixed = leverFromHeading(l.section); if (isMnaDocument && fixed === "others" && l.lever === "acquisition_expansion_valuation") return l; return fixed && fixed !== l.lever ? { ...l, lever: fixed } : l; })
    // description + impact = the document's ORIGINAL sentences (no length limit), whatever the model made of them
    .map((l) => {
      const k = regionIndex(l);
      const paras = regionAt(k);
      if (!paras) return l;
      const shared = (regionUse.get(k) || 0) > 1 && !isListIntro(l);
      const parsed = splitClaim(l.claim_en);
      let name = parsed.name;
      const desc = parsed.desc;
      const firstDescription = paras[0].replace(TITLE_COLON.test(paras[0]) ? /^[^:\n]{2,299}?:\s+/ : /^$/, "");
      const descriptionSource = [firstDescription, ...paras.slice(1).filter((q) => !LABEL_PARA.test(q) && !/^power\s+cash\s+link/i.test(q))];
      let descSents = descriptionSource.flatMap((q) => sentencesOf(q));
      const impSents = [...descSents, ...paras.slice(1).filter((q) => !/^power\s+cash\s+link/i.test(q)).flatMap((q) => sentencesOf(stripImpactLabel(q)))];
      const labelled = paras.slice(1).filter((q) => /^(actual\s+impacts?|impacts?|financial\s+impact|results?)\b[^:：\n]{0,30}[:：]/i.test(q));
      // M&A "What <Company> Brings…" section = ONE record: the block's own introductory phrase as the title, the whole block (every list item) as the description
      if (isMnaDocument && mnaSectionKind(l.section) === "company_support") {
        const introTitle = TITLE_COLON.test(paras[0]) ? paras[0].match(/^([^:\n]{2,299}?):/)[1].trim() : name;
        const whole = descSents.join(" ");
        return { ...l, claim_en: introTitle ? `${introTitle}: ${whole}` : whole, impact: "N/A" };
      }
      if (shared && sharedSlices.get(l.claim_en)?.length) {
        let nm = name, sl = sharedSlices.get(l.claim_en);
        // M&A: a label the model made up is replaced by the slice's own opening sentence
        if (isMnaDocument && nm && !nBody.includes(normWs(nm)) && sl.length > 1) {
          const lead = sl[0].replace(/[.:;,\s]+$/, "");
          if (wordCount(lead) <= 12) { nm = lead; sl = sl.slice(1); }
        }
        const imp2 = l.impact && l.impact !== "N/A" ? stripImpactLabel(snapToSource(l.impact, impSents)) : "N/A";
        const imp2N = imp2 !== "N/A" ? normWs(imp2) : "";
        const kept = sl.filter((sn) => !imp2N || !imp2N.includes(normWs(sn)));
        let dsc = (kept.length ? kept : sl).join(" ");
        // M&A: the title is shown in bold, so it must not be repeated at the start of the description
        if (isMnaDocument && nm) dsc = dsc.replace(new RegExp("^" + nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s,;:.\\u2013-]*", "i"), "") || dsc;
        return { ...l, claim_en: nm ? `${mnaTitle(nm)}: ${dsc}` : dsc, impact: imp2 || "N/A" };
      }
      if (shared) {
        // several records came from this one block: snap each to the original sentences it matches instead of copying the whole block into each
        const d2 = snapToSource(desc, descSents);
        const i2 = l.impact && l.impact !== "N/A" ? stripImpactLabel(snapToSource(l.impact, impSents)) : "N/A";
        return { ...l, claim_en: name ? `${name}: ${d2}` : d2, impact: i2 || "N/A" };
      }
      // M&A: a label the model made up (found nowhere in the document) is replaced by the block's own opening sentence
      if (isMnaDocument && name && !nBody.includes(normWs(name)) && descSents.length) {
        const lead = descSents[0].replace(/[.:;,\s]+$/, "");
        if (wordCount(lead) <= 12) { name = lead; if (descSents.length > 1) descSents = descSents.slice(1); }
      }
      // the document's own labelled impact paragraph ("Actual Impact:", "Impact:", "Financial Impact:", "Result:") is used whole and unchanged;
      // only when there is none do we fall back to matching the model's impact to the nearest original sentence(s)
      const impact = labelled.length
        ? labelled.map((q) => stripImpactLabel(q)).join(" ")
        : (l.impact && l.impact !== "N/A" ? stripImpactLabel(snapToSource(l.impact, impSents)) : l.impact);
      // description = the WHOLE original paragraph, minus the sentence(s) that went into the impact box — never shortened
      const impN = impact && impact !== "N/A" ? normWs(impact) : "";
      const descFull = descSents.filter((sn) => !impN || !impN.includes(normWs(sn)));
      // a one-sentence strategy whose "impact" swallowed the entire description is just a description: keep the full original sentence, impact = N/A
      const swallowed = !descFull.length && descSents.length && !labelled.length;
      let newDesc = name ? (swallowed ? descSents.join(" ") : descFull.length ? descFull.join(" ") : snapToSource(desc, descSents, true)) : l.claim_en;
      // M&A: the title is shown in bold, so it must not be repeated at the start of the description
      if (isMnaDocument && name) newDesc = newDesc.replace(new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s,;:.\\u2013-]*", "i"), "") || newDesc;
      if (isMnaDocument && name && !/[A-Za-z0-9]/.test(newDesc)) return { ...l, claim_en: descSents.join(" ") || name, impact: swallowed ? "N/A" : (impact || "N/A") }; // title was the whole sentence: show it once
      return { ...l, claim_en: name ? `${isMnaDocument ? mnaTitle(name) : name}: ${newDesc}` : newDesc, impact: swallowed ? "N/A" : (impact || "N/A") };
    })
    // the document's own bullet lists stay bullet lists in the description
    .map((l) => {
      if (!listItems.length) return l;
      const { name, desc } = splitClaim(l.claim_en);
      const d2 = withBullets(desc, listItems);
      return d2 === desc ? l : { ...l, claim_en: name ? `${name}: ${d2}` : d2 };
    })
    // M&A documents: a list intro and the concluding recap are not strategies, and a "what the company brings" section yields at most ONE record
    .filter((l) => {
      if (!isMnaDocument) return true;
      const strategyName = splitClaim(l.claim_en).name || l.claim_en || "";
      if (/^acquisition opportunities may come from\b/i.test(strategyName)) return false;
      if (/model\s+in\s+one\s+line|^\s*summary\b/i.test(l.section || "")) return false;
      return true;
    })
    .filter((l, i, arr) => !isMnaDocument || mnaSectionKind(l.section) !== "company_support" || arr.findIndex((x) => mnaSectionKind(x.section) === "company_support") === i)
    // enforce the "verbatim" rule: drop a quote the model paraphrased or invented
    .map((l) => (l.quote && !src.includes(normWs(l.quote)) ? { ...l, quote: "" } : l))
    // keep the document's own order (recovered strategies are appended last by the coverage check)
    .map((l, i) => { const p = posOf(l); return { l, k: p < 0 ? Infinity : p, i }; })
    .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k - b.k))
    .map((x) => x.l)
    .slice(0, 60);
  // every section a record points to must exist in the sections list (headings detected in code may be new to the model's list)
  const haveSec = new Set(merged.sections.map((s) => normWs(s.heading)));
  merged.levers.forEach((l) => {
    const k = normWs(l.section);
    if (k && !haveSec.has(k)) { haveSec.add(k); merged.sections.push({ heading: l.section, summary_en: "", summary_zh: "" }); }
  });
  merged.levers = await classifyOthers(merged.levers); // one small call: every Others record gets exactly one category
  merged.levers = sortByLever(merged.levers); // then group by lever, in the fixed lever order (document order kept inside each lever)
  return merged;
}

/* "14. YETI d" / "13. Bobbie-d" -> "YETI" / "Bobbie": drops the leading list number and a trailing lone lowercase marker letter (a draft suffix) */
function cleanDocTitle(s) {
  const t = String(s || "")
    .replace(/^\s*\d+\s*[.)_-]\s*/, "")
    .replace(/[\s_-]+[a-z]$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return t || String(s || "").trim();
}

async function parseDocxFile(f) {
  const buf = await f.arrayBuffer();
  const [raw, rich] = await Promise.all([
    mammoth.extractRawText({ arrayBuffer: buf }),
    mammoth.convertToHtml({ arrayBuffer: buf }),
  ]);
  return {
    title: cleanDocTitle(f.name.replace(/\.docx$/i, "").replace(/_+/g, " ")),
    text: raw.value || "",
    html: (rich.value || "").slice(0, 150000),
  };
}

function buildExtractionPrompt(capped, title, part = 1, parts = 1, customLevers = [], forceMna = false) {
  const customs = customLevers.length ? customLevers : CUSTOM_LEVERS; // custom levers come from the lever definitions, exactly like the built-in ones
  const customBlock = customs.length ? `
CUSTOM LEVERS (added by the administrator in Admin settings; they are as real as the levers above and take precedence over "others"):
${customs.map((l) => `- ${l.id} ("${l.name}"): ${l.description}${l.example ? ` Example: ${l.example}` : ""}${customHeadingWords(l).length ? ` Document headings for it: ${customHeadingWords(l).join(", ")}.` : ""}`).join("\n")}
When a strategy clearly matches a custom lever's definition, or sits under one of its headings, set lever to that custom id (never "others"). Keep a built-in lever when it fits better.
` : "";
  const isMnaDoc = !!forceMna; // decided in code from the document's section headings, not by keywords in the chunk
  const mnaRules = isMnaDoc ? `
M&A DOCUMENT MODE. The material was prefiltered in code to these sections only: "M&A Appetite", "Acquisition Criteria", "Post-Acquisition Strategy" and "What [Company] Brings to Acquired Companies" (headings may be numbered). Extract NOTHING from the background block or from anything outside those sections. No "Key Strategies" heading is needed: in an M&A document a strategy is an explicit acquisition action, policy, target-selection criterion, deal structure or operating approach.

HOW THE MATERIAL IS LAID OUT (already structured for you by code):
- A strategy or criterion is ONE paragraph that starts with "Title: text". Every further line inside that paragraph (sentences, quote lines, list items, bullet fragments) belongs to THAT SAME strategy — it is its description.
- A paragraph with no "Title:" prefix is an untitled block under a section heading.
- A line that is just a section heading is never a strategy.

RULES:
1. One record per "Title: text" paragraph — every numbered criterion and every appetite point gets its own record; do not skip any. Never create a record from a quote line, a list item or a bullet that sits inside a paragraph (for example a quoted remark, "Valuation" / "People / Culture Fit" in a list of reasons, or "Catcha HQ;" in a list of sourcing channels). A list that only introduces sources ("Acquisition opportunities may come from:") is part of its strategy's description, not a separate record.
2. strategy_name = the exact title as written, without its number. Copy it ONLY into strategy_name; never repeat it at the start of description. Use the exact section heading (without its number) as "section"; never substitute a lever word such as "Valuation" for a heading.
3. Untitled block: extract the explicit approach or policy it states. strategy_name must be a short phrase copied word for word from that block (for example its opening words) — never an invented label such as "Decentralized Operating Model" unless those exact words appear. Role labels ("Operating Companies", "[Company] HQ") and bullets under them are parts of ONE operating model: create ONE record for a coordinated approach (a decentralized model with its role split; a support offering with its list of capabilities). Only a separate, explicit learning or policy in the same block (for example "not every acquisition needs to be fully integrated") may be its own record. Under a "What [Company] Brings…" heading create at most ONE record, titled with the block's introductory phrase, with the full list and every sentence kept together.
4. description = the complete original text of the paragraph, exact words and order (this includes list items and quoted remarks inside it), minus only the sentence(s) that report a realised result.
5. impact = a sentence that reports a result that actually happened (for example revenue that was multiplied after an acquisition). Counts or ratios that merely support a policy ("1 company out of every 100 reviewed") stay in the description. If no realised result is stated, impact = "N/A". Never use theory or Power Cash Link text as impact.
6. Do not make a strategy from company size, revenue/EBITDA figures, sector descriptions, deal counts, aspirations or capabilities. Ignore a concluding one-line summary that only repeats strategies already stated.
7. lever = acquisition_expansion_valuation for all M&A records. All exact-copy, impact and no-invention rules below still apply.
` : "";
  // Only the document formats this material can contain are sent (fewer tokens per call, fewer irrelevant rules)
  const hasKeyStrategyCard = /key\s+strateg(?:y|ies)\s*[:\uFF1A]/i.test(capped);
  const formatA = `FORMAT A — LONG CASE STUDY. Narrative part, then an "Analysis" / "Power Cash Links" part organised as:
  <Lever heading>            e.g. "Pricing", "Volume", "Inventory", "Talent Strategy"
    <Named strategy>         a short title line, e.g. "No discounts"
    <description paragraph>
    "Actual Impact:" <result>                        ← evidence only
    "Power Cash Link:" <why it moves profit/cash>    ← IGNORE (not the impact; never copy it)
    ...then the NEXT named strategy under the same lever heading...
  Create ONE record PER NAMED STRATEGY — never one per lever heading. If Pricing lists 4 named strategies, output 4 price records; compressing them into one is an extraction failure. Keep the strategy name in the claim.

  Titles appear in THREE layouts — treat all of them as strategy titles, each starting a new record:
    (i)   "Title (optional hint): description on the same line"        e.g. "Sell Experience, Not Just Products (reduce price sensitivity): Because customers…"
    (ii)  Title alone on one line, description on the NEXT line/paragraph (table-like)   e.g. "Combine Multiple Needs in One Offering" then its description
    (iii) Short noun-phrase titles, e.g. "Find-A-Bear identification system" then its description
  Every such title inside an in-scope heading (Pricing … Talent Strategy, Other Strategies) is a strategy — even short ones and ones that repeat a title used under another lever.
    (iv)  OUTLINE: a short title line (no colon) followed by several short lines or bullets — e.g. "Avoid 50:50 ownership" then lines about the ownership split; "Divide roles clearly" then "Roy: …" / "Ryan: …". The title is ONE strategy; the lines under it are that strategy's description (copy their own words, in order — do not summarise). Do NOT make a separate record from each bullet ("Roy: …", "Ryan: …", "Equity was not given for free…").
  The SAME title under TWO different lever headings (e.g. "Simplify the Manufacturing Experience" under Cost of Goods Sold AND under Overhead) is NOT a duplicate: the descriptions explain different lever effects, so output one record under EACH heading.`;
  const formatB = `FORMAT B — SUMMARY CARD with labelled fields:
  <Company> (<Industry> / <Person>)
  Problem: ...   Key Strategy: ...   Formula/Theory: ...   Result: ...
  ONLY the "Key Strategy" field is a strategy. One Key Strategy sentence = ONE record, even if it has several clauses (keep its focus areas in the claim, e.g. "...focused on rebooking and utilization"). Problem and Formula/Theory are context only. For this format: strategy_name = a SHORT title of at most 6 words taken from the Key Strategy wording (e.g. "Buy-and-improve acquisition engine") — NOT the whole sentence; description = the rest of the Key Strategy sentence, WITHOUT repeating the title (e.g. "funded by external partners, focused on rebooking and utilization; exit at high multiple"); impact = the Result field (WORDING RULE applies). "section" is the company/case heading — never a field label like "Key Strategy" or "Result".`;
  const formatC = "FORMAT C — M&A narrative/criteria: apply M&A DOCUMENT MODE above even without strategy headings. Extract only explicitly stated approaches or criteria; never infer a strategy from a capability, benefit, aspiration, or scale fact.";
  const formatSection = isMnaDoc ? `═══ 4. DOCUMENT FORMAT ═══\n${formatC}` : `═══ 4. DOCUMENT FORMATS (learn them before extracting) ═══\n${formatA}${hasKeyStrategyCard ? `\n\n${formatB}` : ""}`;
  return `You are the ingestion engine of YYC's internal advisory knowledge base (Malaysian accounting & advisory firm). Analyse the material below and return ONLY a JSON object, no markdown fences, no commentary.


═══ 1. OUTPUT SHAPE ═══
{
 "strategy_titles": ["<FIRST list the exact title of EVERY key strategy found in this material, in document order — one short string each. This is your checklist: levers below must cover every entry.>"],
 "title": "<use provided title, or better one if empty>",
 "doc_type": "case_study" | "playbook" | "framework" | "notes",
 "industry": "<full descriptive industry, e.g. 'Furniture (trading/retail)'>",
 "industry_main": "<broad category in English, e.g. 'Trading / Retail', 'Services', 'Manufacturing', 'Construction', 'Healthcare', 'Technology', 'Education', 'F&B / Hospitality', 'General'>",
 "industry_sub": "<specific sub-industry in English, e.g. 'Furniture', 'Musical Instruments', 'Skin Cancer Clinics'>",
 "language": "en"${/* [ZH disabled for now] was: | "zh" | "mixed" */ ""},
 "problem_signature": "<one line: the business problem pattern this addresses, in English>",
 "sections": [ { "heading": "<section heading>", "summary_en": "<1-2 sentence English summary>" } ],
 "levers": [ { "lever": "price"|"volume"|"cogs"|"overheads"|"ar_days"|"inventory_days"|"ap_days"|"talent_strategy"|"product_differentiation"|"acquisition_expansion_valuation"${customs.map((l) => `|"${l.id}"`).join("")}|"others", "strategy_name": "<the strategy's title EXACTLY as written in the document; for an untitled but explicit strategy, use a short contiguous phrase copied from its evidence>", "description": "<what the business did or the explicit acquisition criterion, copied EXACTLY from the document — see WORDING RULE>", "impact": "<the actual impact of this strategy, copied EXACTLY from the document — see WORDING RULE; the string \"N/A\" if the document states no actual impact>", "section": "<EXACT heading from the sections array above that this lever came from>", "other_category": "<ONLY when lever is others: legal_regulatory_ip|business_model_execution|financing_capital|operations_process|partnerships_alliances|shareholder_governance|uncategorized>", "related_to": "<ONLY when lever is others: 3-8 English words naming what it specifically relates to>" } ]
}

═══ 2. SCOPE — WHAT TO EXTRACT AND WHAT TO IGNORE ═══
Extract ONLY the KEY STRATEGIES part of the document. A key strategy is an action or decision the business took (or should take) to grow, protect or fund itself.
IN SCOPE: the strategy sections — lever headings (Pricing, Volume, COGS, Overheads, Inventory, Receivables, Payables, Talent Strategy, Product Differentiation${customs.length ? ", " + customs.map((l) => l.name).join(", ") : ""}…), "Other Strategies Used to Grow the Business", or the "Key Strategy" field of a summary card.
OUT OF SCOPE — never create a record from these, and never list them as strategies:
  • Failed strategies / "Failed Strategies, Problems Encountered & Solutions" / lessons-from-failure sections — EXCLUDE them entirely, even if they contain a "Solution".
  • Background narrative, biography, timeline / chronology, company history, website links, references.
  • Table headers, column labels and template leftovers (e.g. "Differentiation", "What Sweetwater Did", "Strategy", "Actual Impact") — these are NOT strategies; a strategy always has a real title AND a description.
  • Problem statements, formulas/theories, KPIs, metrics, targets, multiples and outcomes standing on their own (see section 3).
Do not add out-of-scope headings to the sections array either.
${mnaRules}

═══ 3. EVIDENCE = THE DESCRIPTION BENEATH EACH STRATEGY; RESULTS ARE NEVER STRATEGIES ═══
The supporting points for a strategy are its own source text plus any actual-impact statement explicitly attached to it. "Power Cash Link:" explains theory, not impact; never copy it. Do not use evidence from unrelated sections. ${isMnaDoc ? "In M&A mode, the exact supporting sentence(s) may appear anywhere in this material part; copy them verbatim and attach them only to the explicit action/criterion they support." : ""}
A result (an "Actual Impact:", "Power Cash Link:", "Result:", KPI, percentage, ratio, count, valuation, or "financial impact" line) exists only to SUPPORT a key strategy stated above it. It belongs in that strategy's "impact" field, but it can NEVER become a lever record of its own.
Test before writing each record: "Is this something the business DID or DECIDED?" If it is only something that HAPPENED or was MEASURED (e.g. "utilization 98%", "NPS 90%", "21 acquisitions in 3 years", "sales of US$2 million"), it is a result — fold it into the strategy it supports, or drop it. A result with no key strategy to attach to is dropped, not promoted.

═══ 3b. WORDING RULE — strategy_name, description, impact ═══
Each record is shown as **strategy_name**: description, followed by an impact box.
- strategy_name: copy the exact source title, including hints (the one exception is a FORMAT B summary card, which has no title and uses the short title described there). If M&A mode has no title, use only a short contiguous phrase copied from the supporting source text; do not invent a label.
- description: copy the complete original action/criterion wording exactly, excluding only sentences that describe actual results (those belong in impact). Preserve every original word, number, order, and punctuation. Never summarize, paraphrase, shorten, or merge strategies.
- impact: copy only the complete original sentence(s) reporting a realized result. Remove labels such as "Actual Impact:" or "Result:". Never use "Power Cash Link" or theoretical/speculative claims as impact. If no actual outcome is stated, use exactly "N/A". Keep the outcome sentence's subject and original wording.
- Never add facts, combine evidence from different strategies, or change the source wording. Description and impact may be of any length — never shorten them.

${formatSection}

═══ 5. LEVER DEFINITIONS AND HEADING SYNONYMS ═══
Heading → lever: Pricing/Price → price · Sales/Customers/Demand → volume · COGS/Cost of Goods Sold/Margin → cogs · Overhead(s)/Fixed costs → overheads · Receivables/Accounts Receivable/Collections/AR/Credit control/Receivable Days → ar_days · Inventory/Stock → inventory_days · Payables/Accounts Payable/AP/Supplier terms/Payable Days → ap_days · Talent/People/Hiring/Culture → talent_strategy · Product/Brand/Design/Differentiation → product_differentiation · M&A/Acquisition/Expansion/Valuation/Post-Acquisition headings and explicit acquisition strategy or screening criteria → acquisition_expansion_valuation · "Other Strategies (Used to Grow the Business)" or any other key strategy (e.g. Additional Strategies) → others${extraHeadingNote()}

CASH LEVERS (Alan Miltz framework — when the text discusses cash-flow mechanics):
${leverDefLine("price")}
${leverDefLine("volume")}
${leverDefLine("cogs")}
${leverDefLine("overheads")}
${leverDefLine("ar_days")}
${leverDefLine("inventory_days")}
${leverDefLine("ap_days")}

NON-CASH STRATEGIC LEVERS (do NOT force these into cash levers):
${leverDefLine("talent_strategy")}
${leverDefLine("product_differentiation")}
${leverDefLine("acquisition_expansion_valuation")}
- others: any key strategy that fits none of the above — e.g. legal/trademark enforcement, exclusive lease clauses, regulatory response, competitive moats, brand partnerships. A strategy whose clause mentions KPIs it focuses on (rebooking, utilization) stays ONE others record; do not split it into volume records.
  For EVERY "others" record you MUST also set other_category and related_to. Pick the ONE category that fits best:
${otherCatDefs()}
  related_to = 3-8 English words naming what the strategy specifically relates to.
${customBlock}For M&A records, use acquisition_expansion_valuation for acquisition strategy and criteria. Use others only when the strategy is not itself an acquisition/valuation/ownership policy and another category clearly fits (e.g. a standalone shareholder governance or financing policy). Do not duplicate one strategy across lever categories.

═══ 6. EXTRACTION RULES ═══
1. Only extract what the text supports. Do NOT invent. A document may cover zero levers.
2. One record per NAMED key strategy per lever heading. Only a repeat under the SAME heading is a duplicate; the same title under two different lever headings gets a record under each.
3. COVERAGE — walk the in-scope material top to bottom and do not stop early. Every named key strategy under every in-scope heading needs its record, including the LAST in-scope headings (Talent Strategy, Other Strategies). Before answering, compare your levers against strategy_titles: every title must have at least one record, and every in-scope title in the material must be in strategy_titles.
4. Prefer specificity: "Increase price by 5% in FY22" beats "pricing matters".
5. "section" is the HEADING the strategy sits under (e.g. "Overhead", "Talent Strategy", "Other Strategies Used to Grow the Business") — NEVER the strategy's own title — and must exactly match a heading in your sections array. The lever follows that heading STRICTLY (Overhead → overheads, Volume → volume, Pricing → price…), whatever the strategy sounds like: a unique-selling-point, brand-value or community strategy listed under "Pricing" is a price record, not product_differentiation; an influencer or e-commerce strategy under "Volume" is a volume record. Do not re-file a strategy to "others" just because you find it interesting. Use "others" only under Other Strategies or when no lever heading fits.${isMnaDoc ? `
   Exception (M&A mode): use acquisition_expansion_valuation for explicit acquisition strategy and criteria regardless of heading; do not duplicate records.` : ""}
6. Apply the WORDING RULE (section 3b) to every record.
7. strategy_name and description are ALWAYS present.
8. Maximum: 12 sections, 30 lever records for this part (strategy_titles: as many as the material has). Keep section summaries to 1-2 sentences, but NEVER drop or merge named strategies to save space — completeness of records matters more than brevity.${parts > 1 ? `
9. This material is PART ${part} of ${parts} of one document. Extract only what appears in this part; do not invent or repeat content from other parts. Title/industry fields: best reading from this part.` : ""}


PROVIDED TITLE: ${title || "(none)"}

MATERIAL:
${capped}`;
}

/* Import Backup preview: every material found in the backup, with its status and strategies, and the lever settings found in it.
   Nothing is saved until "Import selected" is pressed; only what is ticked is imported. */
const IMPORT_STATE = { new: ["New", "#0E7C4A", "#E6F5EC"], exists: ["Already in the library: skipped", "#8A6508", "#FFF6DC"], deleted: ["Was deleted: skipped", "#9A0000", "#FDEDED"] };
function ImportPreviewModal({ t, plan, busy, onCancel, onConfirm }) {
  const [selDocs, setSelDocs] = useState(() => new Set(plan.docs.filter((d) => d.state === "new").map((d) => d.id)));
  const [selCfg, setSelCfg] = useState(() => new Set(plan.cfgItems.filter((c) => !c.exists).map((c) => c.key)));
  const [open, setOpen] = useState(() => new Set());
  const toggle = (set, setter, key) => { const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); setter(n); };
  const newDocs = plan.docs.filter((d) => d.state === "new");
  const newCfg = plan.cfgItems.filter((c) => !c.exists);
  const nDocs = selDocs.size, nCfg = selCfg.size;
  const nRecs = plan.docs.filter((d) => selDocs.has(d.id)).reduce((n, d) => n + d.records.length, 0);
  const counts = (st) => plan.docs.filter((d) => d.state === st).length;
  const chip = (st) => <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999, color: IMPORT_STATE[st][1], background: IMPORT_STATE[st][2], whiteSpace: "nowrap" }}>{IMPORT_STATE[st][0]}</span>;
  return (
    <div className="yyc-modal-backdrop" onClick={() => !busy && onCancel()}>
      <div className="yyc-modal" style={{ width: 760, maxWidth: "100%", padding: 24, maxHeight: "90vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: P.crimson, fontWeight: 750, letterSpacing: ".08em", textTransform: "uppercase" }}>Import backup</div>
            <h2 style={{ margin: "4px 0 0", fontSize: 20, color: "#4a0707", fontWeight: "bolder" }}>Review what will be imported</h2>
            <div style={{ fontSize: 12.5, color: P.sub, marginTop: 4, lineHeight: 1.5 }}>
              {plan.fileName}{plan.exportedAt ? ` · exported ${new Date(plan.exportedAt).toLocaleString("en-MY")}` : ""} · {plan.docs.length} material{plan.docs.length === 1 ? "" : "s"}: {counts("new")} new, {counts("exists")} already in the library, {counts("deleted")} previously deleted. Nothing is saved until you press Import selected.
            </div>
          </div>
          <button className="yyc-icon-btn" onClick={onCancel} disabled={busy} title={t.close}><Icon name="close" size={13} /></button>
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
                  <span style={{ fontSize: 11, fontWeight: 700, color: c.exists ? "#8A6508" : "#0E7C4A" }}>{c.exists ? "Already set: skipped" : "New"}</span>
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

function KnowledgePanel({
  t, lang, isAdmin, index, levers, refreshKB, openPreview, flash, config, setConfig, setConfirm, setAdminLocked,
  paletteLever, clearPaletteLever, onWorking,
}) {
  const leverKeys = Object.keys(t.levers);
  const [mode, setMode] = useState("list");
  const [stage, setStage] = useState("");                 // single-upload progress stage
  const [bulkItems, setBulkItems] = useState([]);         // [{id,name,title,text,html,status,extraction}]
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkWait, setBulkWait] = useState(0);            // countdown between docs (TPM pacing)
  const [bulkReviewId, setBulkReviewId] = useState(null); // review screen came from bulk
  const bulkCancelRef = useRef(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [html, setHtml] = useState("");
  const [fastMode, setFastMode] = useState(fastExtraction()); // tick box on the Add material screen
  const [importPlan, setImportPlan] = useState(null); // the Import Backup preview window
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [aiNote, setAiNote] = useState(null);                 // live rate-limit wait from askAI: {kind:"wait", sec}
  useEffect(() => { setAiListener(setAiNote); return () => setAiListener(null); }, []);
  const aiBanner = aiNote && (
    <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: P.wash, border: `1px solid ${P.lineDark}`, color: P.sub, fontSize: 13, fontWeight: 600 }}>
      ⏳ {t.rateWaiting} {aiNote.sec}s
    </div>
  );
  const [extraction, setExtraction] = useState(null);
  const [editDoc, setEditDoc] = useState(null);
  const [editLevers, setEditLevers] = useState([]);
  const [editLeverRecord, setEditLeverRecord] = useState(null);
  const [newPass, setNewPass] = useState("");
  const [search, setSearch] = useState("");
  const [leverFilter, setLeverFilter] = useState("all");

  useEffect(() => {
    if (paletteLever && clearPaletteLever) {
      setLeverFilter(paletteLever);
      setMode("list");
      clearPaletteLever();
    }
  }, [paletteLever]);
  const [mainCat, setMainCat] = useState("all");
  const [subCat, setSubCat] = useState("all");
  const [pickerRecord, setPickerRecord] = useState(null);
  const [statPicker, setStatPicker] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!setAdminLocked) return;
    const locked =
      mode === "edit" || mode === "review" || mode === "add" ||
      busy ||
      editLeverRecord !== null ||
      pickerRecord !== null ||
      importPlan !== null ||
      statPicker;
    setAdminLocked(locked);
    return () => setAdminLocked(false);
  }, [mode, busy, editLeverRecord, pickerRecord, statPicker, importPlan, setAdminLocked]);

  // tell the app when something is running, and warn before the page is closed/refreshed with work in progress or an unsaved review
  const working = busy || bulkRunning;
  useEffect(() => { if (onWorking) onWorking(working); }, [working]);
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
        if (!title) setTitle(p.title);
      } catch { setErrMsg(t.apiErr); }
      return;
    }
    /* bulk mode */
    try {
      const items = [];
      for (const f of files) {
        const p = await parseDocxFile(f);
        items.push({ id: uid(), name: f.name, ...p, status: "pending", extraction: null });
      }
      setBulkItems(items);
      setMode("bulk");
      runBulk(items);
    } catch { setErrMsg(t.apiErr); }
  };

  /* sequential, TPM-paced queue: one extraction ≈ one minute of an 8k-TPM quota,
     so docs are spaced ~70s apart; askAI's 429 handling is the safety net */
  const runBulk = async (items) => {
    bulkCancelRef.current = false;
    setErrMsg("");
    setBulkRunning(true);
    for (let i = 0; i < items.length; i++) {
      if (bulkCancelRef.current) break;
      const it = items[i];
      setBulkItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, status: "extracting" } : x)));
      const startedAt = Date.now();
      try {
        const j = await extractDocument(it.text, it.title, config?.customLevers || [], it.html);
        setBulkItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, status: "done", extraction: j, error: "", elapsed: Date.now() - startedAt } : x)));
      } catch (e) {
        const msg = describeAIError(e, t);
        setBulkItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, status: "error", error: msg } : x)));
        setErrMsg(msg);
        // daily quota gone: every remaining document would fail the same way — stop the queue, leave them pending
        if (e instanceof AIError && e.kind === "daily") break;
      }
      if (i < items.length - 1 && !bulkCancelRef.current) {
        const pauseSec = (await keysInUse()) > 1 ? 0 : 45; // several keys: the token budget does the pacing; one key: the original 45 s gap
        for (let sLeft = pauseSec; sLeft > 0; sLeft--) {
          if (bulkCancelRef.current) break;
          setBulkWait(sLeft);
          await new Promise((r) => setTimeout(r, 1000));
        }
        setBulkWait(0);
      }
    }
    setBulkWait(0);
    setBulkRunning(false);
  };

  const retryBulkItem = async (itemId) => {
    const it = bulkItems.find((x) => x.id === itemId);
    if (!it || bulkRunning) return;
    setBulkItems((arr) => arr.map((x) => (x.id === itemId ? { ...x, status: "extracting" } : x)));
    try {
      const j = await extractDocument(it.text, it.title, config?.customLevers || [], it.html);
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
    setBusy(true); setErrMsg(""); setStage("analyze");
    const stageTimer = setTimeout(() => setStage("levers"), 7000); // presentational: one AI call, staged for confidence
    const startedAt = Date.now();
    try {
      const j = await extractDocument(text, title, config?.customLevers || [], html);
      setExtraction(j);
      setMode("review");
      flash(`Extracted in ${fmtElapsed(Date.now() - startedAt)} (${fastExtraction() ? "fast mode" : "normal mode"})`);
    } catch (e) { setErrMsg(describeAIError(e, t)); }
    clearTimeout(stageTimer);
    setStage("");
    setBusy(false);
  };

  const saveDoc = async () => {
    setBusy(true); setErrMsg("");
    try {
      const id = uid();
      const doc = {
        id,
        status: "active",
        created_by: me(),
        title: cleanDocTitle(extraction.title || title) || "Untitled",
        doc_type: extraction.doc_type || "notes",
        industry: extraction.industry || "General",
        industry_main: extraction.industry_main || normalizeMainCategory(extraction.industry || "General"),
        industry_sub: extraction.industry_sub || "",
        language: extraction.language || "en",
        problem_signature: extraction.problem_signature || "",
        sections: extraction.sections || [],
        full_text: text.slice(0, 60000),
        html: html || "",
        created: Date.now(),
      };
      const records = [];
      (extraction.levers || []).forEach((lr) => {
        if (leverKeys.includes(lr.lever) && !lr.skip) {
          const { skip, ...clean } = lr;
          records.push(normalizeOther({ id: uid(), status: "active", created_by: me(), doc_id: id, doc_title: doc.title, ...clean }));
        }
      });
      await window.db.saveDocument(doc, records);
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
      onConfirm: async () => {
        await window.db.deleteDocument(docId); // soft delete: the document and its lever records stay in storage, marked deleted
        await refreshKB();
      },
    });
  };

  const startEdit = async (docId) => {
    const doc = await window.db.getDocument(docId, { fresh: true });
    if (!doc) return;
    setEditDoc(JSON.parse(JSON.stringify(doc)));
    setEditLevers(sortByLever(levers.filter((l) => l.doc_id === docId)).map((l) => ({ ...l })));
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
      message: t.delConfirm,
      onConfirm: async () => {
        await window.db.deleteRecord(record.id); // soft delete
        await refreshKB();
      },
    });
  };

  const saveEdit = async () => {
    setBusy(true); setErrMsg("");
    try {
      if (!editDoc.industry_main) {
        editDoc.industry_main = normalizeMainCategory(editDoc.industry || "General");
      }
      const mine = editLevers
        .filter((l) => leverKeys.includes(l.lever) && ((l.claim_en || "").trim() || (l.claim_zh || "").trim()))
        .map((l) => normalizeOther({ status: "active", ...l, doc_title: editDoc.title }));
      // records of this document that are no longer on the edit screen (removed, or emptied) stay in storage, marked deleted
      await window.db.updateDocument(editDoc, mine);
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

  const leverCount = (docId) => levers.filter((l) => l.doc_id === docId).length;

  const docMeta = (doc) => {
    const parsed = parseIndustry(doc.industry || "", doc);
    return { main: parsed.main || "General", sub: parsed.sub || "" };
  };

  const mainCategories = Array.from(
    new Set(index.map((d) => docMeta(d).main).filter(Boolean))
  ).sort();

  const subCategories = Array.from(
    new Set(
      index
        .filter((d) => mainCat === "all" || docMeta(d).main === mainCat)
        .map((d) => docMeta(d).sub)
        .filter(Boolean)
    )
  ).sort();

  const filteredIndex = index.filter((d) => {
    const { main, sub } = docMeta(d);
    if (mainCat !== "all" && main !== mainCat) return false;
    if (subCat !== "all" && sub !== subCat) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = `${d.title || ""} ${d.industry || ""} ${d.problem_signature || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const filteredLevers = levers.filter((l) => {
    if (leverFilter !== "all" && l.lever !== leverFilter) return false;
    if (mainCat !== "all" || subCat !== "all") {
      const meta = index.find((d) => d.id === l.doc_id);
      if (!meta) return false;
      const { main, sub } = docMeta(meta);
      if (mainCat !== "all" && main !== mainCat) return false;
      if (subCat !== "all" && sub !== subCat) return false;
    }
    return true;
  });

  const groupedLevers = {};
  filteredLevers.forEach((r) => {
    if (!groupedLevers[r.doc_id]) groupedLevers[r.doc_id] = [];
    groupedLevers[r.doc_id].push(r);
  });

  const clearAllFilters = () => {
    setSearch(""); setLeverFilter("all"); setMainCat("all"); setSubCat("all");
  };
  const anyFilterActive =
    search.trim() || leverFilter !== "all" || mainCat !== "all" || subCat !== "all";

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
            <button className="yyc-btn-secondary" onClick={() => { setMode("list"); setEditDoc(null); setEditLevers([]); }} style={{ padding: "7px 12px", marginBottom: 10 }}>
              <Icon name="arrowLeft" size={13} /> {t.cancel}
            </button>
            <h1 className="yyc-section-title">{t.editTitle}</h1>
          </div>
        </div>

        <div style={{ ...S.card, padding: 24 }}>
          <label style={S.label}>{t.titlePh.split(" (")[0]}</label>
          <input value={editDoc.title} onChange={(e) => setD({ title: e.target.value })} className="yyc-input" />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>
            <div>
              <label style={S.label}>{t.docType}</label>
              <select value={editDoc.doc_type} onChange={(e) => setD({ doc_type: e.target.value })} className="yyc-input">
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
            <div style={{ fontWeight: 750, fontSize: 14, color: P.maroon }}>
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
                <button onClick={() => delSec(i)} className="yyc-icon-btn is-danger"><Icon name="trash" size={13} /></button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8 }}>
                <textarea value={s.summary_en || ""} onChange={(e) => setSec(i, { summary_en: e.target.value })} rows={2} placeholder="EN summary" className="yyc-input" />
                {/* [ZH disabled for now] <textarea value={s.summary_zh || ""} onChange={(e) => setSec(i, { summary_zh: e.target.value })} rows={2} placeholder="中文摘要" className="yyc-input" /> */}
              </div>
            </div>
          ))}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `2px solid ${P.gold}`, paddingBottom: 8, marginTop: 26 }}>
            <div style={{ fontWeight: 750, fontSize: 14, color: P.maroon }}>
              {t.leverRecords} <span style={{ color: P.faint }}>({editLevers.length})</span>
            </div>
            <button className="yyc-btn-secondary" onClick={addLev} style={{ padding: "6px 12px", fontSize: 12 }}>
              <Icon name="plus" size={12} /> {t.addRecord.replace("+ ", "")}
            </button>
          </div>
          {editLevers.map((l, i) => (
            <div key={l.id || i} style={{ borderTop: i ? `1px solid ${P.line}` : "none", padding: "14px 0" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select value={l.lever} onChange={(e) => setLev(i, { lever: e.target.value })} className="yyc-input" style={{ width: 170 }}>
                  {leverKeys.map((k) => <option key={k} value={k}>{t.levers[k]}</option>)}
                </select>
                <input value={l.section || ""} onChange={(e) => setLev(i, { section: e.target.value })} placeholder={t.sections} className="yyc-input" style={{ flex: 1, minWidth: 140 }} />
                <button onClick={() => delLev(i)} className="yyc-icon-btn is-danger"><Icon name="trash" size={13} /></button>
              </div>
              {l.lever === "others" && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                  <select value={OTHER_CATS.includes(l.other_category) ? l.other_category : "uncategorized"} onChange={(e) => setLev(i, { other_category: e.target.value })} className="yyc-input" style={{ width: 210 }} title={t.otherCat}>
                    {OTHER_CATS.map((k) => <option key={k} value={k}>{t.otherCats[k]}</option>)}
                  </select>
                  <input value={l.related_to || ""} onChange={(e) => setLev(i, { related_to: e.target.value })} placeholder={t.relatedToPh} className="yyc-input" style={{ flex: 1, minWidth: 200 }} />
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8 }}>
                <textarea value={l.claim_en || ""} onChange={(e) => setLev(i, { claim_en: e.target.value })} rows={2} placeholder="Strategy name: description" className="yyc-input" />
                <textarea value={l.impact ?? l.quote ?? ""} onChange={(e) => setLev(i, { impact: e.target.value })} rows={2} placeholder="Actual impact (as written in the document)" className="yyc-input" />
                {/* [ZH disabled for now] <textarea value={l.claim_zh || ""} onChange={(e) => setLev(i, { claim_zh: e.target.value })} rows={2} placeholder="内容 (中文)" className="yyc-input" /> */}
              </div>
            </div>
          ))}
        </div>

        {errMsg && <div style={{ color: P.red, fontSize: 13, marginTop: 12, fontWeight: 600 }}>{errMsg}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button className="yyc-btn-primary" onClick={saveEdit} disabled={busy}>{busy ? "…" : t.saveChanges}</button>
          <button className="yyc-btn-secondary" onClick={() => { setMode("list"); setEditDoc(null); setEditLevers([]); }}>{t.cancel}</button>
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

    return (
      <div>
        <div className="yyc-section-head">
          <div>
            <h1 className="yyc-section-title">{t.reviewTitle}</h1>
            <div className="yyc-section-sub">{t.reviewNote}</div>
          </div>
        </div>

        <div style={{ ...S.card, padding: 24 }}>
          <label style={S.label}>Document title</label>
          <input className="yyc-input" value={extraction.title || ""} onChange={(e) => setExtraction((x) => ({ ...x, title: e.target.value }))} style={{ fontSize: 18, fontWeight: 750 }} />
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 10, fontSize: 13, color: P.sub }}>
            <span><b style={{ color: P.ink }}>{t.docType}:</b> {t.docTypes[extraction.doc_type] || extraction.doc_type}</span>
            <span><b style={{ color: P.ink }}>{t.industry}:</b> {sub ? `${main} · ${sub}` : main}</span>
          </div>
          <div style={{ fontSize: 13, color: P.sub, marginTop: 6 }}>
            <b style={{ color: P.ink }}>{t.problemSig}:</b> {extraction.problem_signature}
          </div>

          <div style={{ fontWeight: 750, fontSize: 14, marginTop: 24, color: P.maroon }}>
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

          <div style={{ fontWeight: 750, fontSize: 14, marginTop: 20, color: P.maroon }}>
            {t.leverRecords} <span style={{ color: P.faint }}>({(extraction.levers || []).length})</span>
          </div>
          {(extraction.levers || []).map((l, i) => {
            const claimParts = splitClaim(l.claim_en);
            const updateClaim = (name, description) => {
              const claim = name.trim() ? `${name.trim()}: ${description.trim()}` : description.trim();
              setExtraction((x) => ({ ...x, levers: x.levers.map((v, k) => (k === i ? { ...v, claim_en: claim } : v)) }));
            };
            return (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", borderTop: i ? `1px solid ${P.line}` : "none", padding: "12px 0", opacity: l.skip ? 0.45 : 1 }}>
              <span style={{ background: P.goldSoft, color: P.goldDark, border: `1px solid rgba(184,134,11,0.4)`, fontSize: 11, fontWeight: 750, padding: "3px 11px", whiteSpace: "nowrap", borderRadius: 999 }}>
                {leverTag(t, l)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {l.lever === "others" && l.related_to && (
                  <div style={{ fontSize: 12, color: P.sub, marginBottom: 3 }}>{t.relatedTo}: <b style={{ color: P.ink }}>{l.related_to}</b></div>
                )}
                <label style={S.label}>Strategy title</label>
                <input className="yyc-input" value={claimParts.name} onChange={(e) => updateClaim(e.target.value, claimParts.desc)} />
                <label className="yyc-edit-record-field" style={S.label}>Description</label>
                <textarea className="yyc-input yyc-edit-record-textarea" rows={3} value={claimParts.desc} onChange={(e) => updateClaim(claimParts.name, e.target.value)} />
                <label className="yyc-edit-record-field" style={S.label}>Actual impact</label>
                <textarea className="yyc-input yyc-edit-record-textarea" rows={2} value={l.impact || ""} onChange={(e) => setExtraction((x) => ({ ...x, levers: x.levers.map((v, k) => (k === i ? { ...v, impact: e.target.value } : v)) }))} />
                <div style={{ fontSize: 12, color: P.faint, marginTop: 4 }}>{l.section}</div>
                <select
                  className="yyc-input"
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
                      className="yyc-input"
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
                    <span style={{ fontWeight: 750, color: P.goldDark }}>⚠ {t.similarExisting} ({Math.round(conflicts[i].sim * 100)}%):</span>{" "}
                    <b>{conflicts[i].doc_title}</b> — "{conflicts[i].claim}"
                  </div>
                )}
              </div>
              {conflicts[i] && (
                <button
                  className="yyc-btn-secondary"
                  style={{ flexShrink: 0, padding: "5px 12px", fontSize: 12, ...(l.skip ? { borderColor: P.goldDark, color: P.goldDark } : {}) }}
                  onClick={() => setExtraction((x) => ({ ...x, levers: x.levers.map((v, k) => (k === i ? { ...v, skip: !v.skip } : v)) }))}
                >
                  {l.skip ? t.skippedNote : t.skipRecord}
                </button>
              )}
            </div>
            );
          })}
        </div>

        {errMsg && <div style={{ color: P.red, fontSize: 13, marginTop: 12, fontWeight: 600 }}>{errMsg}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button className="yyc-btn-primary" onClick={saveDoc} disabled={busy}>{busy ? "…" : t.saveDoc}</button>
          <button className="yyc-btn-secondary" onClick={() => { if (bulkReviewId) { setBulkReviewId(null); setMode("bulk"); } else setMode("add"); }}>{t.discard}</button>
        </div>
      </div>
    );
  }

  if (mode === "bulk" && isAdmin) {
    const doneN = bulkItems.filter((x) => x.status === "done").length;
    const pendingN = bulkItems.filter((x) => x.status === "pending" || x.status === "extracting").length;
    const statusLabel = { pending: t.statusPending, extracting: t.statusExtracting, done: t.statusDone, error: t.statusError };
    const fmtDone = (it) => (it.status === "done" && it.elapsed ? `${statusLabel.done} · ${fmtElapsed(it.elapsed)}` : statusLabel[it.status]);
    const statusColor = { pending: P.faint, extracting: P.maroon, done: P.green, error: P.red };
    return (
      <div>
        <div className="yyc-section-head">
          <div>
            {!bulkRunning && (
              <button className="yyc-btn-secondary" onClick={() => { setBulkItems([]); setMode("list"); }} style={{ padding: "7px 12px", marginBottom: 10 }}>
                <Icon name="arrowLeft" size={13} /> {t.backToLibrary}
              </button>
            )}
            <h1 className="yyc-section-title">{t.bulkTitle} ({bulkItems.length})</h1>
            <div className="yyc-section-sub">{t.bulkHint}</div>
          </div>
          {bulkRunning && (
            <button className="yyc-btn-secondary" onClick={() => { bulkCancelRef.current = true; }} style={{ borderColor: P.red, color: P.red }}>
              {t.bulkStop}
            </button>
          )}
        </div>

        <div style={{ ...S.card, padding: 8 }}>
          {bulkItems.map((it) => (
            <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: `1px solid ${P.line}` }}>
              {it.status === "extracting" ? (
                <span className="yyc-spin" style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${P.line}`, borderTopColor: P.maroon, display: "inline-block", flexShrink: 0 }} />
              ) : (
                <span style={{ color: statusColor[it.status], fontSize: 15, flexShrink: 0, width: 14, textAlign: "center" }}>
                  {it.status === "done" ? "✓" : it.status === "error" ? "✗" : "○"}
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</div>
                <div style={{ fontSize: 11.5, color: statusColor[it.status], fontWeight: 600 }}>
                  {fmtDone(it)}
                  {it.status === "done" && it.extraction ? ` · ${(it.extraction.levers || []).length} ${t.leverRecords.toLowerCase()}` : ""}
                </div>
                {it.status === "error" && it.error && <div style={{ fontSize: 11.5, color: P.red, marginTop: 3, lineHeight: 1.4 }}>{it.error}</div>}
              </div>
              {it.status === "done" && (
                <button className="yyc-btn-primary" style={{ padding: "6px 14px", fontSize: 12.5 }} onClick={() => reviewBulkItem(it.id)}>
                  {t.bulkReviewBtn}
                </button>
              )}
              {it.status === "error" && !bulkRunning && (
                <button className="yyc-btn-secondary" style={{ padding: "6px 14px", fontSize: 12.5 }} onClick={() => retryBulkItem(it.id)}>
                  {t.bulkRetry}
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
          {errMsg && <div style={{ padding: "10px 14px", fontSize: 13, color: P.red, fontWeight: 600, lineHeight: 1.5 }}>{errMsg}</div>}
          {!bulkRunning && pendingN === 0 && doneN > 0 && (
            <div style={{ padding: "12px 14px", fontSize: 13, color: P.green, fontWeight: 700 }}>
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
            <button className="yyc-btn-secondary" onClick={() => setMode("list")} disabled={busy} title={busy ? "Wait for the extraction to finish" : ""} style={{ padding: "7px 12px", marginBottom: 10 }}>
              <Icon name="arrowLeft" size={13} /> {t.cancel}
            </button>
            <h1 className="yyc-section-title">{t.upload}</h1>
            <div className="yyc-section-sub">Paste text or upload a .docx. The AI will categorize the material and extract the 10 levers.</div>
          </div>
        </div>

        <div style={{ ...S.card, padding: 24 }}>
          <label style={S.label}>{t.titlePh}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.titlePh} className="yyc-input" />

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
            <button onClick={() => fileRef.current?.click()} className="yyc-btn-secondary" style={{ background: P.wash, color: P.ink }}>
              <Icon name="upload" size={14} /> {t.uploadDocx}
            </button>
            <input ref={fileRef} type="file" accept=".docx" multiple onChange={onFile} style={{ display: "none" }} />
            <span style={{ color: P.faint, fontSize: 13 }}>{t.orPaste}</span>
            {html && (
              <span style={{ color: P.green, fontSize: 12, fontWeight: 700, background: P.greenSoft, padding: "4px 11px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Icon name="check" size={12} /> {t.docView}
              </span>
            )}
          </div>

          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t.textPh} rows={12} className="yyc-input" style={{ marginTop: 14, resize: "vertical", fontSize: 13, lineHeight: 1.6 }} />

          {aiBanner}
          {errMsg && <div style={{ color: P.red, fontSize: 13, marginTop: 10, fontWeight: 600 }}>{errMsg}</div>}

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
                    <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: done ? P.green : activeNow ? P.maroon : P.faint }}>
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
          <div style={{ display: "flex", gap: 8 }}>
            <button className="yyc-btn-secondary" onClick={() => importRef.current?.click()} title={t.importKB}>
              <Icon name="upload" size={13} /> {t.importKB}
            </button>
            <input ref={importRef} type="file" accept=".json,application/json" onChange={importBackup} style={{ display: "none" }} />
            <button className="yyc-btn-secondary" onClick={exportBackup} title={t.exportKB}>
              <Icon name="download" size={13} /> {t.exportKB}
            </button>
            <button className="yyc-btn-primary" onClick={() => setMode("add")}>
              <Icon name="plus" size={14} /> {t.upload}
            </button>
          </div>
        )}
      </div>

      {errMsg && !editLeverRecord && !importPlan && (
        <div role="alert" style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", margin: "0 0 14px", padding: "10px 14px", borderRadius: 10, background: "#FDEDED", border: `1px solid rgba(154,0,0,0.25)`, color: P.red, fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
          <span>{errMsg}</span>
          <button className="yyc-icon-btn" onClick={() => setErrMsg("")} title={t.close} style={{ flexShrink: 0 }}><Icon name="close" size={12} /></button>
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
            <div style={{ flex: 1 }}>
              <div className="yyc-stat-label">{t.leverRecords}</div>
              <div className="yyc-stat-num">
                {leverFilter !== "all" ? `${leverCounts[leverFilter] || 0}/${totalRecords}` : totalRecords}
              </div>
            </div>
            <span style={{ fontSize: 11, color: P.faint, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3, maxWidth: "50%", textAlign: "right" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
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

          <select className="yyc-filter-select" value={mainCat} onChange={(e) => { setMainCat(e.target.value); setSubCat("all"); }}>
            <option value="all">{t.allMainCat}</option>
            {mainCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <select className="yyc-filter-select" style={{ gap: 100 }} value={subCat} onChange={(e) => setSubCat(e.target.value)} disabled={subCategories.length === 0}>
            <option value="all">{t.allSubCat}</option>
            {subCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          {anyFilterActive && (
            <button className="yyc-btn-secondary" onClick={clearAllFilters} style={{ padding: "8px 12px", fontSize: 12.5 }}>
              <Icon name="close" size={12} /> {t.clearFilters}
            </button>
          )}
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
            {Object.entries(groupedLevers).map(([docId, records]) => {
              const meta = index.find((d) => d.id === docId);
              const { main, sub } = meta ? docMeta(meta) : { main: "General", sub: "" };
              return (
                <div key={docId} className="yyc-lever-group">
                  <div className="yyc-lever-group-head">
                    <Icon name="book" size={14} color={P.maroon} />
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
          {filteredIndex.map((d, i) => {
            const tc = TYPE_COLORS[d.doc_type] || TYPE_COLORS.notes;
            const lc = leverCount(d.id);
            const { main, sub } = docMeta(d);
            return (
              <div
                key={d.id}
                className="yyc-doc"
                onMouseEnter={() => window.db?.warmDocuments([d.id])}
                role="button"
                tabIndex={0}
                style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                onClick={() => openPreview(d.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPreview(d.id); }
                }}
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
                  <div className="yyc-doc-title">{d.title}</div>
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
                      <button className="yyc-icon-btn" onClick={() => startEdit(d.id)} title={t.edit}><Icon name="edit" size={13} /></button>
                      <button className="yyc-icon-btn is-danger" onClick={() => deleteDoc(d.id)} title={t.del}><Icon name="trash" size={13} /></button>
                    </div>
                  )}
                </div>
              </div>
            );
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
                <div style={{ fontSize: 11, fontWeight: 700, color: P.crimson, letterSpacing: ".08em", textTransform: "uppercase" }}>{t.levers[editLeverRecord.lever] || editLeverRecord.lever}</div>
                <h2 style={{ margin: "4px 0 0", fontSize: 21, letterSpacing: "-.02em", color: "#4a0707", fontWeight: "bolder"}}>{t.editTitle}</h2>
              </div>
              <button className="yyc-icon-btn" onClick={() => setEditLeverRecord(null)} disabled={busy} title={t.cancel}><Icon name="close" size={13} /></button>
            </div>
            <label style={S.label}>Lever</label>
            <select className="yyc-input" value={editLeverRecord.lever || "price"} onChange={(e) => setEditLeverRecord((r) => ({ ...r, lever: e.target.value }))}>
              {leverKeys.map((lever) => <option key={lever} value={lever}>{t.levers[lever]}</option>)}
            </select>
            {editLeverRecord.lever === "others" && (<>
              <label className="yyc-edit-record-field" style={S.label}>{t.otherCat}</label>
              <select className="yyc-input" value={OTHER_CATS.includes(editLeverRecord.other_category) ? editLeverRecord.other_category : "uncategorized"} onChange={(e) => setEditLeverRecord((r) => ({ ...r, other_category: e.target.value }))}>
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
            {errMsg && <div style={{ color: P.red, fontSize: 12.5, marginTop: 12 }}>{errMsg}</div>}
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

function ChatPanel({ t, lang, index, levers, openPreview, msgs, setMsgs }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState(null);   // {query} while "@…" is being typed
  const [mIdx, setMIdx] = useState(0);
  const [taggedDocs, setTaggedDocs] = useState([]); // [{id,title}] forced into retrieval
  const inputElRef = useRef(null);
  const [sugg, setSugg] = useState(null);
  const [suggBusy, setSuggBusy] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const bottomRef = useRef(null);
  const searchDocsCacheRef = useRef({ fp: "", at: 0, docs: [] });

  useEffect(() => {
    (async () => {
      const seen = await sget("ui:hint-seen", false);
      if (!seen) setShowHint(true);
    })();
  }, []);

  useEffect(() => {
    if (index.length > 0 && window.innerWidth >= 900) {
      inputElRef.current?.focus();
    }
  }, []);

  // the first question reads every document: fetch them in the background as soon as the chat opens (remote storage only)
  useEffect(() => { window.db?.warmDocuments(index.map((d) => d.id)); }, [index]);

  const dismissHint = () => {
    setShowHint(false);
    sset("ui:hint-seen", true, false).catch(() => { });
  };

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
      } catch { }
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

  const send = async (forcedText) => {
    const question = (typeof forcedText === "string" ? forcedText : q).trim();
    if (!question || busy) return;
    setQ("");
    if (isSmallTalk(question)) {
      setMsgs((m) => [...m, { role: "user", text: question }, { role: "ai", text: t.greetReply }]);
      return; // no retrieval, no API call, no Gap Log entry
    }
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      const history = msgs.slice(-4)
        .map((m, k, arr) => `${m.role === "user" ? "Q" : "A"}: ${(m.text || "").slice(0, k === arr.length - 1 ? 900 : 300)}`).join("\n");
      // Synonym/keyword expansion runs while the documents load; it falls back to [] so a failure never blocks the search.
      const kwPromise = expandQuery(question, history);
      // Reuse the corpus briefly so follow-up questions avoid rereading every document.
      const docsFp = index.map((d) => d.id).sort().join(",");
      let docs = searchDocsCacheRef.current.docs;
      if (searchDocsCacheRef.current.fp !== docsFp || Date.now() - searchDocsCacheRef.current.at > 30000) {
        docs = await window.db.getDocuments(index.map((d) => d.id));
        searchDocsCacheRef.current = { fp: docsFp, at: Date.now(), docs, chunks: docs.flatMap((doc) => chunkDocument(doc)) };
      }
      const chunks = searchDocsCacheRef.current.chunks || [];
      const kw = await kwPromise;
      const kwText = kw.join(" ");
      const qTerms = tokenizeQuery(`${question} ${kwText}`);
      console.info("[search] expanded with:", kw);
      const docById = new Map(docs.map((doc) => [doc.id, doc]));
      const docText = (doc) => [doc.title, doc.industry, doc.problem_signature,
        (doc.sections || []).map((s) => `${s.heading} ${s.summary_en || ""} ${s.summary_zh || ""}`).join(" "),
        doc.full_text].filter(Boolean).join(" ");
      /* rank paragraphs (chunks), not whole documents: max 3 chunks per document, 12 overall, then group them by document */
      const rankedChunks = bm25Rank(question, chunks, (c) => `${c.title} ${c.industry || ""} ${c.heading} ${c.text}`, kwText);
      const perDocCount = new Map();
      const pickedChunks = [];
      for (const { item, score } of rankedChunks) {
        if (pickedChunks.length >= 12) break;
        const n = perDocCount.get(item.doc_id) || 0;
        if (n >= 3 || !docById.has(item.doc_id)) continue;
        perDocCount.set(item.doc_id, n + 1);
        pickedChunks.push({ ...item, score });
      }
      const chunksByDoc = new Map();
      pickedChunks.forEach((c) => chunksByDoc.set(c.doc_id, [...(chunksByDoc.get(c.doc_id) || []), c]));
      let scored = [...chunksByDoc.keys()].map((id) => ({ doc: docById.get(id), score: Math.max(...chunksByDoc.get(id).map((c) => c.score)) }))
        .sort((a, b) => b.score - a.score);
      // no usable chunks (e.g. documents without full text): fall back to ranking whole documents
      if (!scored.length) scored = bm25Rank(question, docs, docText, kwText).map(({ item: doc, score }) => ({ doc, score }));
      const recordPool = (levers || []).filter((r) => docById.has(r.doc_id));
      const rankedRecords = bm25Rank(question, recordPool, (r) => {
        const meta = docById.get(r.doc_id);
        return [r.lever, r.other_category, r.claim_en, r.claim_zh, r.quote, r.impact, r.section, meta?.title, meta?.industry].filter(Boolean).join(" ");
      }, kwText);
      const requestedCount = question.match(/\b(?:top|first|show|give|provide|list)(?:\s+me)?\s+(\d{1,2})\b/i)
        || question.match(/\b(\d{1,2})\s+(?:\w+\s+)?(?:examples?|strateg(?:y|ies)|levers?|ideas?)\b/i);
      const resultLimit = requestedCount ? Math.min(20, Number(requestedCount[1])) : 10;
      const exampleIntent = /\b(example|examples|lever|strateg(?:y|ies)|volume)\b/i.test(question);
      const selectedRecords = rankedRecords.slice(0, resultLimit).map(({ item, score }) => ({ ...item, _score: score }));

      const activeTagIds = taggedDocs.filter((td) => question.includes(td.title)).map((td) => td.id);
      const forced = docs.filter((doc) => activeTagIds.includes(doc.id)).map((doc) => ({ doc, score: Infinity }));
      const rest = scored
        .filter((s) => !activeTagIds.includes(s.doc.id))
        .slice(0, 6);
      const recordDocs = exampleIntent ? selectedRecords.map((r) => docById.get(r.doc_id)).filter(Boolean) : [];
      const ranked = [...forced, ...rest, ...recordDocs.map((doc) => ({ doc, score: 0 }))]
        .filter((entry, i, all) => all.findIndex((other) => other.doc.id === entry.doc.id) === i)
        .slice(0, 8);
      setTaggedDocs([]);

      const passagesFor = (fullText, terms, maxChars) => {
        const low = (fullText || "").toLowerCase();
        const spans = [];
        terms.forEach((w) => {
          let pos = low.indexOf(w);
          let guard = 0;
          while (pos !== -1 && guard < 5) {
            spans.push([Math.max(0, pos - 400), Math.min(fullText.length, pos + 500)]);
            pos = low.indexOf(w, pos + w.length);
            guard++;
          }
        });
        if (!spans.length) return (fullText || "").slice(0, maxChars);
        spans.sort((a, b) => a[0] - b[0]);
        const merged = [spans[0]];
        for (let k = 1; k < spans.length; k++) {
          const last = merged[merged.length - 1];
          if (spans[k][0] <= last[1] + 100) last[1] = Math.max(last[1], spans[k][1]);
          else merged.push(spans[k]);
        }
        let out = "";
        for (const [a, b] of merged) {
          if (out.length >= maxChars) break;
          out += (out ? "\n[…]\n" : "") + fullText.slice(a, Math.min(b, a + (maxChars - out.length)));
        }
        return out;
      };

      let charBudget = 11000;
      const ctxParts = ranked.map(({ doc: d }) => {
        const sec = (d.sections || []).slice(0, 6)
          .map((s) => `  - ${s.heading}: ${(s.summary_en || "").slice(0, 160)}`).join("\n");
        /* curated lever records for this doc — highest signal per character */
        const docRecords = exampleIntent ? selectedRecords.filter((r) => r.doc_id === d.id) : (levers || []).filter((r) => r.doc_id === d.id).slice(0, 5);
        const recs = docRecords
          .map((r) => `  * [${r.lever}${r.other_category ? "/" + r.other_category : ""}] ${r.claim_en || r.claim_zh || ""}${impactOf(r) && impactOf(r) !== "N/A" ? ` (Actual impact: ${impactOf(r)})` : ""}`).join("\n");
        const header = `### DOC id=${d.id} | title=${d.title} | type=${d.doc_type} | industry=${d.industry}`;
        const overhead = header.length + sec.length + recs.length + 60;
        const room = Math.max(0, charBudget - overhead);
        /* the best-matching paragraphs of this document, in reading order; whole chunks only (tagged / chunk-less docs use keyword snippets) */
        let body = "";
        for (const c of [...(chunksByDoc.get(d.id) || [])].sort((a, b) => a.pos - b.pos)) {
          const piece = `${c.heading ? `[${c.heading}] ` : ""}${c.text}`;
          if (body.length + piece.length + 6 > Math.min(2600, room)) break;
          body += (body ? "\n[…]\n" : "") + piece;
        }
        if (!body) body = passagesFor(d.full_text || "", qTerms, Math.min(1300, room));
        charBudget -= overhead + body.length;
        return `${header}\nSections:\n${sec}${recs ? `\nKey lever strategies:\n${recs}` : ""}\nText:\n${body}`;
      });
      const matchedRecordsContext = exampleIntent ? selectedRecords.map((r, i) => {
        const meta = docById.get(r.doc_id);
        return `[R${i + 1}] [doc_id=${r.doc_id}; source=${meta?.title || "Unknown"}; lever=${r.lever}${r.other_category ? `/${r.other_category}` : ""}] ${r.claim_en || r.claim_zh || r.quote || ""}${impactOf(r) && impactOf(r) !== "N/A" ? ` (Actual impact: ${impactOf(r)})` : ""}`;
      }).join("\n") : "";
      /* answer language is decided by the words OUTSIDE @-tagged titles — a long
         English doc title must not drag a Chinese instruction into an English answer */
      const qOutsideTags = taggedDocs.reduce(
        (acc, td) => acc.split("@" + td.title).join(" ").split(td.title).join(" "),
        question
      );
      // [ZH disabled for now - English only] original: answerLang was Simplified Chinese whenever the question contained CJK characters
      void qOutsideTags;
      const answerLang = "English";

      const prompt = `You are the closed-book Q&A engine of YYC's internal advisory knowledge base. You may ONLY use the documents below. You must NOT use any external or general knowledge, even if you know the answer.

Return ONLY a JSON object, no fences:
{"answerable": true|false, "answer": "<the answer, or empty string if not answerable>", "citations": [{"doc_id": "<id>", "section": "<section heading used>"}], "evidence": [{"doc_id": "<id>", "section": "<section heading>", "passage": "<short VERBATIM quote copied exactly from the documents, max 30 words>", "relevance": <0-100>}], "closest": {"doc_id": "<id>", "relevance": <0-100>, "reason": "<one short line>"} | null}

Rules:
- If the documents do not contain enough information to answer, set answerable=false. Never guess, never pad with general knowledge.
- Treat keyword-style queries as valid questions: a fragment like "volume in Build-A-Bear" or "Gymshark 价格" means "summarize everything the documents say about that topic for that company". Do not refuse a query just because it is not phrased as a full sentence.
- PARTIAL ANSWERS: if the documents contain relevant information that addresses the question or its underlying concern, even without the question's exact wording (e.g. the question asks whether something is "mandatory" but the documents describe what a company did and why), set answerable=true. State what the documents say and clearly note anything they do not state. Set answerable=false only when nothing in the documents is relevant.
- Formatting: put each bullet on its own line starting with "- " using real line breaks. Never write the two characters backslash and n as text.
- When a bullet is based on a MATCHED LEVER RECORD, end that bullet with the record's tag exactly as shown, e.g. [R3]. Use only tags that appear in the list.
- evidence.passage must be copied verbatim from the DOCUMENTS text. For list answers built from MATCHED LEVER RECORDS, leave passage as an empty string.
- "@DocumentTitle" in the question marks documents the advisor explicitly wants used — prioritise those documents when answering.
- Every claim in the answer must come from the documents. Cite every document you used.
- evidence: 1-4 items when answerable — the exact passages that support the answer, quoted verbatim; relevance = how strongly that passage answers the question (0-100). Never fabricate a passage.
- closest: when answerable=false, set it to the single most related document with its relevance (0-100) and a short reason in the question's language; when answerable=true set it to null.
- ANSWER LANGUAGE: ${answerLang}. Mandatory — write the ENTIRE answer in ${answerLang}, regardless of the documents' language or any @DocumentTitle text in the question (titles are references, not language signals).
- Be concise and practical — the reader is a YYC advisor preparing for a client conversation.
- For requests for examples, strategies, or levers, list up to ${resultLimit} distinct matching lever records when that many are present in the retrieved records. Use one bullet per record and include its source document title. Do not stop after two examples. If fewer are available, return all available matching records.
- If it's a greeting message like 'hi', 'hello', 'how are you', reply in short like 'Hi! How can I help you?'
- Treat keyword-style queries as valid questions: a fragment like "volume in Build-A-Bear" or "Gymshark 价格" means "summarize everything the documents say about that topic for that company". Do not refuse a query just because it is not phrased as a full sentence.

RECENT CONVERSATION:
${history || "(none)"}

DOCUMENTS:
${ctxParts.join("\n\n")}

MATCHED LEVER RECORDS (BM25-ranked across the full knowledge base; use these for example/lever requests):
${matchedRecordsContext || "(none)"}

QUESTION: ${question}`;

      const j = await askAI(prompt, 2500);
      const titleOf = (id) => index.find((d) => d.id === id)?.title || null;
      const retrieved = ranked.map(({ doc, score }) => ({ doc_id: doc.id, title: doc.title, score: Number.isFinite(score) ? Number(score.toFixed(3)) : null }));
      if (!j.answerable) {
        const closest = j.closest && titleOf(j.closest.doc_id)
          ? { ...j.closest, doc_title: titleOf(j.closest.doc_id) }
          : null;
        setMsgs((m) => [...m, { role: "ai", refused: true, text: t.refused, closest, retrieved }]);
        await window.db.gapAdd(question);
      } else {
        const cits = (j.citations || [])
          .map((c) => {
            const meta = index.find((d) => d.id === c.doc_id);
            return meta ? { ...c, doc_title: meta.title } : null;
          })
          .filter(Boolean);
        /* a "quote" is shown only if it really occurs in that document; the model's own wording is not evidence */
        const squash = (s) => String(s || "").toLowerCase().replace(/[\s]+/g, " ").trim();
        const quoteIsReal = (e) => {
          const p = squash(e.passage);
          return p.length >= 8 && squash(docById.get(e.doc_id)?.full_text).includes(p);
        };
        const evidence = (j.evidence || [])
          .map((e) => (titleOf(e.doc_id) ? { ...e, passage: quoteIsReal(e) ? e.passage : "", doc_title: titleOf(e.doc_id), relevance: Math.max(0, Math.min(100, Number(e.relevance) || 0)) } : null))
          .filter(Boolean)
          .slice(0, 4);
        /* some replies arrive with line breaks written as the literal characters \n */
        const rawAnswer = String(j.answer || "").replace(/\\r\\n|\\n/g, "\n");
        /* list answers: point each bullet's reference at the exact lever record; bullets that cannot be linked keep the section-level reference */
        const linked = linkBulletsToRecords(rawAnswer, exampleIntent ? selectedRecords : []);
        const answerText = linked.text;
        let finalCits = cits;
        let finalEvidence = evidence;
        /* "Why this answer" rows for list answers come from the records themselves (not from what the model chooses to report):
           match % = this record's search score relative to the best-scoring record */
        const topScore = Math.max(0, ...selectedRecords.map((r) => r._score || 0));
        const recordRow = (r) => ({
          doc_id: r.doc_id, record_id: r.id, section: r.section || "", doc_title: titleOf(r.doc_id),
          passage: String(r.claim_en || r.claim_zh || "").replace(/\s+/g, " ").trim().slice(0, 220),
          relevance: topScore > 0 ? Math.max(1, Math.min(100, Math.round((100 * (r._score || 0)) / topScore))) : 0,
        });
        if (exampleIntent) {
          const rows = (linked.records.length ? linked.records : selectedRecords.slice(0, 4)).filter((r) => titleOf(r.doc_id));
          const seenRow = new Set();
          const recordRows = rows.filter((r) => !seenRow.has(r.id) && seenRow.add(r.id)).map(recordRow);
          if (recordRows.length) finalEvidence = recordRows;
        }
        if (linked.records.length) {
          const claimLabel = (r) => {
            const name = splitClaim(r.claim_en || r.claim_zh || "").name || String(r.claim_en || r.claim_zh || "").split(/\s+/).slice(0, 7).join(" ");
            return name.length > 52 ? `${name.slice(0, 50)}…` : name;
          };
          const seen = new Set();
          const recCits = linked.records
            .filter((r) => !seen.has(r.id) && seen.add(r.id) && titleOf(r.doc_id))
            .map((r) => ({ doc_id: r.doc_id, record_id: r.id, section: r.section || "", doc_title: titleOf(r.doc_id), claim: claimLabel(r) }));
          const covered = new Set(recCits.map((c) => c.doc_id));
          finalCits = [...recCits, ...cits.filter((c) => !covered.has(c.doc_id))];
        }
        setMsgs((m) => [...m, { role: "ai", text: answerText, citations: finalCits, evidence: finalEvidence, retrieved }]);
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: "ai", refused: true, text: describeAIError(e, t) }]);
    }
    setBusy(false);
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
        <div style={{ color: P.red, fontSize: 13, marginBottom: 14, fontWeight: 600 }}>{t.noDocsChat}</div>
      )}

      <div className="yyc-chat-wrap">
        <div className="yyc-chat-scroll">
          {msgs.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", height: "100%", color: P.faint, textAlign: "left", padding: 20 }}>
              <div style={{ width: 60, height: 60, borderRadius: 18, background: P.crimsonSoft, color: P.crimson, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
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
                    <div style={{ fontSize: 12.5, color: P.faint, marginTop: 8, fontStyle: "italic" }}>{t.loadingSuggestions}</div>
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
                        {" — "}{m.closest.relevance}% · {t.belowThresholdNote}
                        {m.closest.reason ? <div style={{ color: P.sub, marginTop: 3 }}>{m.closest.reason}</div> : null}
                      </div>
                    )}
                  </div>
                  {m.citations?.length > 0 && (
                    <div className="yyc-cites">
                      <span className="yyc-cites-label">{t.refs}:</span>
                      {m.citations.map((c, j) => (
                        <button key={j} className="yyc-cite-btn" title={c.claim || undefined} onClick={() => openPreview(c.doc_id, c.section, c.record_id)}>
                          <Icon name="file" size={11} />
                          {c.doc_title}{c.section ? ` · ${c.section}` : ""}{c.claim ? ` · ${c.claim}` : ""}
                        </button>
                      ))}
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
          <button className="yyc-btn-primary" onClick={send} disabled={busy || !q.trim() || index.length === 0} style={{ padding: "11px 22px" }}>
            {t.send}
          </button>
        </div>
      </div>
    </div>
  );
}

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
function LeverManagerModal({ t, config, setConfig, setConfirm, setAdminLocked, flash, refreshKB, onClose }) {
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
            <div style={{ fontSize: 11, color: P.crimson, fontWeight: 750, letterSpacing: ".08em", textTransform: "uppercase" }}>Admin settings</div>
            <h2 style={{ margin: "4px 0 0", fontSize: 20, color: "#4a0707", fontWeight: "bolder" }}>Lever Categories</h2>
          </div>
          <button className="yyc-icon-btn" onClick={onClose} disabled={busy} title={t.close}><Icon name="close" size={13} /></button>
        </div>
        <div style={{ display: "flex", gap: 8, margin: "16px 0 4px" }}>
          {tabBtn("edit", "Edit existing")}
          {tabBtn("create", "Create new")}
        </div>

        {tab === "edit" && (<>
          <MgrField label="Lever">
            <select className="yyc-input" value={target} onChange={(e) => pick(e.target.value)}>
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
                <select className="yyc-input" value={subId} onChange={(e) => pickSub(e.target.value)}>
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

        {errMsg && <div style={{ color: P.red, fontSize: 12.5, marginTop: 12 }}>{errMsg}</div>}
      </div>
    </div>
  );
}

function ExplorerPanel({ t, lang, levers, index, openPreview, isAdmin, config, setConfig, setConfirm, setAdminLocked, flash, refreshKB }) {
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
            <button key={l} onClick={() => { setSel(l); setOc("all"); }}
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
                color: active ? "#fff" : n ? P.goldDark : P.faint,
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
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="yyc-input" style={{ width: "auto", padding: "8px 12px", fontSize: 13 }}>
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
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 14.5, fontWeight: 750, color: P.maroon, textAlign: "left" }}>
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
                  <div style={{ fontSize: 13.5, lineHeight: 1.6 }}><ClaimText text={r.claim_en || r.claim_zh} /></div>
                  <ImpactBox record={r} style={{ marginTop: 6 }} />
                  {r.section && (
                    <button onClick={() => openPreview(docId, r.section)}
                      style={{ background: "none", border: "none", padding: 0, marginTop: 5, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700, color: P.crimson, textDecoration: "underline" }}>
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

function GapPanel({ t, flash, setConfirm }) {
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
  if (log === null) return <div style={{ color: P.sub }}>…</div>;
  const shown = log;
  return (
    <div>
      <div className="yyc-section-head">
        <div>
          <h1 className="yyc-section-title">{t.tabs.gap}</h1>
          <div className="yyc-section-sub">{t.gapIntro}</div>
        </div>
        {shown.length > 0 && (
          <button className="yyc-btn-secondary" onClick={clear}><Icon name="trash" size={13} /> {t.clearGap}</button>
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
    </div>
  );
}

function PreviewModal({ t, lang, data, levers, onClose }) {
  const { doc, targetSection, targetRecordId } = data;
  const hasHtml = !!doc.html;
  const docLevers = sortByLever((levers || []).filter((l) => l.doc_id === doc.id));
  /* a reference to one lever record opens the Lever records tab on that record (if it still exists); otherwise the old section behaviour */
  const hasTargetRecord = !!targetRecordId && docLevers.some((l) => l.id === targetRecordId);
  const [view, setView] = useState(hasTargetRecord ? "levers" : targetSection ? "summary" : hasHtml ? "document" : "summary");
  const targetRef = useRef(null);

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
    <div className="yyc-modal-backdrop" onClick={onClose}>
      <div className="yyc-modal" style={{ width: 840, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="yyc-modal-head">
          <div style={{ minWidth: 200, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.01em", lineHeight: 1.3 }}>{doc.title}</div>
            <div style={{ fontSize: 12.5, color: P.sub, marginTop: 5, lineHeight: 1.5 }}>
              {T[lang].docTypes[doc.doc_type] || doc.doc_type} · {doc.industry}
              {doc.problem_signature ? ` · ${doc.problem_signature}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {tabs.length > 1 && (
              <div style={{ display: "flex", border: `1px solid ${P.lineDark}`, borderRadius: 9, overflow: "hidden", background: P.card }}>
                {tabs.map(([k, label]) => (
                  <button
                    key={k} onClick={() => setView(k)}
                    style={{
                      padding: "7px 15px", fontSize: 12.5, fontWeight: 650,
                      background: view === k ? P.ink : "transparent",
                      color: view === k ? "#fff" : P.sub,
                      border: "none", cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <button className="yyc-icon-btn" onClick={onClose} style={{ width: 32, height: 32 }}><Icon name="close" size={14} /></button>
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: view === "document" ? "28px 26px" : "20px 26px" }}>
          {view === "document" && hasHtml ? (
            <div style={{ background: P.card, borderRadius: 12, boxShadow: P.s2, maxWidth: 680, margin: "0 auto", padding: "40px 46px" }}>
              <style>{`
                .yyc-docview h1 { font-size: 22px; font-weight: 800; margin: 18px 0 10px; line-height: 1.3; }
                .yyc-docview h2 { font-size: 18px; font-weight: 750; margin: 16px 0 8px; line-height: 1.3; color: ${P.maroon}; }
                .yyc-docview h3 { font-size: 15.5px; font-weight: 700; margin: 14px 0 6px; }
                .yyc-docview p { font-size: 14px; line-height: 1.75; margin: 0 0 10px; }
                .yyc-docview ul, .yyc-docview ol { padding-left: 22px; margin: 0 0 10px; }
                .yyc-docview li { font-size: 14px; line-height: 1.7; margin-bottom: 3px; }
                .yyc-docview table { border-collapse: collapse; margin: 10px 0; width: 100%; }
                .yyc-docview td, .yyc-docview th { border: 1px solid ${P.lineDark}; padding: 6px 10px; font-size: 13px; }
                .yyc-docview strong { font-weight: 700; }
                .yyc-docview img { max-width: 100%; }
              `}</style>
              <div className="yyc-docview" dangerouslySetInnerHTML={{ __html: doc.html }} />
            </div>
          ) : view === "levers" ? (
            docLevers.map((r, i) => (
              <div key={r.id || i} ref={hasTargetRecord && r.id === targetRecordId ? targetRef : null}
                style={{ ...S.card, padding: "16px 18px", marginBottom: 10, ...(hasTargetRecord && r.id === targetRecordId ? { background: P.goldSoft, border: `1px solid ${P.gold}`, borderLeft: `3px solid ${P.gold}` } : null) }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ background: P.goldSoft, color: P.goldDark, border: `1px solid rgba(184,134,11,0.4)`, fontSize: 11, fontWeight: 750, padding: "4px 11px", whiteSpace: "nowrap", borderRadius: 999 }}>
                    {leverTag(t, r)}
                  </span>
                  <div style={{ flex: 1 }}>
                    {r.lever === "others" && r.related_to && (
                      <div style={{ fontSize: 12, color: P.sub, marginBottom: 4 }}>{t.relatedTo}: <b style={{ color: P.ink }}>{r.related_to}</b></div>
                    )}
                    <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                      <ClaimText text={r.claim_en || r.claim_zh} />
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
                  <div style={{ fontWeight: 750, fontSize: 13, color: P.maroon, margin: "22px 0 10px", textTransform: "uppercase", letterSpacing: ".04em" }}>
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
