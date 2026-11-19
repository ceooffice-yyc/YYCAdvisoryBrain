# Fallbacks: what happens when something fails

A failure never makes the app more permissive: a check that cannot be made is treated as "no".

| What fails | What the app does | Checked by |
|---|---|---|
| Supabase cannot confirm a session token | The request is refused (401). Repeated failures from one address are slowed (429). | `test/security.test.mjs` SEC-05 |
| `ALLOW_GUEST` is missing or mistyped | Guests are off. | `test/security.test.mjs` SEC-01 |
| Supabase settings missing on a hosted site | The AI proxy answers 503; the database API answers 503. Nothing is served without sign-in. | `test/security.test.mjs` SEC-02 |
| `SUPABASE_URL` is not a valid https address | The Content-Security-Policy falls back to the general Supabase rule; it never becomes wider. | `test/security.test.mjs` SEC-04 |
| A request body is not valid JSON, or is too large | 400 or 413 as JSON, no stack trace. | `e2e/security.spec.js` SEC-02 |
| A caller goes over a rate limit | 429 with the seconds to wait (`Retry-After`). | `test/security.test.mjs` SEC-05 |
| Groq rate-limits a key | The next key is tried; if all are limited the browser is told how long to wait. (Existing behaviour.) | `test/server.test.mjs` |
| Gemini (meaning search) fails | Search continues with keywords only. (Existing behaviour.) | `test/integration.test.mjs` |
| The search index is missing | The server searches the documents directly. (Existing behaviour.) | `test/integration.test.mjs` |
| The ask log or gap list cannot be written | The answer is still returned; the failure is logged on the server. (Existing behaviour.) | `test/server.test.mjs` |
| An invite or reset link is expired or already used | A clear message on the sign-in screen: ask an administrator for a new invite or a temporary password. | Not verified (needs a real email) |
| Stored document HTML is hostile | It is cleaned before display; the Content-Security-Policy would also block any script that slipped through. | `e2e/security.spec.js` SEC-03 |
| An unknown address | A 404 page (pages) or a JSON 404 (API). | `e2e/security.spec.js` ERR-01 |
| The browser blocks storage (private mode) | Preferences are simply not remembered; the app still works. (Existing behaviour.) | Not verified |
