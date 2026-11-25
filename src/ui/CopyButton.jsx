// A "Copy" button (UX-01). The text is built only when the button is pressed (getText), copied with fallbacks (src/lib/clipboard.js), and the icon turns into a tick
// for a moment so the person sees it worked. Pressing it never opens the thing it sits on (a card, a row): the click stops here.
import { useEffect, useRef, useState } from "react";
import { copyText } from "../lib/clipboard.js";
import { Icon } from "./Icon.jsx";

export function CopyButton({ getText, label = "Copy", done = "Copied to the clipboard", icon = "copy", showLabel = false, className = "yyc-icon-btn", style }) {
  const [ticked, setTicked] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const press = async (e) => {
    e.stopPropagation();
    const text = (() => { try { return getText(); } catch { return ""; } })(); // building the text must never break the screen
    const how = await copyText(text, done);
    if (how === "copied") { setTicked(true); clearTimeout(timer.current); timer.current = setTimeout(() => setTicked(false), 1600); }
  };
  return (
    <button type="button" className={`${className} yyc-copy-btn${ticked ? " is-done" : ""}`} onClick={press} title={label} aria-label={label} style={style}>
      <Icon name={ticked ? "check" : icon} size={14} />
      {showLabel && <span className="yyc-copy-label">{ticked ? "Copied" : label}</span>}
    </button>
  );
}
