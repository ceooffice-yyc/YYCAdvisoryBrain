# Speed: what was measured, what changed

All numbers are for a **slow phone on a slow connection**, on purpose: the network is limited to about 1.6 Mbit/s with 150 ms delay and the processor is made 4 times slower,
because that is where speed matters. The library used is invented: **300 documents and 2,400 lever records**. Browser: Chrome, built app served by the Express server.
Run it yourself with `npm run perf` (it saves its numbers to `e2e/.results/perf-<label>.json`; set `PERF_LABEL` and `PERF_RUNS`).

## Before and after

| Measure | Before | After | Change |
|---|---|---|---|
| First document card on screen | 12,978 ms | **2,282 ms** | 82% faster |
| First thing painted (a loading message) | 7,380 ms | **724 ms** | 90% faster |
| Script downloaded for the first page (compressed) | 296 kB | **126 kB** | 57% less |
| Script downloaded for the first page (uncompressed) | 1,048 kB | **413 kB** | 61% less |
| Typing in the Knowledge Base search: worst keystroke | 1,272 ms | **152 ms** | 88% faster |
| Typing in the Knowledge Base search: typical slow keystroke (95th percentile) | 552 ms | **72 ms** | 87% faster |
| Typing in Ask the Brain: worst / 95th percentile | 80 / 56 ms | **56 / 40 ms** | already fine |

"Before" is the code of 2026-11-19 before this work (median of 3 runs); "after" is the median of 5 runs. Both on the same computer, so the comparison is fair; the absolute numbers on another computer will differ.

## What changed, and what each part was worth

1. **The Word reader and the HTML cleaner are downloaded only when used** (a file is uploaded; a document is opened). The Word reader alone was 122 kB of the 296 kB. First card 13.0 s → 5.3 s.
2. **Responses are compressed** by the Express server (Vercel already did this), and built files get a one-year cache header (`vercel.json`, and the Express server).
3. **The Knowledge Base list does not redo its work on every keystroke.** Before, each letter typed re-counted the records for each of the 300 documents (720,000 comparisons), re-worked each document's industry, and redrew all 300 cards. Now the counts and industries are worked out once when the library changes, the search is deferred so the box answers at once, the cards are memoised, and cards off screen are not drawn (`content-visibility`). Worst keystroke 1,272 ms → 200 ms.
4. **`src/App.jsx` (5,690 lines) is split into 26 modules** (see the README, "Project structure"), and each screen is downloaded the first time it is needed. The first page now carries only the shell and the Knowledge Base. First card 5.3 s → 2.5 s.
5. **A loading page is drawn straight away** (static HTML in `index.html`, then the same message while sign-in is checked), and the Knowledge Base code is fetched at the same time as the sign-in check instead of after it. First paint 2.1 s → 0.7 s.
6. **Grey placeholders shaped like each screen** (cards for the Knowledge Base, a centred prompt for Ask the Brain, rows for the Lever Explorer, Users and the Gap Log) instead of blank space or "…", so nothing jumps when the real content arrives.
7. **The first screen carries its own styles** (inline in `index.html`), so it is never shown as raw unstyled HTML, even in the dev server (which adds the stylesheet with JavaScript) or on a slow network.

A finding worth keeping: the first version of the placeholders had a moving shimmer. In the measurements it made typing on the slow-phone setup about three times slower (95th percentile 48 ms → 150 ms), so the placeholders are deliberately still.

## Where the first page's 126 kB goes

| File | Compressed | What it is |
|---|---|---|
| `index-*.js` | 98 kB | React itself (about 66 kB) and the app shell: styles, text, navigation, sign-in |
| `KnowledgePanel-*.js` | 25 kB | The Knowledge Base screen (including the admin screens, which are not split out yet) |
| small shared files | 3 kB | |

Downloaded only when used: the Word reader (122 kB), the sign-in library (55 kB, only with sign-in), the extraction code (19 kB), the HTML cleaner (11 kB), Ask the Brain (11 kB), the Lever Explorer (5 kB), Users (4 kB), the document window (3 kB).

## Keeping it fast

- `npm run build && npm run budget` fails if the first page grows past 150 kB compressed, if a screen grows past 40 kB, or if the Word reader, HTML cleaner, extraction code or a screen is folded back into the first page. It also runs as a test (`e2e/loading.spec.js`).
- `npm run perf` fails if the first card takes longer than 7 s, the first page is over 170 kB, or search typing is over 400 ms (coarse limits that only catch a return to the old behaviour).
- When you add a feature to a screen, put it in that screen's file; when you add a big library, load it with `import()` where it is used.

## Not done, and why

- **The admin screens (add, extract, review, edit, bulk) are still inside the Knowledge Base file**, so a viewer downloads about 15 kB (compressed) of admin code they never use. Splitting them needs the screen's shared state moved first; it is the next-largest saving.
- **Long lists are not windowed.** With about 300 documents the cards are cheap enough (off-screen cards are skipped by the browser). Past about 1,000 documents a "show more" or a windowed list would be needed.
- **React itself (66 kB)** is the largest single piece left and cannot be avoided.
- **The sign-in library (55 kB) is downloaded on every sign-in screen.** It is needed there; only guests in browser-only mode skip it.
