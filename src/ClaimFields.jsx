import { useState } from "react";
import { splitClaim, combineClaim } from "./claim.js";

/* The "Strategy title" and "Description" boxes of one extracted record on the review screen.

   The record keeps ONE combined, trimmed text ("Title: description"), but each box keeps exactly what is typed, spaces included.
   (Feeding the trimmed text straight back into the box deleted a space typed at the end of a word, so only spaces between words survived.)
   The boxes start from the record's text when they appear; give this component a new `key` when the record behind it changes,
   for example after a record above it was removed. */
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
