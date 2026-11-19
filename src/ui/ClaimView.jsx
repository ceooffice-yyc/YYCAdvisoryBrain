// Shows a strategy (title and description) and its impact.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { splitClaim } from "../claim.js";
import { impactOf } from "../lib/levers.js";
import { P } from "../theme.js";

export function ClaimText({ text, stacked = false }) {
  const { name, desc } = splitClaim(text);
  if (stacked) {
    return (
      <span style={{ display: "block"}}>
        {name && <span style={{ display: "block", fontWeight: 700 }}>{name}</span>}
        <span style={{ display: "block", whiteSpace:"pre-line" }}>{desc}</span>
      </span>
    )
  }
  return <>{name && <b>{name}</b>}{name && ": "}<span style={{ whiteSpace: "pre-line" }}>{desc}</span></>; // pre-line keeps the bullet lines
}
export function ImpactBox({ record, style }) {
  const txt = impactOf(record);
  if (!txt) return null;
  return (
    <div style={{ fontSize: 12.5, color: P.sub, lineHeight: 1.55, padding: "8px 12px", background: P.wash, borderRadius: 8, borderLeft: `3px solid ${P.lineDark}`, ...style }}>
      <span style={{ fontWeight: 700, color: P.ink }}>Actual impact: </span>{txt}
    </div>
  );
}