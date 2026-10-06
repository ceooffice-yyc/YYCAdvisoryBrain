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

`price` -> `volume` → `cogs` -> `overheads` -> `ar_days` -> `inventory_days` -> `ap_days` -> `talent_strategy` -> `product_differentiation` -> `others`

`others` records also carry a category (legal/IP, partnerships, regulatory, moat, expansion, financing, tech/systems, operations, misc) and a short "related to" note.

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
| `PORT` | `8787` | Port of the Express server. |
| `HOST` | `127.0.0.1` | Set `HOST=0.0.0.0` only to share `npm start` on your LAN. |

### Sharing on the office network

1. Run `npm run dev:lan` (or `npm start` with `HOST=0.0.0.0` in `.env`).
2. Open `http://<your-PC-IP>:5173` (dev) or `:8787` (`npm start`) on the other device.
3. If it does not load: allow inbound TCP 5173/8787 in Windows Firewall (the Wi-Fi profile is often "Public"), and note some office Wi-Fi networks isolate devices from each other.

> Anyone who can reach the server can use your Groq key through the proxy. Only do this on a network you trust.

---

## Deploy to Vercel

The repo is Vercel-ready: the static site is built by Vite and `api/groq/chat.js` replaces the Express proxy.

There  is an **available deployed web site** that you might get reach on: 

👉 [Click here to visit YYC Advisory Brain](https://yyc-advisory-brain.vercel.app/)

1. Push to GitHub and import the repo in Vercel (framework preset: **Vite**).
2. **Project -> Settings -> Environment Variables:** add `GROQ_API_KEY` (Production + Preview).
3. Redeploy (a new key only applies to new deployments).

Things to know when hosted:

- The function has `maxDuration = 60` s, because a long document can take 20–40 s of model time per chunk.
- **Each person has their own library. (FOR CURRENT STATE ONLY)** Data is stored in the browser's `localStorage` (≈5 MB). The Vercel site starts empty and is not shared between staff or with `localhost`. Move data with **Export backup** and **Import backup** (Knowledge Base tab).
- Plan to do a shared library by using an online database? **(FOR FUTURE STATE)** 
- The site and `/api/groq/chat` are **public** unless you protect the deployment, so anyone with the link can spend your Groq quota.

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
| `npm start` page does not update | Stop the server and run `npm start` again; it serves the last build. |
| `localhost:5173` unreachable after `npm start` | `npm start` uses **:8787**; `:5173` is dev mode only. |
| Not reachable from another device | Use `npm run dev:lan`, allow the ports in Windows Firewall, check for Wi-Fi client isolation. |
| A strategy is missing or misfiled | Re-upload after restarting the server (old records keep their old values). If it persists, check the document's heading wording against the list above. |
| "Quota"/import error | `localStorage` is limited to ~5 MB; export a backup and remove old documents. |

---

## Project structure

```
api/groq/chat.js     Vercel serverless proxy to Groq (production)
server/index.js      Express proxy + static server (local / npm start)
src/App.jsx          The whole app: UI, extraction pipeline, chat, storage helpers
src/main.jsx         Entry point + localStorage shim (window.storage)
public/logo.png      YYC logo (served at /logo.png)
index.html           HTML shell
vite.config.js       Dev proxy: /api → http://127.0.0.1:8787
.env.example         Required environment variables
```

## Security notes

- The Groq key stays on the server (`.env` locally, Vercel env vars when hosted); `.env` is git-ignored.
- The admin passcode is a convenience lock stored with the data, **not** real authentication. Anyone with browser access to the data can read it. Do not treat the library as confidential on a public deployment without adding proper access control.
