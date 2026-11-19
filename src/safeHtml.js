// Cleans a document's HTML just before it is shown (SEC-03). The server cleans it when it is saved (server/sanitize.js); this second pass
// means a document that reached storage some other way (an old row, an imported backup, the browser-only mode) still cannot run script.
import DOMPurify from "dompurify";

const ALLOWED_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "sup", "sub", "blockquote", "pre", "code",
  "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col", "a", "img", "span", "div"];
const ALLOWED_ATTR = ["href", "title", "src", "alt", "width", "height", "colspan", "rowspan", "scope", "start", "target", "rel"];
const SAFE_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;

let hooked = false;
function addHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") { // links open in a new tab and never hand the opener or the referrer to the other site
      if (!/^(https?:|mailto:)/i.test(node.getAttribute("href") || "")) node.removeAttribute("href");
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
    if (node.tagName === "IMG" && !SAFE_IMAGE.test(node.getAttribute("src") || "")) node.remove(); // only embedded pictures: nothing is fetched from another site
  });
}

export function safeDocHtml(html) {
  if (typeof html !== "string" || !html) return "";
  addHooks();
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false });
}
