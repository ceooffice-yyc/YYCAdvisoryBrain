# Requirements register: redesign, speed and security

Source: the request of 2026-11-19 ("redesign the UI, better performance, higher security") and the answers given the same day.
Agreed approach: **restyle and restructure in phases**, in this order: **1. security, 2. speed, 3. visuals**. Every existing feature is kept.

Status: Verified (evidence in `docs/VERIFICATION.md`), Built (not yet verified), Planned.
This file is also the traceability table: each requirement names the code that owns it and the tests that check it.

## Phase 1: security (this change)

| ID | Requirement | Priority | Acceptance criteria | Owner (code) | Tests | Status |
|---|---|---|---|---|---|---|
| SEC-01 | Guests stay available, but safely | Must | Guest browsing works only when `ALLOW_GUEST` is exactly `true`. A guest can only read (library, records, documents); every write, chat, Ask, Users or log operation answers 401. Guest reads are limited per address per minute. No copy of the library is left in a guest's browser. | `server/db.js` (`guestAllowed`, `handleDb`), `src/db.js` (`keepCopy`) | `test/security.test.mjs` SEC-01 | Verified (server); browser copy: Built |
| SEC-02 | The AI proxy is not an open relay | Must | With sign-in configured only admins may call `/api/groq/chat`. Only the app's model, at most 4 text messages, 60,000 characters and 8,000 answer tokens pass; other options are dropped. On a hosted site with no sign-in it answers 503. The key count is told to admins only. | `server/groqHandler.js`, `api/groq/chat.js`, `server/index.js` | `test/security.test.mjs` SEC-02, `e2e/security.spec.js` SEC-02 | Verified |
| SEC-03 | Document HTML cannot run script | Must | HTML is cleaned when saved (server) and again when shown (browser): no script, handlers, frames, forms, styles, or pictures and links to unsafe places. Normal Word content (headings, lists, tables, bold, embedded pictures) survives. | `server/sanitize.js`, `src/safeHtml.js`, `server/db.js` (`docToRow`) | `test/security.test.mjs` SEC-03, `e2e/security.spec.js` SEC-03 | Verified |
| SEC-04 | Security headers on every response | Must | Content-Security-Policy (scripts from this site only), nosniff, no framing, no referrer, permissions policy. The app, including reading a Word file, works under the policy with no errors. | `server/securityHeaders.js`, `vercel.json` | `test/security.test.mjs` SEC-04, `e2e/security.spec.js` SEC-04 (two tests) | Verified on the Express server. **Not verified on Vercel** (needs a deployment) |
| SEC-05 | Rate limits | Should | Per person on the database API and the AI proxy, per address for guests and for repeated wrong tokens, per person on gap-list entries. A limited caller gets 429 with the time to wait. | `server/rateLimit.js`, used by `server/db.js`, `server/groqHandler.js`, `server/ask/handler.js` | `test/security.test.mjs` SEC-05 (three tests) | Verified. Limits are per server instance (see Known limits) |
| SEC-06 | Only verified accounts; shared content is admin-only | Should | An account whose email is not confirmed is refused (403). Only admins can change the shared example questions. | `server/auth.js`, `server/db.js` (`suggestions_set`), `src/App.jsx` (viewers show stored examples) | `test/security.test.mjs` SEC-06 (two tests) | Verified (server) |
| ACC-07 | Invite and reset links survive mail scanners | Must | A link of the form `/?token_hash=…&type=invite` shows a Continue button; the link is only used up when Continue is pressed. A used or expired link gives a clear message. The older link form keeps working. | `src/storage.js` (`readEmailLink`, `verifyEmailLink`), `src/Root.jsx` (`ConfirmLink`) | none yet (needs a real Supabase email) | Built, **not verified** |
| ERR-01 | Real "not found" answers | Must | An unknown page address answers 404 with a not-found page; an unknown `/api` address answers 404 as JSON; a malformed request body answers 400 as JSON. | `server/index.js`, `public/404.html`, `api/notfound.js`, `vercel.json` | `e2e/security.spec.js` ERR-01, SEC-02 | Verified on the Express server. **Not verified on Vercel** |

