// Colours, shared styles and button looks. The colours are CSS variables (src/index.css), so both themes come from one place.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.

/* The palette. Every value is a design token from src/index.css, so the light and dark themes come from one place.
   A plain colour (crimson, red, green…) is a FILL or a border; its "Text" partner is the same hue tuned to be read on the page background. */
export const P = {
  paper: "var(--paper)", paperDeep: "var(--paper-deep)", card: "var(--card)",
  ink: "var(--ink)", sub: "var(--sub)", faint: "var(--faint)", title: "var(--title)",
  line: "var(--line)", lineDark: "var(--line-dark)",
  crimson: "var(--crimson)", crimsonDark: "var(--crimson-dark)", crimsonSoft: "var(--crimson-soft)", crimsonText: "var(--crimson-text)",
  maroon: "var(--maroon)", maroonText: "var(--maroon-text)",
  gold: "var(--gold)", goldDark: "var(--gold-dark)", goldSoft: "var(--gold-soft)", goldText: "var(--gold-text)",
  green: "var(--green)", greenSoft: "var(--green-soft)", greenText: "var(--green-text)",
  red: "var(--red)", redSoft: "var(--red-soft)", redText: "var(--red-text)",
  blue: "var(--blue)", blueSoft: "var(--blue-soft)", blueText: "var(--blue-text)",
  wash: "var(--wash)",
  s1: "var(--s1)", s2: "var(--s2)", s3: "var(--s3)", focus: "var(--focus)",
};

export const fontStack = "var(--sans)";

export const S = {
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
export const btnP = (disabled) => ({
  ...btnBase, padding: "10px 20px", fontSize: 13.5,
  background: disabled ? P.faint : P.crimson, color: "#fff",
  boxShadow: disabled ? "none" : "0 1px 3px rgba(var(--brand-rgb), 0.25)",
  cursor: disabled ? "default" : "pointer",
});
export const btnG = { ...btnBase, padding: "9px 15px", fontSize: 13, fontWeight: 600, border: `1px solid ${P.lineDark}`, background: P.card, color: P.sub };

export const TYPE_COLORS = {
  case_study: { bg: P.crimsonSoft, fg: P.crimsonText }, // follows the brand colour
  playbook: { bg: "#FFF6DC", fg: "#8A6508" },
  framework: { bg: "#E6F5EC", fg: "#0E7C4A" },
  notes: { bg: "#EEF0F5", fg: "#3D4B6E" },
};