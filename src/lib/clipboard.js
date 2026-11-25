// Copying text (UX-01), with fallbacks so it never silently fails:
//   1. the modern clipboard API;  2. the older "select a hidden box and copy" way (works on plain http and in older browsers);
//   3. if both are refused, a small window shows the text already selected, so the person can press Ctrl+C (src/ui/CopyFallback.jsx listens for "yyc-copy-manual").
// Success and failure are announced with a toast, through the same "yyc-toast" event the rest of the app uses.
const toast = (msg, kind = "ok") => { try { window.dispatchEvent(new CustomEvent("yyc-toast", { detail: { msg, kind } })); } catch { /* no window: nothing to tell */ } };

function legacyCopy(value) {
  let box = null;
  try {
    box = document.createElement("textarea");
    box.value = value;
    box.setAttribute("readonly", "");
    box.setAttribute("aria-hidden", "true");
    box.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(box);
    box.select();
    box.setSelectionRange(0, value.length);
    return !!document.execCommand("copy");
  } catch { return false; } finally { if (box && box.parentNode) box.parentNode.removeChild(box); }
}

/* -> "copied" | "manual". Never throws. */
export async function copyText(text, doneMessage = "Copied to the clipboard") {
  const value = String(text == null ? "" : text);
  if (!value) { toast("There is nothing to copy.", "error"); return "manual"; }
  let ok = false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") { await navigator.clipboard.writeText(value); ok = true; }
  } catch { ok = false; }
  if (!ok) ok = typeof document !== "undefined" && legacyCopy(value);
  if (ok) { toast(doneMessage); return "copied"; }
  try { window.dispatchEvent(new CustomEvent("yyc-copy-manual", { detail: { text: value } })); } catch { /* nothing more can be done */ }
  return "manual";
}
