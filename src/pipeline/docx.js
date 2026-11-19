// Reads a Word file in the browser. The Word reader (120 kB) is downloaded when a file is uploaded, not with the first page.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { cleanDocTitle } from "../lib/util.js";

export async function parseDocxFile(f) {
  const { default: mammoth } = await import("mammoth"); // 120 kB: only downloaded when a file is uploaded
  const buf = await f.arrayBuffer();
  const [raw, rich] = await Promise.all([
    mammoth.extractRawText({ arrayBuffer: buf }),
    mammoth.convertToHtml({ arrayBuffer: buf }),
  ]);
  return {
    title: cleanDocTitle(f.name.replace(/\.docx$/i, "").replace(/_+/g, " ")),
    text: raw.value || "",
    html: (rich.value || "").slice(0, 150000),
  };
}