# Design note: redesign, speed and security

Short on purpose. Requirement ids refer to `docs/REQUIREMENTS.md`.

## The parts and what each is responsible for

| Part | Responsible for | Requirements it owns |
|---|---|---|
| Browser app (`src/`) | Screens, reading Word files, running extraction for admins, showing only cleaned HTML | SEC-03 (display pass), ACC-07, PERF-*, UI-* |
| Server API (`server/`, mirrored by `api/` on Vercel) | Who may do what, input checks, rate limits, the AI proxy rules, cleaning HTML before it is stored, headers | SEC-01, SEC-02, SEC-03 (storage pass), SEC-04, SEC-05, SEC-06, ERR-01 |
| Supabase | Accounts and sessions, the library tables (reachable by the server only), search index | (supports SEC-01, SEC-06) |
| Groq, Gemini | AI answers and extraction; embeddings for search | (external services) |

SEC-03 is deliberately done twice (store and display); the **server pass owns it**, the browser pass is the safety net for anything already stored.
No part depends on a part that depends back on it: browser → server → Supabase / Groq / Gemini.

## How data moves (unchanged by this work, stated for the check)

1. Sign-in: browser → Supabase directly (email and password), which returns a session token to the browser.
2. Every other call: browser → `/api/db`, `/api/ask` or `/api/groq/chat` with the token → the server asks Supabase who the token belongs to → the server reads or writes with its own key.
3. Extraction (admins): the browser reads the Word file itself, builds the prompt and sends it through `/api/groq/chat`, which now rebuilds the request from a fixed list of fields before passing it on.
4. Ask the Brain: `/api/ask` searches on the server and makes its own AI calls; the browser never sends a prompt.

## Data inventory: what this phase adds

| Item | Where it lives | Why | Requirement |
|---|---|---|---|
| Recent request times per person or address | Server memory only, at most one hour | Rate limits | SEC-05 |
| Nothing else | | | |

Nothing new is stored in the database or the browser, and nothing new is sent to a third party. One thing is **removed**: a guest's browser no longer keeps a copy of the library (SEC-01).

## Stack

Kept as it is: an interactive app with client-side state and no SEO need (Vite + React), with a small back end because it holds secrets and checks permissions (Express locally, the same handlers as Vercel functions). Two small libraries were added, each for one job: `sanitize-html` (server) and `dompurify` (browser) for SEC-03, because a hand-written HTML cleaner is the kind of code that gets bypassed. Playwright and axe are test-only.

The security headers are a few lines of our own code, not a library, so the Express server and `vercel.json` can be kept identical by eye.

## Decisions worth knowing

- **Guests stay on** (owner's choice). They are read-only, limited per address, and off unless switched on explicitly. The remaining risk (a guest can read every document) needs a per-document "public / internal" mark, proposed separately.
- **The AI proxy is admin-only.** Viewers never needed it: Ask the Brain runs on the server. The one viewer use (writing example questions) moved to admins.
- **Fail closed.** A missing guest setting means no guests; a hosted site with no sign-in means no AI proxy; a wrong setting for the Supabase address cannot widen the Content-Security-Policy.
- **One handler for both hosts.** The proxy rules live in `server/groqHandler.js`, used by Express and by the Vercel function, so they cannot drift apart.
- **`style-src 'unsafe-inline'`** is allowed in the policy because the app styles its components inline. Scripts are not: no inline script, no `eval`. Phase 3 moves styling to a stylesheet, after which this can be tightened.

## Logic check

- Circular dependencies: none.
- Every requirement has exactly one owner: yes (table above; SEC-03 has an owner and a named safety net).
- Nothing stored or sent beyond the requirements: yes (data inventory above).
- Every external service has a fallback: see `docs/FALLBACKS.md`.
- No secrets in the browser or the repository: checked (`docs/VERIFICATION.md`).

## Design brief for Phase 3 (visuals)

- **Who:** YYC advisors looking something up between client meetings, and a few admins who add and review material. Calm, professional, quick to scan.
- **The one main task:** find the strategy or answer you need. Search and Ask the Brain are the most prominent things on the first screen; admin tools are present but quiet.
- **Tone:** plain words, no jargon, confident but never alarming. Errors say what happened and what to do next.
- **Hierarchy:** one clear title per screen, one primary action per screen, secondary actions as quiet buttons, destructive actions always confirmed.
- **States every screen needs:** empty (with a hint for what to do first), loading (skeletons, not a blank page), error (with retry), success (a short confirmation), and "busy, do not leave" for extraction and saving.
- **Brand:** YYC maroon and gold on warm neutrals; a dark theme that follows the system setting.
- **Motion:** small and quick (transform only), none when the system asks for reduced motion.
- **Where delight is welcome:** the first-run empty state and the moment an extraction finishes. Nowhere else.


## Phase 4: easier to use (design notes)

- **The address is the source of truth for "where am I".** `src/lib/route.js` holds one value (tab, open document and section, library filters, Explorer filters) that the whole app reads with `useRoute()` and changes with `navigate()`. It lives after the `#`, so no server setting is needed and unknown addresses still get the real 404. Tab changes and opening a document add a Back step; filters and typing replace the current step (rewritten at once for a single change, at most every 0.2 s while typing). Closing a document that was opened with a Back step goes back one step, so Back never reopens it.
- **Everything read from the address is untrusted.** It is checked against a whitelist (tab names, sort names, an id pattern, length limits, no control characters); anything else falls back to the default. Text is only ever shown through React, never as HTML.
- **Colour roles.** Brand crimson = identity and primary actions. Vermilion (`--red`) = errors and destructive actions only, shown as a light card with an icon (toast) or the dedicated danger button. Gold = highlights and notes. Green = success. A confirm button for a destructive action is the danger button, never the brand button.
- **Copying never fails silently.** Modern clipboard, then the older hidden-box method, then a window with the text selected. Copy buttons stop the click, so pressing one does not open the card it sits on.
- **Recently deleted is possible because nothing is hard-deleted.** Deleting a material marks its strategies deleted in the same moment, so restoring it brings back exactly those; a strategy deleted earlier on its own stays listed until restored by itself, and a strategy cannot come back before its material.
- **The not-found page is static** (it must work when the app cannot start): its own styles, an external script (the security policy blocks inline scripts) and a `<noscript>` meta refresh as the no-JavaScript fallback.
