// Cleans the HTML copy of an uploaded document before it is stored (SEC-03). The browser cleans it again before showing it (src/safeHtml.js),
// so a document that reached the database some other way is still harmless on screen.
//
// Only what a converted Word file needs is kept: headings, paragraphs, lists, tables, bold / italic, links to http(s) / mailto, and embedded
// pictures (data: images). Scripts, styles, event handlers, frames, forms and every other attribute are removed.

import sanitizeHtml from 'sanitize-html';

const OPTIONS = {
  allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'blockquote', 'pre', 'code',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'a', 'img', 'span', 'div'],
  allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'], ol: ['start'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['data'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    // links open in a new tab and never hand the opener or the referrer to the other site
    a: (tagName, attribs) => ({ tagName, attribs: { ...(attribs.href ? { href: attribs.href } : {}), ...(attribs.title ? { title: attribs.title } : {}), target: '_blank', rel: 'noopener noreferrer nofollow' } }),
  },
  // an embedded picture must really be a picture (not data:text/html or an SVG, which can carry script)
  exclusiveFilter: (frame) => frame.tag === 'img' && !/^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(String(frame.attribs.src || '')),
};
// `target` and `rel` are added by the transform above, so they must be allowed through
OPTIONS.allowedAttributes.a = ['href', 'title', 'target', 'rel'];

export function cleanDocHtml(html) {
  const s = typeof html === 'string' ? html : '';
  return s ? sanitizeHtml(s, OPTIONS) : '';
}
