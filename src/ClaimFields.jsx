import { useState } from "react";
import { splitClaim, combineClaim } from "./claim.js";

// The "Strategy title" and "Description" boxes of one extracted record: the record keeps one trimmed text, but each box keeps exactly what was typed (trailing spaces included), so give it a new `key` when the record behind it changes.
export default function ClaimFields({ claim, onChange, labelStyle }) {
  const start = splitClaim(claim);
  const [name, setName] = useState(start.name);
  const [desc, setDesc] = useState(start.desc);
  return (
    <>
      <label style={labelStyle}>Strategy title</label>
      <input
        className="yyc-input"
        value={name}
        onChange={(e) => { setName(e.target.value); onChange(combineClaim(e.target.value, desc)); }}
      />
      <label className="yyc-edit-record-field" style={labelStyle}>Description</label>
      <textarea
        className="yyc-input yyc-edit-record-textarea"
        rows={3}
        value={desc}
        onChange={(e) => { setDesc(e.target.value); onChange(combineClaim(name, e.target.value)); }}
      />
    </>
  );
}
