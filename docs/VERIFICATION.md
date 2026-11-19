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


## Redesign and second security pass (2026-11-19, later the same day)

### What was run

| Check | Result |
|---|---|
| Lint (`npx eslint .`) | 0 problems |
| Unit tests (`npm test`) | 151 of 151 pass |
| Browser tests (`npm run e2e`, installed Chrome, production build, no database, no AI calls) | 23 of 23 pass |
| Dependency audit (`npm audit`) | 0 vulnerabilities |
| API start-up on a Node older than 22.12 (simulated) | all four entry points start |

### Redesign, requirement by requirement

| ID | Status | Evidence |
|---|---|---|
| UI-01 design system | **Verified** | Every colour in `src/App.jsx` and `src/Root.jsx` now comes from the tokens in `src/index.css`; the app builds and all screens render. |
| UI-02 light and dark | **Verified on 10 screens** | The automated accessibility scan (WCAG 2.0 to 2.2, A and AA) passes in both themes on: knowledge base, document view, lever explorer, Ask the Brain, add material, gap log, empty library, sign in, request access, not found. Screenshots of all of them were looked at in both themes. |
| UI-03 page titles | **Verified** | Each screen has exactly one page title, 26 to 38 px depending on width, with the brand accent bar. Before and after screenshots are in `e2e/.results/before` and `e2e/.results/after` (not committed). |
| UI-04 every screen size | **Verified** | At 320, 375, 667x375 (phone sideways), 768, 1024, 1440 and 1920 px: no sideways scrolling, nothing past the right edge, page title not clipped, on all 10 screens. On a phone the navigation, filter chips, buttons, inputs and icon buttons are at least 44 px. A newly opened tab starts at its top. |
| UI-05 accessible | **Partly** | Automated scan passes (above); skip link is the first Tab stop and focus is visibly outlined; motion is switched off for people who ask for less. **Not done:** a full keyboard walk-through of every pop-up, a screen-reader run, and the 200% text-size check. |
| UI-06 clear states | **Partly** | The empty library, sign-in errors and "request sent" states were restyled and scanned. Loading skeletons were not added. |

Found and fixed by these tests: 2 unlabelled filter menus on the knowledge base and 1 on the lever explorer, 9 more unlabelled menus elsewhere, 12 icon-only buttons with no name for screen readers, white-on-light text on the chosen Document / Summary tab in the dark theme, statistic labels cut off on phones, and a tab that opened scrolled halfway down.

### Independent security review

A separate reviewer read every server file, the sign-in code and the database script without seeing my notes. It found no way for a guest, a not-yet-approved, a disabled, an unconfirmed or a temporary-password account to reach data, and reported the problems below. Each fix has a test; the mutation check (break the fix, the tests must fail) caught 11 of 12, and the twelfth is harmless (with that line removed the request is still refused by the next check).

| Review finding | Fix | Test |
|---|---|---|
| H1 A stranger could request access with an owner's address and become an owner when approved | Owner addresses are ignored by the public form; only an owner can approve or create an owner account; the approval dialog says so | `test/accounts.test.mjs` "review H1 / M1" |
| M1 An ordinary admin could create an owner's account and receive its password | Refused (403) | same |
| M2 The request form revealed who has an account (through the sign-in service) | No account is created when asking. The chosen password is kept only as a bcrypt hash on the request and the account is created at approval | "NO account exists until an admin approves" |
| M3 The request form could be shut down for everyone | Only requests from allowed addresses count against the shared budget; requests older than 30 days are closed automatically | "review M3" |
| M4 A half-failed request left an account nobody could approve or remove | Cannot happen any more (no account until approval; a failed approval puts the request back) | covered by the flow tests |
| M5 `TRUST_PROXY=1` was read as an address, not "one proxy" | Parsed correctly; a bad value is ignored with a message instead of stopping the server | not unit-tested (start-up code) |
| M6 "Current password" was only checked in the browser | The server checks it, with a limit on guesses | "review M6" |
| L1 Wrong tokens were still sent to Supabase after the limit | Refused before the call | existing SEC-05 test |
| L2 Rate-limit table could get slow under attack | Swept at most once a minute, hard cap | not load-tested |
| L3 One malformed section could break search | Sections are cleaned when saved | not unit-tested |
| L4 Role and password changes took up to a minute to apply | The sign-in cache is cleared at once | not unit-tested |
| L5 Made-up operation names gave a server error | Clean "Unknown operation" | "review L5 / L3" |
| L6 Vercel was missing one header | Added | needs a deployment |
| L7 Future database functions would be public by default | Default removed in `supabase/schema.sql` | needs the script to be run |
| L8 Old-style email links could sign a browser into another account | Only honoured when email links are switched on | not tested |
| L9 Two admins deciding one request at once | The first one wins; the second is told | "review L9" |
| L10 Import brought back records of deleted documents; ids had no length limit | Fixed | not unit-tested |
| L11 Browser-only mode: the AI proxy could be reached through a DNS trick | It only answers requests addressed to this PC | not unit-tested |

### Not verified, plainly

- **Anything against the real Supabase project.** In particular: creating an account from a stored password hash at approval (the Supabase library documents `password_hash`, but it was not run against the live service), whether changing a password ends the open session (the app now signs in again with the new password either way), and the sign-in, Users and profile screens with real data.
- **Vercel:** the extra header and that nothing else changed. The earlier `vercel.json` headers and the JSON 404 were confirmed on the live site.
- **The Users tab, profile window, bulk list, review and edit screens in a browser.** The browser tests run without the shared database, so these were restyled through the shared tokens and classes but not looked at or scanned.
- Screen readers, the 200% text size check, and real phones (the tests use Chrome at phone sizes).
- Speed: the first-load script is unchanged (about 303 kB gzipped). Splitting it (PERF-01, PERF-02) has not been done.
