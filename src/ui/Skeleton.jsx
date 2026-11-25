// Grey placeholder shapes shown while something loads.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.

/* Grey placeholder shapes shown while something loads (PERF-05). They hold no text, so there is nothing to read or mis-read; the wrapper tells
   screen readers that content is on its way. They are deliberately still: a moving placeholder slowed typing on slow phones in the measurements. */
export function Skeleton({ w = "100%", h = 14, r = 8, style }) {
  return <span className="yyc-skel" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}
export function SkeletonLines({ rows = 4, label = "Loading" }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} style={{ display: "grid", gap: 10, padding: "6px 0" }}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} w={i % 4 === 3 ? "62%" : "100%"} />)}
    </div>
  );
}
export function SkeletonCards({ n = 6, label = "Loading" }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="yyc-grid">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="yyc-skel-card" style={{ cursor: "default", boxShadow: "none" }}>
          <div className="yyc-doc-top"><Skeleton w={84} h={22} r={999} /><Skeleton w={96} h={12} /></div>
          <div style={{ display: "grid", gap: 8 }}><Skeleton h={16} /><Skeleton w="70%" h={16} /><Skeleton w="85%" h={12} style={{ marginTop: 4 }} /></div>
          <div className="yyc-doc-foot"><Skeleton w={110} h={22} r={999} /><Skeleton w={70} h={12} /></div>
        </div>
      ))}
    </div>
  );
}
/* Each screen gets placeholders shaped like ITS OWN layout, so nothing jumps when the real content arrives:
   cards = Knowledge Base, chat = Ask the Brain, explorer = Lever Explorer, people = Users, log = Gap Log. */
const Head = ({ action }) => (
  <div className="yyc-section-head"><div><Skeleton w="min(320px, 70%)" h={34} r={10} /><Skeleton w="min(480px, 90%)" h={14} style={{ marginTop: 14 }} /></div>{action && <Skeleton w={130} h={38} r={12} />}</div>
);
const Row = ({ lead, chips = 1 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderTop: "1px solid var(--line)" }}>
    {lead && <Skeleton w={36} h={36} r={999} style={{ flexShrink: 0 }} />}
    <div style={{ flex: 1, display: "grid", gap: 8, minWidth: 0 }}><Skeleton w="45%" h={14} /><Skeleton w="30%" h={11} /></div>
    {Array.from({ length: chips }, (_, i) => <Skeleton key={i} w={74} h={24} r={999} />)}
  </div>
);
const panel = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden" };

export function SkeletonPage({ label = "Loading", variant = "cards" }) {
  let body;
  if (variant === "chat") {
    body = (
      <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: 14, justifyItems: "center", paddingTop: 24 }}>
        <Skeleton w={64} h={64} r={999} /><Skeleton w="min(280px, 80%)" h={22} r={8} /><Skeleton w="min(420px, 90%)" h={13} />
        <div style={{ display: "grid", gap: 8, width: "100%", maxWidth: 420, marginTop: 12 }}>{[0, 1, 2].map((k) => <Skeleton key={k} h={40} r={11} />)}</div>
        <Skeleton h={52} r={14} style={{ marginTop: 18 }} />
      </div>
    );
  } else if (variant === "explorer") {
    body = (
      <>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>{[90, 110, 80, 100, 120, 90].map((w, k) => <Skeleton key={k} w={w} h={34} r={999} />)}</div>
        <div style={panel}>{[0, 1, 2, 3, 4].map((k) => <Row key={k} chips={2} />)}</div>
      </>
    );
  } else if (variant === "people") {
    body = (
      <>
        <div style={{ ...panel, padding: 18, marginBottom: 16, display: "grid", gap: 12 }}><Skeleton w={160} h={16} /><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><Skeleton w="min(260px, 100%)" h={44} r={10} /><Skeleton w="min(260px, 100%)" h={44} r={10} /><Skeleton w={130} h={44} r={12} /></div></div>
        <div style={panel}>{[0, 1, 2, 3, 4].map((k) => <Row key={k} lead chips={2} />)}</div>
      </>
    );
  } else if (variant === "log") {
    body = <div style={panel}>{[0, 1, 2, 3, 4, 5].map((k) => <Row key={k} chips={1} />)}</div>;
  } else {
    body = <SkeletonCards n={6} label={label} />;
  }
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      {variant !== "chat" && <Head action={variant === "people" || variant === "log"} />}
      {body}
    </div>
  );
}
