// Helpers for a row of filter chips (the shared .yyc-chip-row): on phones the row is one line you swipe sideways (see GlobalStyles), on desktop it wraps.
//  - it marks the row "has-more" / "has-less" while chips are hidden on the right / left, so a soft fade can hint that the row scrolls;
//  - when the selected chip (the one with .is-active) changes, the row scrolls it into the middle, so the person never loses track of it.
// Nothing here changes React state (it only toggles classes and scrolls), so it never causes an extra render.
import { useEffect } from "react";

const reduceMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

export function useChipRow(ref, activeKey, present = true) {
  useEffect(() => {
    const row = ref.current;
    if (!row || !present) return undefined;
    const mark = () => {
      row.classList.toggle("has-more", row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
      row.classList.toggle("has-less", row.scrollLeft > 2);
    };
    mark();
    row.addEventListener("scroll", mark, { passive: true });
    window.addEventListener("resize", mark);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(mark);
    if (ro) ro.observe(row);
    return () => { row.removeEventListener("scroll", mark); window.removeEventListener("resize", mark); if (ro) ro.disconnect(); };
  }, [ref, present]);

  useEffect(() => {
    const row = ref.current;
    if (!row || !present) return;
    if (row.scrollWidth <= row.clientWidth + 2) return; // the row wraps (desktop): everything is already in view
    const chip = row.querySelector(".is-active");
    if (!chip) return;
    const r = row.getBoundingClientRect(), c = chip.getBoundingClientRect();
    row.scrollBy({ left: c.left - r.left - (r.width - c.width) / 2, behavior: reduceMotion() ? "auto" : "smooth" }); // sideways only: the page itself does not jump
  }, [ref, activeKey, present]);
}
