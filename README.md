# YYC Advisory Brain

An internal, **closed-book** knowledge base for YYC's advisory work. Upload case studies (`.docx`), and the app uses AI to pull out every **key strategy**, file it under the right **cash lever**, and keep the document's own wording and impact. Staff can then browse strategies by lever or ask questions that are answered **only from the uploaded material**, with sources.

- **Tech Stack:** React 19 + Vite 8, a tiny Express proxy (local) / Vercel function (hosted), [Groq](https://groq.com) (`openai/gpt-oss-120b`) for AI, [mammoth](https://github.com/mwilliamson/mammoth.js) for reading `.docx`.
- **Supported Language:** English only for now. The Chinese UI and Chinese extraction fields are switched off (commented out in `src/App.jsx` *in order to save tokens usage*, search for `[ZH disabled for now]`).

---

## What it does

| Tab | Purpose |
|---|---|
| **Knowledge Base** | Library of uploaded documents. Admins upload `.docx` files (single or bulk), review the extracted strategies, edit, delete, back up and restore. |
| **Ask the Brain** | Chat that answers **only** from the library, with citations and verbatim evidence. Anything outside the library is refused. Use `@Document Title` to focus on one document. |
| **Lever Explorer** | Pick a lever (price, volume, cogs…) and see every strategy across all documents side by side, with its impact and source. |
| **Gap Log** *(admin)* | Questions the library could not answer, so you know which material is missing. |

### The levers

Strategies are grouped in this fixed order:

`price` -> `volume` → `cogs` -> `overheads` -> `ar_days` -> `inventory_days` -> `ap_days` -> `talent_strategy` -> `product_differentiation` -> `acquisition_expansion_valuation` -> `others`

`acquisition_expansion_valuation` ("Acquisition, Expansion & Valuation") is for M&A material: acquisition appetite and criteria, buy-and-build, valuation and ownership policy, post-acquisition operating model.

`others` records also carry ONE category and a short "related to" note. The categories (defined once in `OTHER_CAT_DEFS` in `src/App.jsx`):

| Category | What goes in it |
|---|---|
| Legal, Regulatory & IP | legal, regulatory and IP combined: trademark enforcement, licences, contracts, lease clauses |
| Business Model / Execution | how the business runs and continues itself: e.g. a strict direct-to-customer model, hyper-focused positioning, doubling down on what works |
| Financing & Capital | debt, investors/equity, self-funding and reinvestment, cash reserves |
| Operations & Process | SOPs and operating processes |
| Partnerships & Alliances | brand tie-ups, distribution deals, JVs, partner networks |
| Shareholder Governance | avoid 50:50 ownership, divide roles clearly, shareholder rights |
| Uncategorized | only when none of the above fit |

The category is not left to the big extraction prompt: after extraction, one small dedicated call (`classifyOthers`) files every `others` record into exactly one category, so records that the code moved to Others (because they sit under an "Other…" heading) are never left without one.

### How a strategy is shown

```
Strategy name: description (the document's ORIGINAL own words)
┌──────────────────────────────────────────────┐
│ Actual impact: the document's impact text    │ <-- light-brown box; "N/A" if the document doesn't have
└──────────────────────────────────────────────┘
```

---

## Quick start (local)

Requirements: **Node.js 20.19+ (or 22.12+)** and a free [Groq API key](https://console.groq.com/keys).

```bash
npm install
cp .env.example .env # then put your key in .env:  GROQ_API_KEY="xxx"
npm run dev # web app on http://localhost:5173 + API proxy on :8787
```

Open **http://localhost:5173**.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | **Dev mode:** Vite (hot reload) + the Express proxy. |
| `npm run dev:lan` | Same, but **reachable from other devices on your Wi-Fi (`vite --host`)**. Use this, **not** `npm run dev -- --host`. |
| `npm start` | **Builds**, then serves the built app **and** the proxy from one process on **http://localhost:8787**. Best for daily use. Rebuild (stop + `npm start` again) after code changes. |
| `npm run build` | Production build into `dist/`. |
| `npm run lint` | ESLint. |

### Environment variables (`.env`, never committed)

| Variable | Default | Notes |
|---|---|---|
| `GROQ_API_KEY` | – | **Required.** Server-side only; never shipped to the browser. |
| `GROQ_API_KEY_2` … `GROQ_API_KEY_9` | – | Optional extra keys. When a key hits its rate limit (per-minute or per-day) the same request is retried on the next key; see *Multiple Groq keys* below. |
| `PORT` | `8787` | Port of the Express server. |
| `HOST` | `127.0.0.1` | Set `HOST=0.0.0.0` only to share `npm start` on your LAN. |

### Sharing on the office network

1. Run `npm run dev:lan` (or `npm start` with `HOST=0.0.0.0` in `.env`).
2. Open `http://<your-PC-IP>:5173` (dev) or `:8787` (`npm start`) on the other device.
3. If it does not load: allow inbound TCP 5173/8787 in Windows Firewall (the Wi-Fi profile is often "Public"), and note some office Wi-Fi networks isolate devices from each other.

> Anyone who can reach the server can use your Groq key through the proxy. Only do this on a network you trust.

---


### Multiple Groq keys

The free Groq tier allows about 200k tokens/day per key (roughly 8–9 case studies). Put up to 9 keys in `.env` (or Vercel environment variables):

```
GROQ_API_KEY=gsk_...
GROQ_API_KEY_2=gsk_...
GROQ_API_KEY_3=gsk_...
GROQ_API_KEY_4=gsk_...
```

(`GROQ_API_KEYS=key1,key2,key3` also works.) Behaviour, implemented in `server/groqProxy.js` and shared by the Express server and the Vercel function:

- Key 1 is used first. If Groq answers **429** (per-minute or per-day limit), that key is set aside until its reset time and the **same request is retried on the next key**, so the browser only sees a rate-limit error when *every* key is limited.
- A key that was **rejected (401/403)** is skipped for 10 minutes; a network error moves on to the next key.
- Once a benched key has recovered it is preferred again, in order.
- Keys stay on the server and are never logged. Each key has its own quota, so the keys should belong to different Groq accounts/organisations; several keys of one organisation share one limit.

## Shared online database + sign-in (Supabase)

By default each browser keeps its own copy of the library and anyone can open it. To share one library with the whole team **and require a sign-in**, use Supabase. It is switched on by server settings; with them absent nothing changes.

**1. Create the project** at [supabase.com](https://supabase.com) → *New project* (choose a region near you; save the database password).

**2. Create the tables.** *SQL Editor → New query*, paste [`supabase/schema.sql`](supabase/schema.sql) and run it (safe to run again). It creates real tables: **`documents`**, **`records`** (one row per extracted strategy), **`levers`** (the lever definitions the extraction prompt is built from), **`gap_log`**, **`chats`** and **`suggestions`**. Row Level Security is on with **no public policy**, so the public key cannot read or write anything. Earlier versions kept everything in one `kv` table; it is no longer used and is left untouched.

**3. Switch sign-up off and create your people.** *Authentication → Sign In / Providers → Email*: turn **off** "Allow new users to sign up" (and "Confirm email" can stay on or off). Then *Authentication → Users → Add user → Create new user*: enter their company email and a password, and tick **Auto Confirm User**. Do this for every person. Send them the password; no emails are needed. To reset a forgotten password, edit the user in the same screen.

**4. Copy the keys.** *Project Settings → API*: the **Project URL**, the **anon public** key and the **service_role** secret.

**5. Add the settings** to `.env` (local) and to Vercel → Settings → Environment Variables (Production + Preview), then restart / redeploy:

```
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=eyJ...                 # public key: sent to the page so it can sign people in
SUPABASE_SERVICE_ROLE_KEY=eyJ...         # SECRET: server only, never prefix with VITE_, never commit it
ADMIN_EMAILS=you@yourcompany.com,boss@yourcompany.com   # who are admins; everyone else who can sign in is a viewer
ALLOWED_EMAIL_DOMAINS=yourcompany.com    # optional extra guard
ALLOW_GUEST=false                        # optional: remove the Continue-as-guest button and block guest reads
```

The server prints `Shared database + sign-in: Supabase` at start-up. (An admin can also be made with `app_metadata.role = "admin"`; see the bottom of `supabase/schema.sql`.)

**6. Move your existing library.** In the *old* setup (the browser or the earlier deployment that has the data) use **Export backup**; after the switch, sign in as an admin and use **Import backup**. Documents, strategies, custom levers, edited built-in levers and Others sub-categories all come with it; anything already in the new database is kept and duplicates are skipped.

How it works (`server/auth.js`, `server/db.js`, `api/db.js`, `src/db.js`, `src/storage.js`, `src/Root.jsx`):

- **Everyone signs in** (email + password), or presses **Continue as guest**. A guest can only **browse the knowledge base and the lever records** (including opening documents): there is no Ask the Brain, no Gap Log, no chat and no editing, and the AI proxy still refuses them. The bottom-left button is **Log in** for a guest and **Log out** for a signed-in person. Guest access lasts for that browser tab. Turn guests off with `ALLOW_GUEST=false`; note that while guests are on, **anyone with the link can read the whole library**. The Groq AI proxy requires the same sign-in, so strangers cannot spend your quota.
- The browser keeps only a session token; every call to `/api/db` and `/api/groq/chat` carries it and the **server** checks it with Supabase. The service-role key never leaves the server. The app talks to the database only through `window.db` (`src/db.js`); with no Supabase the same interface runs on the browser's localStorage, so local development works unchanged.
- **Viewers** (signed in) can read the library, ask questions, and add to the Gap Log. **Admins** (see `ADMIN_EMAILS`) can also change the library: admin accounts are in admin mode as soon as they log in (no Unlock admin button and no shared passcode any more).
- **Chat history is personal**: it is saved per signed-in person (the `chats` table), follows them to any browser or device, and only they (and admins) can read it.
- **Nothing is hard-deleted.** Every row of every table has a `status` (`active` / `deleted`) and `deleted_at`; deleting a document, a strategy, a lever or a gap-log entry only marks it `deleted`, and it disappears from the app. Removing a strategy on the Edit screen and "Clear chat" / "Clear gap log" are soft too. The data stays in Supabase; restore with the SQL at the bottom of `supabase/schema.sql`.
- **Who did what:** every row records `created_by`, `updated_by` and `deleted_by` (the person's email).
- **Lever definitions live in the `levers` table.** Custom levers (name, definition, example, heading words), edits to the 10 built-in levers and the Others sub-categories are rows there, and the **extraction prompt is built from them** every time: a lever you add in *Lever Explorer → Manage lever categories* is part of the next extraction (its id is an allowed value, its definition and example are listed with the built-in levers, and a document heading matching its heading words or its name is filed under it). Existing records keep their lever; re-run extraction on a document to re-sort it.
- **Speed.** The library (lever definitions, document list, lever records) is requested in one call as soon as the page opens, while the sign-in screen is still showing, and again the moment someone signs in, so it is usually waiting when the app appears. A copy is kept in the browser, so a returning visitor sees the library immediately while the fresh copy loads; it is erased on log-out (on a shared computer, log out). Documents are cached in memory for 5 minutes (previews and Ask the Brain), and loaded in the background when you hover a card or open Ask the Brain. Anything about to change data reads fresh from the server. Large tables are read page by page (Supabase returns at most 1,000 rows per request). For the best response time, deploy the Vercel functions in the same region as your Supabase project.
- If the database cannot be reached, the app shows an error instead of an empty library, so a failed read can never overwrite real data. A session that ends (or is revoked) returns the person to the sign-in screen; access changes can take up to a minute to apply.
- Each edit saves only what changed (one document, one record, one lever), so two admins no longer overwrite each other's whole library; the last save of the *same* item wins.
- Free tier: 500 MB, and a project with no activity for about a week is paused (resume it from the dashboard).
- If `SUPABASE_URL` and the service-role key are set but `SUPABASE_ANON_KEY` is missing, the app shows a "server is not set up correctly" screen instead of silently falling back to browser storage.

## Deploy to Vercel

The repo is Vercel-ready: the static site is built by Vite and `api/groq/chat.js` replaces the Express proxy.

There  is an **available deployed web site** that you might get reach on: 

👉 [Click here to visit YYC Advisory Brain](https://yyc-advisory-brain.vercel.app/)

1. Push to GitHub and import the repo in Vercel (framework preset: **Vite**).
2. **Project -> Settings -> Environment Variables:** add `GROQ_API_KEY` (and optionally `GROQ_API_KEY_2`, `GROQ_API_KEY_3`, `GROQ_API_KEY_4`) for Production + Preview.
3. Redeploy (a new key only applies to new deployments).

Things to know when hosted:

- The function has `maxDuration = 60` s, because a long document can take 20–40 s of model time per chunk.
- **Without Supabase, each person has their own library.** Data is stored in the browser's `localStorage` (≈5 MB). The Vercel site starts empty and is not shared between staff or with `localhost`. Move data with **Export backup** and **Import backup** (Knowledge Base tab).
- A shared library for the whole team, with sign-in: see **Shared online database + sign-in (Supabase)** above.
- Without Supabase the site and `/api/groq/chat` are **public** unless you protect the deployment, so anyone with the link can spend your Groq quota. With Supabase sign-in both require a signed-in account.

---

## Using it

### Add a case study (admin)

1. In **Knowledge Base**, unlock admin mode. The default passcode is **`12345`**, so **change it** under the admin settings.
2. Upload one or more `.docx` files. Bulk uploads are processed one after another with pauses for Groq's rate limit.
3. **Review** the extracted strategies: check the lever, the wording and the impact, skip anything wrong, then **Save**. Similar existing strategies are flagged as a warning (nothing is removed automatically).

### Backup and restore

**Export backup** downloads `yyc-brain-backup-YYYY-MM-DD.json` (documents, strategies, config). **Import backup** restores it (existing materials are kept, duplicates are skipped). Do this before clearing browser data or moving to another browser/host.

---

## Document format the extractor expects

It is built for YYC case studies: a narrative part, then an **"Analysis" / "Power Cash Links"** part. Only the **key strategies** part is read, and everything else is deliberately ignored (background, timeline, failed strategies, "Problems Encountered & Solutions", website links).

```
Pricing                              ← lever heading
  No discounts: <description>        ← "Title: description"  (or the title alone on one line, description on the next)
  Actual Impact: <what happened>     ← used as the impact
  Power Cash Link: <why it helps>    ← never used as the impact
Volume
  ...
Other Key Strategies For Growth      ← "Other…", "Strategies Used to Grow…", "Additional … Strategies:" → others
```

Recognised lever headings include Pricing/Price, Volume/Sales, COGS/Cost of Goods Sold, Overhead, Inventory (days), Receivable Days / Accounts Receivable, Payable Days / Accounts Payable, Talent Strategy, Unique Product Differentiation, and "Other…"-style headings. Short summary cards (`Problem / Key Strategy / Formula / Result`) are also supported.

### M&A case studies

A document is treated as an **M&A document** only when it has at least two M&A section headings (it is decided by structure, never by the word "acquisition" appearing in the text, so ordinary case studies that mention an acquisition are unaffected):

```
3. Acquisition M&A Appetite  /  M&A Appetite
4. Acquisition Criteria
5. Post-Acquisition Strategy
6. What <Company> Brings to Acquired Companies
```

Only those sections are read (background and the closing one-line summary are ignored). In code each strategy or criterion is first turned into one block, `Title: <all its text>`, so quote lines, list items and bullets stay inside their strategy and never become records of their own. A block without a title (for example the whole Post-Acquisition section) is named with a phrase copied word for word from the document. The "What <Company> Brings…" section always becomes **one** record. All records use the Acquisition, Expansion & Valuation lever, and a realised result (for example revenue that grew after an acquisition) goes in the impact box.

---

## How extraction works

The extraction is a code + AI pipeline in `src/App.jsx` (`extractDocument`). The model is **not** trusted to structure the document or copy it faithfully, so the code does that part:

1. **Scope** – keep only the key-strategies part (`scopeMaterial`).
2. **Tidy** – merge "title line + description line" layouts into `Title: description`, drop table-template leftovers (`normalizeParas`).
3. **Chunk** – split into small chunks (≤ ~3,800 chars / 6 strategies) that never end on a heading, and tell each chunk which heading it continues under (`chunkMaterial`). One call per chunk keeps every answer small enough to fit the model's output budget.
4. **Extract** – one Groq call per chunk returns `strategy_name`, `description`, `impact`, `lever`, `section`.
5. **Coverage guarantee** – the code finds every `Title: description` in the document; any title with no record is re-sent once in a recovery call (`findStrategyParas`).
6. **Fix up in code** – lever and section come from the heading the strategy actually sits under (not the model's guess); descriptions and impacts are restored to the document's **exact original words, at any length** (labelled "Actual Impact / Impact / Financial Impact / Result" paragraphs are used whole); a Power Cash Link is never accepted as an impact (→ `N/A`); look-alike characters are normalised; records are sorted by lever, then document order.

Closed-book chat (`ChatPanel`) retrieves the most relevant documents and passages, asks the model to answer only from them with verbatim evidence, and logs refused questions to the Gap Log.

---

## Groq limits and the on-screen messages

The free Groq tier has two limits that matter:

- **Per minute** (~8,000 tokens): the app paces itself and shows a live "retrying in Ns" countdown if it is hit.
- **Per day** (200,000 tokens): when reached, the app stops and shows how long until it resets. A long document costs roughly 20–25k tokens, so the free tier covers about 8–9 documents per day. The Dev tier removes the cap.

If you see `429` in the browser console, this is the cause.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Logo missing on Vercel | The logo lives in `public/logo.png` and is referenced as `/logo.png`. Make sure that file is committed. |
| AI calls fail on Vercel | `GROQ_API_KEY` not set (or set but not redeployed). |
| "Daily limit" message although you added more keys | The extra keys must be named `GROQ_API_KEY_2`, `_3`, … (or listed in `GROQ_API_KEYS`), and the server restarted / Vercel redeployed. The console shows `Groq keys loaded: N` at start-up. |
| `npm start` page does not update | Stop the server and run `npm start` again; it serves the last build. |
| `localhost:5173` unreachable after `npm start` | `npm start` uses **:8787**; `:5173` is dev mode only. |
| Not reachable from another device | Use `npm run dev:lan`, allow the ports in Windows Firewall, check for Wi-Fi client isolation. |
| A strategy is missing or misfiled | Re-upload after restarting the server (old records keep their old values). If it persists, check the document's heading wording against the list above. |
| "Your session has ended" / back at the sign-in screen | The login expired or was revoked: sign in again. |
| "Your account is not an administrator" | Add the email to `ADMIN_EMAILS` (or set `app_metadata.role = admin`) and restart / redeploy. |
| "Wrong email or password" for a correct password | The user must exist in Supabase → Authentication → Users and be confirmed; check the project URL / anon key belong to the same project. |
| Library looks empty after enabling Supabase | The new database starts empty: use Export backup in the old browser, then Import backup. If the page shows a database error instead, check `SUPABASE_URL`, the service-role key, and that the latest `supabase/schema.sql` was run (it creates the tables the app reads). |
| "Quota"/import error | `localStorage` is limited to ~5 MB; export a backup and remove old documents. |

---

## Project structure

```
api/groq/chat.js     Vercel serverless proxy to Groq (production)
server/index.js      Express proxy + static server (local / npm start)
src/App.jsx          The whole app: UI, extraction pipeline, chat, storage helpers
src/main.jsx         Entry point (starts the storage layer, then the app)
src/storage.js       window.storage: this browser's storage + Supabase sign-in (guest mode, session token)
src/db.js            window.db: every read/write of the library; Supabase through /api/db, or localStorage
src/Root.jsx         Sign-in screen + error screen shown before the app
server/auth.js       Verifies the Supabase session on every request; decides who is an admin
server/db.js           /api/db: documents, records, levers, gap log, chats; roles; soft delete
api/db.js              Vercel twin of the /api/db route
supabase/schema.sql  The tables to create in Supabase (documents, records, levers, gap_log, chats, suggestions)
public/logo.png      YYC logo (served at /logo.png)
index.html           HTML shell
vite.config.js       Dev proxy: /api → http://127.0.0.1:8787
.env.example         Required environment variables
```

## Security notes

- The Groq key stays on the server (`.env` locally, Vercel env vars when hosted); `.env` is git-ignored.
- **With Supabase** everyone signs in with their own account; admins are decided on the server (`ADMIN_EMAILS`), there is no shared passcode, and only admins can change or delete. Keep sign-up switched off in Supabase so only people you create can get in.
- **Without Supabase** the admin passcode is a convenience lock stored with the data, **not** real authentication. Anyone with browser access to the data can read it. Do not treat the library as confidential on a public deployment without adding proper access control.