## Phase 2: speed (done 2026-11-19; numbers in `docs/PERFORMANCE.md`, evidence in `docs/VERIFICATION.md`)

| ID | Requirement | Priority | Acceptance criteria | Status |
|---|---|---|---|---|
| PERF-01 | Load only what the screen needs | Must | The first page needs under 150 kB (compressed) of script (was 296 kB). The Word reader, HTML cleaner, extraction code, Ask the Brain, Lever Explorer, Users, Gap Log and document window are downloaded when used. A failed download shows a message and a Try again button. | **Verified** (126 kB) |
| PERF-02 | Split `src/App.jsx` | Must | One file per screen or concern; no file other than the Knowledge Base screen over about 1,000 lines; every existing test passes. | **Verified** (26 modules; the Knowledge Base screen is still 1,647 lines: see "Not done" in `docs/PERFORMANCE.md`) |
| PERF-03 | Less lag while typing | Should | Typing in the Knowledge Base search with 300 documents: slowest keystroke under 400 ms on the slow-phone setup (was 1,272 ms). | **Verified** (152 ms) |
| PERF-04 | A budget, checked | Should | `npm run budget` and a test fail when the first page or a screen grows past its limit, or when an on-demand file is folded back in. | **Verified** (4 of 4 mutations caught) |
| PERF-05 | Loading placeholders | Should | While a screen, a document or the example questions load, grey placeholder shapes are shown (accessible, no animation). | **Verified** for the Knowledge Base, the document window, the Gap Log, Users and Ask the Brain suggestions. The Lever Explorer shows the generic page placeholder only while its code downloads |

## Phase 3: visuals (done 2026-11-19; evidence in `docs/VERIFICATION.md`)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| UI-01 | A design system | Must | Colour, type, spacing, radius, shadow and motion tokens; components use tokens, not raw values. YYC maroon and gold stay the brand. |
| UI-02 | Light and dark themes | Must | Follows the system setting; both pass the automated accessibility scan. |
| UI-03 | Every screen restyled, behaviour unchanged | Must | Sign-in, Knowledge Base, Add material, bulk list, review, edit, Ask the Brain, Lever Explorer, Gap Log, Users, profile, all pop-ups, the 404 page. |
| UI-04 | Works on every screen size | Must | Checked at 320, 375, 768, 1024, 1440 and 1920 px: no sideways scrolling, nothing clipped, touch targets of 44 px. |
| UI-05 | Accessible | Must | WCAG 2.2 AA: keyboard use, visible focus, labels, contrast, reduced motion. |
| UI-06 | Clear states | Should | Empty, loading, error and success states for each screen, with feedback on every action. |

## Assumptions (not blocking; correct me if wrong)

- English only; the Chinese text in the code stays switched off.
- Same stack: React, Vite, Express, Supabase, Vercel, plain JavaScript (no move to TypeScript in this work).
- No new features beyond those listed here. Ideas that came up are listed under "Proposed separately".
- Nothing is committed, pushed or changed in Vercel or Supabase by this work; the steps are listed for the owner.

## Proposed separately (not built)

- **A "public / internal" mark on each document**, so guests only see documents marked public. Today a guest can read every document in full, including internal playbooks. This is the main remaining risk of keeping guests on.
- A shared rate-limit store (Redis or a database counter) so limits hold across server instances.
- Two-step sign-in (MFA) for admins.
- Automatic deletion of old question logs and chats (retention).

## Known limits

- Rate limits are kept in each server instance's memory. On Vercel several instances can run at once and a new instance starts from zero, so the limits slow abuse down but are not exact global quotas.
- Sign-in attempts go from the browser straight to Supabase, so their limit is Supabase's own, not this app's.
- Documents saved before this change keep their original stored HTML. They are cleaned every time they are shown; they are cleaned in storage the next time they are saved.
- On a hosted site without Supabase sign-in the AI features are now switched off (the proxy answers 503). Before, such a site was open to anyone.
