// The stylesheet for the whole app.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { P, S, btnG, btnP } from "../theme.js";

export function GlobalStyles() {
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
      .yyc-brand-sub { color: ${P.faint}; font-size: 12px; line-height: 1.3; margin-top: 1px; }
      .yyc-nav { display: flex; flex-direction: column; gap: 3px; flex: 1; }
      .yyc-nav-label { font-size: 11.5px; font-weight: 700; color: ${P.faint}; text-transform: uppercase; letter-spacing: 0.09em; padding: 0 10px 8px; }
      .yyc-nav-item { display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 9px 11px; border-radius: 10px; background: transparent; border: none; cursor: pointer; font-size: 13.5px; font-weight: 600; color: ${P.sub}; text-align: left; font-family: inherit; transition: background .15s, color .15s; position: relative; }
      .yyc-nav-item:hover { background: ${P.wash}; color: ${P.ink}; }
      .yyc-nav-item.is-active { background: ${P.crimsonSoft}; color: ${P.crimsonText}; font-weight: 700; }
      .yyc-nav-item.is-active::before { content: ""; position: absolute; left: -14px; top: 8px; bottom: 8px; width: 3px; background: ${P.crimson}; border-radius: 0 3px 3px 0; }
      .yyc-sidebar-foot { padding-top: 16px; border-top: 1px solid ${P.line}; margin-top: 16px; display: flex; flex-direction: column; gap: 8px; }
      .yyc-lang { display: flex; border: 1px solid ${P.lineDark}; border-radius: 8px; overflow: hidden; background: ${P.card}; }
      .yyc-lang-btn { flex: 1; padding: 6px 8px; font-size: 12px; font-weight: 650; background: transparent; color: ${P.sub}; border: none; cursor: pointer; font-family: inherit; }
      .yyc-lang-btn:hover { background: ${P.wash}; }
      .yyc-lang-btn.is-active { background: ${P.ink}; color: ${P.paper}; }
      .yyc-admin-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; border-radius: 8px; border: 1px solid ${P.lineDark}; background: ${P.card}; color: ${P.sub}; font-size: 12.5px; font-weight: 650; cursor: pointer; font-family: inherit; }
      .yyc-profile-btn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 10px; border: 1px solid ${P.lineDark}; background: ${P.card}; color: ${P.ink}; cursor: pointer; font-family: inherit; text-align: left; }
      .yyc-profile-btn:hover:not(:disabled) { background: ${P.wash}; border-color: ${P.ink}; }
      .yyc-profile-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .yyc-profile-compact { width: auto; padding: 3px; border-radius: 999px; }
      .yyc-avatar { width: 30px; height: 30px; border-radius: 50%; background: ${P.maroon}; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; flex-shrink: 0; }
      .yyc-admin-btn:hover { background: ${P.wash}; border-color: ${P.ink}; color: ${P.ink}; }
      .yyc-admin-btn.is-on { background: ${P.maroon}; border-color: ${P.maroonText}; color: #fff; }
      .yyc-foot-note { font-size: 11.5px; color: ${P.faint}; line-height: 1.5; padding: 0 4px; }
      .yyc-main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: ${P.paper}; }
      .yyc-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; background: var(--glass); backdrop-filter: blur(10px); border-bottom: 1px solid ${P.line}; position: sticky; top: 3px; z-index: 30; }
      @media (min-width: 900px) { .yyc-topbar { display: none; } }
      .yyc-topbar .yyc-brand { padding: 0; }
      .yyc-topbar-actions { display: flex; align-items: center; gap: 8px; }
      .yyc-topbar-actions .yyc-lang { width: 84px; }
      .yyc-content { flex: 1; padding: 26px 28px; max-width: 1360px; width: 100%; margin: 0 auto; }
      .yyc-fade { animation: yycFadeUp .3s ease-out; } /* replays whenever a hidden panel is shown again (display none → block) */
      @media (min-width: 900px) { .yyc-content { padding: 30px 36px; } }
      @media (max-width: 899px) { .yyc-content { padding: 18px 16px 90px; } }
      @keyframes yycFadeUp { from { transform: translateY(8px); } to { transform: translateY(0); } }
      @keyframes yycPopIn { from { transform: scale(.97); } to { transform: scale(1); } }
      @keyframes yycFade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes yycSpin { to { transform: rotate(360deg); } }
      @keyframes yycToastIn { from { opacity: 0; transform: translateY(12px) scale(.97); } to { opacity: 1; transform: none; } }
      @keyframes yycToastOut { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-10px) scale(.97); } }
      @keyframes yycDot { 0%, 80%, 100% { opacity: .3; transform: scale(.8); } 40% { opacity: 1; transform: scale(1); } }
      .yyc-botnav { display: flex; position: fixed; left: 0; right: 0; bottom: 0; background: var(--glass); backdrop-filter: blur(12px); border-top: 1px solid ${P.line}; padding: 6px 4px calc(8px + env(safe-area-inset-bottom)); z-index: 40; }
      @media (min-width: 900px) { .yyc-botnav { display: none; } }
      .yyc-botnav-item { flex: 1; min-width: 0; min-height: 52px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 6px 2px; background: transparent; border: none; border-radius: 10px; cursor: pointer; font-family: inherit; font-size: 11.5px; font-weight: 650; line-height: 1.15; text-align: center; color: ${P.sub}; }
      .yyc-nav-badge { margin-left: auto; min-width: 22px; padding: 2px 7px; border-radius: 999px; background: ${P.crimson}; color: var(--on-fill); font-size: 12px; font-weight: 800; line-height: 1.3; text-align: center; }
      .yyc-botnav-item { position: relative; }
      .yyc-botnav-item .yyc-nav-badge { position: absolute; top: 2px; right: 18%; margin: 0; min-width: 20px; padding: 1px 6px; }
      .yyc-botnav-item span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .yyc-botnav-item.is-active { color: ${P.crimsonText}; background: ${P.crimsonSoft}; }
      .yyc-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px 20px; flex-wrap: wrap; margin-bottom: 22px; padding-bottom: 18px; border-bottom: 1px solid ${P.line}; }
      .yyc-section-head > div:first-child { min-width: 0; flex: 1 1 320px; }
      .yyc-section-title { position: relative; margin: 0; padding-left: 18px; font-size: clamp(1.625rem, 1.2rem + 1.7vw, 2.375rem); font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; color: ${P.title}; text-wrap: balance; overflow-wrap: anywhere; }
      .yyc-section-title::before { content: ""; position: absolute; left: 0; top: 0.1em; bottom: 0.1em; width: 6px; border-radius: 999px; background: linear-gradient(180deg, ${P.crimson} 0%, ${P.maroon} 55%, ${P.gold} 100%); }
      .yyc-section-sub { color: ${P.sub}; font-size: 15px; margin-top: 10px; padding-left: 18px; line-height: 1.55; max-width: min(100%, 90ch); }
      .yyc-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px; }
      .yyc-stat { position: relative; background: ${P.card}; border: 1px solid ${P.line}; border-radius: 14px; padding: 16px 18px; box-shadow: ${P.s1}; overflow: hidden; }
      .yyc-stat::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: ${P.crimson}; }
      .yyc-stat.is-gold::before { background: ${P.gold}; }
      .yyc-stat.is-green::before { background: ${P.green}; }
      .yyc-stat-inner { display: flex; align-items: center; gap: 12px; min-height: 44px; }
      .yyc-stat.is-clickable { cursor: pointer; transition: box-shadow .15s, transform .15s; }
      .yyc-stat.is-clickable:hover, .yyc-stat.is-clickable:focus-visible { box-shadow: ${P.s2}; transform: translateY(-1px); outline: none; }
      .yyc-stat-icon { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .yyc-stat-icon.is-red { background: ${P.crimsonSoft}; color: ${P.crimsonText}; }
      .yyc-stat-icon.is-gold { background: ${P.goldSoft}; color: ${P.goldText}; }
      .yyc-stat-icon.is-green { background: ${P.greenSoft}; color: ${P.greenText}; }
      .yyc-stat-label { font-size: 11.5px; color: ${P.sub}; font-weight: 650; letter-spacing: .00em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .yyc-stat-num { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1; margin-top: 3px; white-space: nowrap; } /* a figure like 378/379 never breaks across lines */
      .yyc-toolbar { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
      .yyc-search { position: relative; flex: 1; min-width: 220px; max-width: 380px; }
      .yyc-search input { padding-left: 38px !important; }
      .yyc-search-icon { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: ${P.faint}; pointer-events: none; }
      .yyc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
      .yyc-doc { background: ${P.card}; border: 1px solid ${P.line}; border-radius: 14px; padding: 18px; cursor: pointer; box-shadow: ${P.s1}; display: flex; flex-direction: column; gap: 12px; transition: box-shadow .2s, transform .2s, border-color .2s; }
      .yyc-doc:hover { box-shadow: ${P.s3}; transform: translateY(-2px); border-color: ${P.lineDark}; }
      .yyc-doc:focus-visible { outline: none; box-shadow: ${P.focus}; border-color: ${P.crimsonText}; }
      .yyc-doc:focus-within .yyc-doc-actions { opacity: 1; }
      .yyc-doc-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .yyc-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; font-size: 12px; font-weight: 700; border-radius: 999px; text-wrap: nowrap; }
      .yyc-doc-title { font-size: 16px; font-weight: 750; line-height: 1.35; color: ${P.ink}; }
      .yyc-doc-sig { font-size: 13.5px; color: ${P.sub}; line-height: 1.55; }
      .yyc-doc-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 10px; border-top: 1px solid ${P.line}; }
      .yyc-lever-pill {
        display: inline-block;
        padding: 3px 10px;
        font-size: 11px;
        font-weight: 700;
        border-radius: 999px;
        background: ${P.goldSoft};
        color: ${P.goldText};
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
      .yyc-icon-btn.is-danger { border-color: rgba(180,35,24,0.35); color: ${P.redText}; }
      .yyc-icon-btn.is-danger:hover { background: ${P.redSoft}; border-color: ${P.redText}; }
      .yyc-empty { background: ${P.card}; border: 1px dashed ${P.lineDark}; border-radius: 14px; padding: 56px 32px; text-align: center; color: ${P.sub}; font-size: 13.5px; line-height: 1.6; }
      .yyc-empty-icon { width: 52px; height: 52px; border-radius: 14px; background: ${P.wash}; color: ${P.faint}; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; }
      .yyc-chip-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
      .yyc-chip-row-label { font-size: 11px; font-weight: 700; color: ${P.faint}; text-transform: uppercase; letter-spacing: .06em; margin-right: 4px; }
      .yyc-lever-chip { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; font-size: 12px; font-weight: 650; border-radius: 999px; border: 1px solid ${P.lineDark}; background: ${P.card}; color: ${P.sub}; cursor: pointer; font-family: inherit; transition: all .15s; }
      .yyc-lever-chip:hover:not(:disabled) { background: ${P.wash}; border-color: ${P.ink}; color: ${P.ink}; }
      .yyc-lever-chip.is-active { background: ${P.crimsonSoft}; border-color: ${P.crimsonText}; color: ${P.crimsonText}; }
      .yyc-lever-chip:disabled { opacity: 0.4; cursor: default; }
      .yyc-lever-chip-count { font-size: 10.5px; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: ${P.wash}; color: ${P.sub}; }
      .yyc-lever-chip.is-active .yyc-lever-chip-count { background: ${P.crimson}; color: #fff; }
      .yyc-filter-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      .yyc-filter-select { display: inline-flex; align-items: center; gap: 6px; border: 1px solid ${P.lineDark}; background: ${P.card}; color: ${P.ink}; padding: 8px 12px; border-radius: 9px; font-size: 12.5px; font-family: inherit; font-weight: 600; cursor: pointer; min-width: 150px; }
      .yyc-filter-select:focus { outline: none; border-color: ${P.crimsonText}; box-shadow: ${P.focus}; }
      .yyc-lever-group { margin-bottom: 24px; }
      .yyc-lever-group-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid ${P.line}; }
      .yyc-lever-group-title { font-size: 14px; font-weight: 750; color: ${P.ink}; }
      .yyc-lever-group-count { font-size: 11.5px; color: ${P.faint}; font-weight: 650; }
      .yyc-lever-record { background: ${P.card}; border: 1px solid ${P.line}; border-radius: 12px; padding: 16px 18px; cursor: pointer; box-shadow: ${P.s1}; transition: box-shadow .2s, border-color .2s, transform .15s; display: flex; flex-direction: column; gap: 9px; outline: none; }
      .yyc-lever-record:hover { box-shadow: ${P.s2}; border-color: ${P.goldText}; transform: translateY(-1px); }
      .yyc-lever-record:focus-visible { box-shadow: ${P.focus}; border-color: ${P.crimsonText}; }
      .yyc-lever-record-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      .yyc-lever-record-doc { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 650; color: ${P.sub}; }
      .yyc-lever-record-claim { font-size: 13.5px; line-height: 1.6; color: ${P.ink}; }
      .yyc-lever-record-quote { font-size: 12.5px; color: ${P.sub}; font-style: italic; line-height: 1.55; padding: 8px 12px; background: ${P.wash}; border-radius: 8px; border-left: 3px solid ${P.lineDark}; }
      .yyc-lever-record-meta { font-size: 11px; color: ${P.faint}; font-weight: 600; }
      .yyc-lever-record-hint { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: ${P.faint}; font-weight: 650; }
      .yyc-lever-record-chevron { transition: transform .15s, color .15s; }
      .yyc-lever-record:hover .yyc-lever-record-chevron { transform: translateX(2px); color: ${P.goldText}; }
      .yyc-lever-records-stack { display: grid; gap: 10px; }
      .yyc-lever-picker-list { display: grid; gap: 6px; margin-top: 4px; }
      .yyc-lever-picker-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 9px; border: 1px solid ${P.line}; background: ${P.card}; cursor: pointer; font-family: inherit; transition: all .15s; text-align: left; }
      .yyc-lever-picker-item:hover:not(:disabled) { border-color: ${P.goldText}; background: ${P.goldSoft}; transform: translateX(2px); }
      .yyc-lever-picker-item.is-active { border-color: ${P.crimsonText}; background: ${P.crimsonSoft}; }
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
      .yyc-why-toggle:hover { color: ${P.crimsonText}; }
      .yyc-ans-note { margin-top: 7px; padding: 7px 10px; border-radius: 8px; background: ${P.goldSoft}; border: 1px solid ${P.gold}; color: ${P.ink}; font-size: 12px; line-height: 1.5; }
      .yyc-fb { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 11.5px; color: ${P.faint}; }
      .yyc-fb button { background: none; border: 1px solid ${P.lineDark}; border-radius: 999px; padding: 2px 10px; font-family: inherit; font-size: 11.5px; color: ${P.sub}; cursor: pointer; }
      .yyc-fb button:hover { border-color: ${P.crimsonText}; color: ${P.crimsonText}; }
      .yyc-fb button.is-on { background: ${P.greenSoft}; border-color: ${P.greenText}; color: ${P.greenText}; }
      .yyc-fb button.is-on.is-down { background: ${P.redSoft}; border-color: ${P.redText}; color: ${P.redText}; }
      .yyc-why-panel { margin-top: 6px; border: 1px solid ${P.line}; border-left: 3px solid ${P.gold}; border-radius: 10px; background: ${P.card}; padding: 10px 12px; box-shadow: ${P.s1}; animation: yycFadeUp .2s ease-out; }
      .yyc-why-row { padding: 8px 8px; border-radius: 8px; cursor: pointer; transition: background .15s; }
      .yyc-why-row:hover { background: ${P.wash}; }
      .yyc-why-row + .yyc-why-row { border-top: 1px solid ${P.line}; }
      .yyc-why-row-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .yyc-why-doc { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 700; color: ${P.maroonText}; min-width: 0; }
      .yyc-why-pct { font-size: 11px; font-weight: 750; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .yyc-why-passage { font-size: 12.5px; color: ${P.ink}; font-style: italic; line-height: 1.55; margin-top: 4px; }
      .yyc-why-bar { height: 4px; border-radius: 999px; background: ${P.wash}; margin-top: 7px; overflow: hidden; }
      .yyc-why-bar > div { height: 100%; border-radius: 999px; transition: width .3s ease-out; }
      .yyc-why-checked { font-size: 11px; color: ${P.faint}; margin-top: 8px; padding: 6px 8px 0; border-top: 1px dashed ${P.line}; line-height: 1.5; }
      .yyc-why-doclink { background: none; border: none; padding: 0; font-family: inherit; font-size: inherit; font-weight: 700; color: ${P.maroonText}; text-decoration: underline; cursor: pointer; }
      .yyc-sugg-chip { display: block; width: 100%; max-width: 420px; text-align: left; padding: 10px 14px; margin-top: 8px; border: 1px solid ${P.lineDark}; background: ${P.card}; color: ${P.ink}; border-radius: 11px; font-family: inherit; font-size: 13px; font-weight: 550; cursor: pointer; transition: all .15s; box-shadow: ${P.s1}; }
      .yyc-sugg-chip:hover { border-color: ${P.crimsonText}; color: ${P.crimsonText}; background: ${P.crimsonSoft}; transform: translateY(-1px); }
      .yyc-kbar-overlay { position: fixed; inset: 0; background: var(--backdrop); z-index: 70; display: flex; align-items: flex-start; justify-content: center; padding: 12vh 16px 16px; }
      .yyc-kbar { width: 560px; max-width: 100%; background: ${P.card}; border: 1px solid ${P.lineDark}; border-radius: 14px; box-shadow: ${P.s2}; overflow: hidden; animation: yycFadeUp .15s ease-out; }
      .yyc-kbar-inputrow { display: flex; align-items: center; gap: 10px; padding: 13px 16px; border-bottom: 1px solid ${P.line}; }
      .yyc-kbar-input { flex: 1; border: none; outline: none; background: transparent; font-family: inherit; font-size: 14.5px; color: ${P.ink}; }
      .yyc-kbar-kbd { font-size: 10.5px; font-weight: 700; color: ${P.faint}; border: 1px solid ${P.lineDark}; border-radius: 5px; padding: 2px 6px; }
      .yyc-kbar-list { max-height: 340px; overflow-y: auto; padding: 6px; }
      .yyc-kbar-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: none; border: none; border-left: 3px solid transparent; border-radius: 8px; padding: 9px 10px; font-family: inherit; font-size: 13.5px; font-weight: 600; color: ${P.ink}; cursor: pointer; }
      .yyc-kbar-item.is-active { background: ${P.wash}; border-left-color: ${P.crimsonText}; }
      .yyc-kbar-badge { flex-shrink: 0; font-size: 10.5px; font-weight: 750; color: ${P.maroonText}; background: ${P.goldSoft}; border-radius: 999px; padding: 2px 9px; }
      .yyc-kbar-sub { color: ${P.faint}; font-weight: 500; font-size: 12.5px; }
      .yyc-kbar-empty { padding: 18px; font-size: 13px; color: ${P.faint}; text-align: center; }
      .yyc-mention-pop { position: absolute; bottom: calc(100% + 8px); left: 0; width: min(420px, 100%); background: ${P.card}; border: 1px solid ${P.lineDark}; border-radius: 12px; box-shadow: ${P.s2}; padding: 6px; z-index: 40; animation: yycFadeUp .12s ease-out; }
      .yyc-tag-row { position: absolute; bottom: calc(100% + 4px); right: 0; display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; max-width: 100%; }
      .yyc-tag-chip { display: inline-flex; align-items: center; gap: 5px; background: ${P.goldSoft}; color: ${P.maroonText}; border: 1px solid rgba(184,134,11,0.45); border-radius: 999px; padding: 3px 10px; font-size: 11.5px; font-weight: 700; }
      .yyc-tag-chip button { background: none; border: none; color: ${P.maroonText}; font-size: 13px; line-height: 1; cursor: pointer; padding: 0; }
      .yyc-cites-label { font-size: 11px; color: ${P.faint}; font-weight: 600; }
      .yyc-cite-btn { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; padding: 5px 11px; border: 1px solid rgba(184,134,11,0.4); background: ${P.goldSoft}; color: ${P.maroonText}; cursor: pointer; border-radius: 999px; font-weight: 650; font-family: inherit; transition: all .15s; }
      .yyc-cite-btn:hover { background: ${P.wash}; border-color: ${P.goldText}; transform: translateY(-1px); }
      .yyc-typing { display: inline-flex; align-items: center; gap: 4px; padding: 12px 16px; background: ${P.card}; border: 1px solid ${P.line}; border-left: 3px solid ${P.crimson}; border-radius: 4px 16px 16px 16px; box-shadow: ${P.s1}; }
      .yyc-typing span { width: 6px; height: 6px; border-radius: 50%; background: ${P.faint}; animation: yycDot 1.2s infinite; }
      .yyc-typing span:nth-child(2) { animation-delay: .15s; }
      .yyc-typing span:nth-child(3) { animation-delay: .3s; }
      .yyc-chat-input-wrap { border-top: 1px solid ${P.line}; padding: 14px 16px; background: ${P.card}; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      .yyc-chat-input-wrap > .yyc-tag-row { flex: 1 1 100%; }
      .yyc-chat-input { flex: 1 1 0; min-width: 0; }
      .yyc-send { flex: 0 0 auto; white-space: nowrap; }
      .yyc-send .yyc-send-icon { display: none; }
      .yyc-chat-input { flex: 1; border: 1px solid ${P.lineDark}; background: ${P.paper}; padding: 12px 16px; border-radius: 12px; font-size: 13.5px; font-family: inherit; color: ${P.ink}; outline: none; }
      .yyc-chat-input:focus { border-color: ${P.crimsonText}; background: ${P.card}; box-shadow: ${P.focus}; }
      .yyc-modal-backdrop { position: fixed; inset: 0; background: var(--backdrop); backdrop-filter: blur(4px); z-index: 55; display: flex; align-items: center; justify-content: center; padding: 16px; }
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
      .yyc-toasts { position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%); z-index: 70; display: flex; flex-direction: column; align-items: center; gap: 8px; width: max-content; max-width: calc(100vw - 32px); pointer-events: none; }
      .yyc-toast { pointer-events: auto; background: var(--toast-bg); color: var(--toast-ink); padding: 12px 22px; font-size: 13px; font-weight: 600; border-radius: 11px; box-shadow: ${P.s3}; display: inline-flex; align-items: center; gap: 10px; animation: yycToastIn .26s cubic-bezier(.2,.8,.3,1.1) both; font-family: inherit; }
      .yyc-toast.is-leaving { animation: yycToastOut .22s ease-in forwards; pointer-events: none; }
      .yyc-toast { max-width: min(560px, calc(100vw - 32px)); }
      .yyc-toast-msg { min-width: 0; overflow-wrap: anywhere; line-height: 1.45; }
      .yyc-toast.is-error { background: var(--red); color: var(--on-fill); align-items: flex-start; padding: 12px 10px 12px 18px; }
      .yyc-toast.is-error .yyc-toast-dot { background: var(--on-fill); box-shadow: 0 0 0 3px rgba(255,255,255,0.3); margin-top: 6px; flex-shrink: 0; }
      .yyc-toast-x { flex-shrink: 0; width: 44px; height: 44px; margin: -12px 0 -12px 0; display: inline-flex; align-items: center; justify-content: center; background: transparent; color: inherit; border: 0; border-radius: 10px; cursor: pointer; }
      .yyc-toast-x:hover { background: rgba(255,255,255,0.16); }
      .yyc-toast-dot { width: 6px; height: 6px; border-radius: 50%; background: ${P.green}; box-shadow: 0 0 0 3px rgba(14,124,74,0.25); }
      .yyc-btn-primary { ${Object.entries(btnP(false)).map(([k, v]) => `${k.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${v};`).join(" ")} ; border-radius: 20px; }
      .yyc-btn-primary, .yyc-btn-secondary { gap: 8px; }
      .yyc-head-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .yyc-btn-primary:hover:not(:disabled) { background: ${P.crimsonDark} !important; box-shadow: 0 3px 10px rgba(154,0,0,0.25) !important; }
      .yyc-btn-primary:active:not(:disabled) { transform: translateY(1px); }
      .yyc-btn-primary:disabled { cursor: default; }
      .yyc-btn-secondary { ${Object.entries(btnG).map(([k, v]) => `${k.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${v};`).join(" ")} ; border-radius: 20px; }
      .yyc-btn-secondary:hover { background: ${P.wash}; border-color: ${P.ink}; color: ${P.ink}; }
      .yyc-input { ${Object.entries(S.input).map(([k, v]) => `${k.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${v};`).join(" ")} ; border-radius: 10px ;}
      .yyc-input:focus { border-color: ${P.crimsonText}; box-shadow: ${P.focus}; }
      .yyc-edit-record-modal { max-height: calc(100vh - 32px); overflow-y: auto; }
      .yyc-edit-record-field { margin-top: 16px; }
      .yyc-edit-record-textarea { resize: none; min-height: 108px; line-height: 1.55; }
      .yyc-chat-scroll::-webkit-scrollbar, .yyc-content::-webkit-scrollbar, .yyc-sidebar::-webkit-scrollbar { width: 10px; }
      .yyc-chat-scroll::-webkit-scrollbar-thumb, .yyc-content::-webkit-scrollbar-thumb, .yyc-sidebar::-webkit-scrollbar-thumb { background: ${P.lineDark}; border-radius: 999px; border: 3px solid ${P.paper}; }
      .yyc-chat-scroll::-webkit-scrollbar-thumb:hover { background: ${P.faint}; }
      .yyc-spin { animation: yycSpin .8s linear infinite; }
      .yyc-skel { display: block; background: ${P.line}; } /* still grey shapes, deliberately not animated: a moving placeholder slowed typing on slow phones in the measurements */
      .yyc-doc { content-visibility: auto; contain-intrinsic-size: auto 200px; } /* cards that are off screen are not drawn until they are scrolled to */

      /* ── every screen size (UI-04) ── */
      .yyc-root { min-height: 100dvh; }
      .yyc-content { overflow-wrap: anywhere; }
      .yyc-btn-primary, .yyc-btn-secondary { min-height: 40px; }
      .yyc-btn-primary:disabled { opacity: .7; }
      .yyc-card-rise { transition: transform .15s var(--ease), box-shadow .15s; }
      @media (hover: hover) { .yyc-btn-secondary:hover { transform: translateY(-1px); } }

      /* phones and small tablets: bigger targets, 16px inputs (no zoom-on-focus), filter chips in one swipeable row, pop-ups as bottom sheets */
      /* The case study window: title and close button on one line, a full-width switcher under them (phones), side by side on wide screens */
      .yyc-preview-head { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; grid-template-areas: "title tabs close"; align-items: start; gap: 12px 14px; padding: 18px 24px; flex-wrap: nowrap; }
      .yyc-preview-title { grid-area: title; min-width: 0; }
      .yyc-preview-h { font-weight: 800; font-size: 17px; letter-spacing: -0.01em; line-height: 1.3; overflow-wrap: anywhere; }
      .yyc-preview-meta { font-size: 12.5px; color: ${P.sub}; margin-top: 5px; line-height: 1.5; overflow-wrap: anywhere; }
      .yyc-preview-close { grid-area: close; width: 36px; height: 36px; }
      .yyc-seg { grid-area: tabs; display: flex; border: 1px solid ${P.lineDark}; border-radius: 10px; overflow: hidden; background: ${P.card}; }
      .yyc-seg-btn { flex: 1 1 0; min-width: 0; padding: 8px 14px; font-size: 12.5px; font-weight: 650; font-family: inherit; line-height: 1.2; text-align: center; background: transparent; color: ${P.sub}; border: 0; cursor: pointer; }
      .yyc-seg-btn + .yyc-seg-btn { border-left: 1px solid ${P.line}; }
      .yyc-seg-btn.is-active { background: ${P.ink}; color: ${P.paper}; }
      .yyc-rec-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .yyc-rec-label { font-size: 11.5px; font-weight: 700; color: ${P.sub}; text-transform: uppercase; letter-spacing: .05em; margin: 4px 0 -2px; }

      /* Phones (iPhone SE is 375 wide): buttons that have an icon show only the icon, the bottom bar shows only icons, and nothing breaks mid-word.
         The text stays in the page for screen readers (visually hidden, not removed). */
      @media (max-width: 599px) {
        .yyc-iconify .yyc-btn-label, .yyc-botnav-item .yyc-botnav-label { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
        .yyc-iconify { position: relative; width: 48px; min-width: 48px; height: 44px; padding: 0 !important; justify-content: center; flex: 0 0 auto !important; }
        .yyc-head-actions { width: 100%; justify-content: flex-start; flex-wrap: nowrap; }
        .yyc-section-head > .yyc-iconify { flex: 0 0 auto; }
        .yyc-botnav { padding: 4px 6px calc(6px + env(safe-area-inset-bottom)); }
        .yyc-botnav-item { min-height: 52px; gap: 0; }
        .yyc-botnav-item svg { width: 24px; height: 24px; }
        .yyc-botnav-item .yyc-nav-badge { top: 4px; right: calc(50% - 24px); }
        /* Ask the Brain: the box takes the width, the Ask button becomes a round send arrow beside it */
        .yyc-chat-input-wrap { padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); gap: 8px; }
        .yyc-send { width: 48px; min-width: 48px; height: 48px; border-radius: 50% !important; }
        .yyc-send .yyc-send-icon { display: block; }
        .yyc-stats > .yyc-stat:last-child:nth-child(odd) { grid-column: 1 / -1; }
        .yyc-filter-select { flex: 1 1 100%; }
        .yyc-modal { max-height: 90dvh; }
        /* the case study window fills the screen: no floating card with a sliver of page around it */
        .yyc-backdrop-full { padding: 0; align-items: stretch; }
        .yyc-backdrop-full .yyc-modal-sheet { width: 100% !important; height: 100vh !important; height: 100dvh !important; max-height: none !important; border-radius: 0; }
        .yyc-preview-head { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "title close" "tabs tabs"; padding: 12px 14px; gap: 10px 10px; }
        .yyc-preview-h { font-size: 16px; }
        .yyc-preview-meta { font-size: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .yyc-preview-close { width: 44px; height: 44px; margin: -4px -4px 0 0; }
        .yyc-seg-btn { min-height: 44px; padding: 8px 6px; }
        .yyc-preview-body { padding: 12px !important; }
        .yyc-paper { padding: 18px 16px !important; }
        .yyc-formcard { padding: 14px !important; }
        input[type="checkbox"], input[type="radio"] { width: 22px; height: 22px; flex-shrink: 0; }
        /* a lever record: the label on its own line, then the text, then the actual impact */
        .yyc-rec-row { flex-wrap: wrap; row-gap: 8px; }
        .yyc-rec-pill { order: 1; max-width: 100%; white-space: normal !important; }
        .yyc-rec-actions { order: 2; margin-left: auto; flex-direction: row !important; align-items: center !important; }
        .yyc-rec-main { order: 3; flex: 1 1 100% !important; }
        .yyc-rec-select { width: 100% !important; }
        .yyc-rec-top { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
        .yyc-rec-top .yyc-rec-select { grid-column: 1; }
        .yyc-rec-top .yyc-icon-btn { grid-column: 2; grid-row: 1; }
        .yyc-rec-top .yyc-rec-section { grid-column: 1 / -1; min-width: 0 !important; }
      }
      @media (max-width: 899px) { .yyc-pillbtn { min-height: 44px; } .yyc-linkbtn { min-height: 44px; display: inline-flex; align-items: center; } }
      @media (max-width: 899px) {
        .yyc-topbar { padding: 10px 14px; }
        .yyc-topbar .yyc-brand-mark img { width: 44px; height: 38px; }
        .yyc-topbar .yyc-brand-sub { display: none; }
        .yyc-section-head { margin-bottom: 18px; padding-bottom: 14px; }
        .yyc-section-head > .yyc-btn-primary, .yyc-section-head > .yyc-btn-secondary { flex: 1 1 auto; }
        .yyc-btn-primary, .yyc-btn-secondary { min-height: 44px; }
        .yyc-input, .yyc-filter-select, .yyc-chat-input { min-height: 46px; font-size: 16px; }
        .yyc-filter-select { flex: 1 1 150px; min-width: 0; }
        .yyc-search { max-width: none; }
        .yyc-icon-btn { width: 44px; height: 44px; border-radius: 10px; }
        .yyc-admin-btn { min-height: 44px; min-width: 44px; }
        .yyc-profile-compact { min-height: 44px; min-width: 44px; justify-content: center; }
        .yyc-chip-row { flex-wrap: nowrap; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; margin: 0 -16px; padding: 2px 16px 6px; }
        .yyc-chip-row::-webkit-scrollbar { display: none; }
        .yyc-chip-row > * { flex-shrink: 0; }
        .yyc-lever-chip { min-height: 44px; padding: 8px 14px; font-size: 13.5px; }
        .yyc-grid { grid-template-columns: 1fr; }
        .yyc-stats { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
        .yyc-stat { padding: 14px; }
        .yyc-stat-hint-text { display: none; }
        .yyc-stat-num { font-size: clamp(20px, 6.2vw, 24px); }
        .yyc-stat-label { white-space: normal; line-height: 1.25; }
        .yyc-modal-backdrop { padding: 0; align-items: flex-end; }
        .yyc-modal { width: 100% !important; max-width: 100% !important; max-height: 92dvh; border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom); }
        .yyc-modal-head { padding: 16px 18px; }
        .yyc-chat-wrap { min-height: calc(100dvh - 250px); }
        .yyc-chat-scroll { padding: 16px 14px; }
        .yyc-toasts { bottom: calc(84px + env(safe-area-inset-bottom)); }
      }
      /* a phone held sideways: the bars must not eat the short screen */
      @media (max-width: 899px) and (max-height: 480px) {
        .yyc-topbar { position: static; }
        .yyc-botnav-item { min-height: 44px; flex-direction: row; gap: 6px; }
      }
      /* very wide screens: the content keeps a comfortable width instead of stretching */
      @media (min-width: 1700px) { .yyc-content { max-width: 1400px; } }
    `}</style>
  );
}