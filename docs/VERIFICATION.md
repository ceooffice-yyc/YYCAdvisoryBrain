# Verification record

## Phase 1: security (2026-11-19)

Everything below was run on this PC against the working tree. Nothing was run against the live site or the real database, except two read-only requests to the live status address made before the work started.

### What was run

| Check | Command | Result |
|---|---|---|
| Lint | `npx eslint .` | 0 problems |
| Build | `npm run build` | passes (first-load script still about 303 kB gzipped plus 57 kB; Phase 2 addresses this) |
| Unit tests | `npm test` | 141 of 141 pass (11 new in `test/security.test.mjs`) |
| Browser tests | `npm run e2e` (Playwright, installed Chrome, production build on port 8791, no database, made-up AI key) | 6 of 6 pass |
| Dependency audit | `npm audit` | 0 vulnerabilities (runtime and dev) |
| Secrets in the built files | search of `dist/` for key shapes and secret setting names | none found |
| Screenshots by eye | the not-found page, light and dark, 320 px and 1440 px | readable, centred, nothing clipped |

### Requirement by requirement

| ID | Status | Evidence |
|---|---|---|
| SEC-01 guests | **Verified** (server rules) / **Built** (no copy left in a guest's browser) | Unit: off for a missing or mistyped setting; 14 write, chat and admin operations answer 401 for a guest; the 5th read in a minute is refused, another address is not. The browser-copy change is a one-line guard and was not exercised in a browser, because the test server has no shared database. |
| SEC-02 AI proxy | **Verified** | Unit: other models, huge sizes, extra roles, non-text content refused; unknown options dropped; nobody 401, viewer 403, admin 200; hosted with no sign-in 503. Browser: four malformed requests answer 400 from the real server. |
| SEC-03 HTML cleaning | **Verified** | Unit: 14 hostile patterns removed, 6 normal ones kept. Browser: a stored hostile document was opened; no script ran, no handler, frame, style or outside picture reached the page, no request left for another site. |
| SEC-04 headers | **Verified on the Express server. Not verified on Vercel.** | Browser: headers present on a page, an API answer and the 404; the app starts with no blocked resource or error; a Word file is read correctly under the policy. `vercel.json` carries the same values but only a deployment can prove it. |
| SEC-05 rate limits | **Verified** (per instance) | Unit: the window, the wait time, per-admin limit on the proxy, guest limit, 32 wrong tokens from one address end in 429. |
| SEC-06 verified accounts, admin-only examples | **Verified** (server) | Unit: unconfirmed email 403, confirmed accepted; a viewer changing the example questions 403. |
| ACC-07 invite links | **Built, not verified** | Needs a real Supabase email and the template change described in the README. |
| ERR-01 not found | **Verified on the Express server. Not verified on Vercel.** | Browser: unknown page is a 404 with the page; unknown API address is a JSON 404; malformed JSON is a JSON 400. |

### Proving the tests can fail (mutation check)

Each protection was switched off on purpose, the matching tests were run, and the file was restored. **12 of 12 mutations were caught:**

- AI proxy: admin check removed; any model allowed; open on a hosted site with no sign-in
- Guests: on by default again; no rate limit
- HTML cleaner switched off on the server; switched off in the browser (browser test)
- Unconfirmed email accepted; any user may change the example questions
- Headers: inline scripts allowed
- Temporary password: library readable; disabled account accepted

### Found while testing

- Chrome reports "inline event handler blocked" when hostile HTML is merely **parsed**, even in the cleaner's inert copy that never reaches the page. This looked like a second place where document HTML was being used; a separate probe showed it is the policy reporting at parse time, and the page itself contained no handler. The browser test allows that one message and fails on any other.
- Two older tests failed after the "confirmed email" rule went in, because their made-up users had no confirmed email. That was the rule working; the test users were corrected.
- The browser tests first ran against a development build (the test setting changed the build mode). They now build in production mode.
- The earlier assumption that the public Supabase key was a risk was checked against the live project before this work: sign-up is disabled, the key sees no rows in any table, and the search function refuses it.

### Not verified, plainly

- **Anything on Vercel:** the headers in `vercel.json`, the `/api/*` JSON 404 rewrite, the static 404 page, and that existing API routes are unaffected by the rewrite. Check after the next deployment (steps in the handover message).
- **The invite and reset link flow** (ACC-07): no real email was sent.
- **The app with the shared database** in a browser: the browser tests use the browser-only mode. The sign-in, Users and profile screens were not exercised in a browser in this phase.
- **Rate limits across several server instances:** they are per instance by design (see Known limits in `docs/REQUIREMENTS.md`).
- **Accessibility and responsive checks of the main app:** these belong to Phase 3 and have not been run. Only the not-found page was looked at.
- The unit tests for this phase were written by the same person who wrote the code, with the code in view. The mutation check is the independent evidence that they test the right thing.
