// Shared by the browser (local mode) and the server (hosted mode: indexing when a document is saved, and the fallback search),
// so both cut a document into exactly the same chunks.

/* Split a document into ~800-character chunks on line boundaries.
   A chunk NEVER crosses a section heading, so the heading stored with a chunk is always exactly where its text came from
   (a citation can then open the right section). Inside one section, consecutive chunks overlap slightly so a sentence is not cut in half. */
export function chunkDocument(doc, size = 800, overlap = 160) {
  const headings = new Set((doc.sections || []).map((s) => String(s.heading || '').trim().toLowerCase()).filter(Boolean));
  const lines = String(doc.full_text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';
  let heading = '';
  const emit = () => {
    if (buf.trim().length > 40) chunks.push({ doc_id: doc.id, pos: chunks.length, title: doc.title, industry: doc.industry, heading, text: buf.trim() });
  };
  const nextWithinSection = () => {
    emit();
    // carry the tail of this chunk into the next one, starting at a word boundary
    const tail = buf.length > overlap ? buf.slice(buf.length - overlap) : '';
    const sp = tail.search(/\s/);
    buf = sp >= 0 ? tail.slice(sp + 1) : tail;
  };
  for (const line of lines) {
    if (headings.has(line.toLowerCase())) { emit(); buf = ''; heading = line; } // new section: close the chunk, no overlap across sections
    // a single very long line is cut so no chunk balloons past the budget
    for (let p = 0; p < line.length || p === 0; p += size) {
      const piece = line.slice(p, p + size);
      if (buf.length + piece.length + 1 > size && buf.length > 0) nextWithinSection();
      buf += (buf ? '\n' : '') + piece;
      if (line.length <= size) break;
    }
  }
  emit();
  return chunks;
}
