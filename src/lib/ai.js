// Calls to the AI proxy: the per-minute token budget, retries, rate-limit waits and error wording.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.
import { estimateTokens } from "./util.js";

const GROQ_URL = "/api/groq/chat"; // proxied server-side so the API key never reaches the browser
const GROQ_MODEL = "openai/gpt-oss-120b";
/* ---- client-side TPM budget: Groq admits a request as (input tokens + max_tokens),
   so every call reserves its estimated footprint in a rolling 60s window and waits
   its turn instead of colliding into 429s ---- */
const PER_KEY_TPM = 7600; // slightly under the 8,000 TPM limit of ONE Groq key: also the biggest a single request may be
const tpmLog = []; // {at, tokens}
/* Fast extraction (on by default; the tick box on the Add material screen, stored as localStorage "yyc:fast"): the server holds several
   Groq keys and spreads load over them, so the per-minute budget is PER_KEY_TPM x the number of keys and several chunks of one document
   are extracted at once. Off = the original behaviour: one key's budget, one chunk at a time, a pause between bulk documents. */
export const fastExtraction = () => { try { return localStorage.getItem("yyc:fast") !== "0"; } catch { return true; } };
let groqKeysPromise = null;
function groqKeyCount() { // asked once from the server; 1 when unknown
  if (!groqKeysPromise) groqKeysPromise = Promise.resolve(window.storage?.authHeader?.()).then((h) => fetch(GROQ_URL, { headers: h || {} })).then((r) => (r.ok ? r.json() : {})).then((j) => Math.max(1, Math.min(8, Number(j && j.keys) || 1))).catch(() => 1);
  return groqKeysPromise;
}
export const keysInUse = async () => (fastExtraction() ? groqKeyCount() : 1);
async function reserveTPM(need) {
  const limit = PER_KEY_TPM * (await keysInUse());
  for (; ;) {
    const now = Date.now();
    while (tpmLog.length && now - tpmLog[0].at > 60000) tpmLog.shift();
    const used = tpmLog.reduce((sum, x) => sum + x.tokens, 0);
    if (used + need <= limit) { tpmLog.push({ at: now, tokens: need }); return; }
    const waitMs = tpmLog.length ? 61000 - (now - tpmLog[0].at) : 2000;
    await new Promise((r) => setTimeout(r, Math.min(Math.max(waitMs, 1000), 61000)));
  }
}

const SYSTEM_MSG = "You are a precise JSON engine. Always respond with a single valid JSON object and nothing else.";

/* Typed AI failure so the UI can say WHY (daily quota vs per-minute limit vs other), not just "call failed" */
export class AIError extends Error {
  constructor(kind, waitSec, detail) { super(detail || kind); this.kind = kind; this.waitSec = waitSec; }
}
// Groq says e.g. "Please try again in 9m10.36s" / "1h2m3.5s" / "45.2s"
function parseRetryHint(msg) {
  const m = String(msg || "").match(/try again in\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*([\d.]+)s/i);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + parseFloat(m[3]) : 0;
}
let aiListener = null; // the visible panel subscribes to show live rate-limit waits
export const setAiListener = (fn) => { aiListener = fn; };
const aiNotify = (n) => { try { aiListener && aiListener(n); } catch { /* UI gone */ } };
function fmtWait(sec) {
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.ceil((sec % 3600) / 60)}m`;
  if (sec >= 60) return `${Math.ceil(sec / 60)} min`;
  return `${sec}s`;
}
/* Errors from Ask the Brain: the hosted server sends { kind, waitSec, message }; the in-browser mode throws AIError */
export function describeAskError(e, t) {
  const wait = fmtWait(Math.max(1, Math.ceil(Number(e && e.waitSec) || 30)));
  if (e && e.kind === "daily") return t.rateDaily.replace("{time}", wait);
  if (e && e.kind === "minute") return t.rateMinute.replace("{time}", wait);
  if (e && e.kind === "user_rate" && e.message) return e.message;
  return e instanceof AIError ? describeAIError(e, t) : t.apiErr;
}
export function describeAIError(e, t) {
  if (e instanceof AIError && e.kind === "daily") return t.rateDaily.replace("{time}", fmtWait(e.waitSec));
  if (e instanceof AIError && e.kind === "minute") return t.rateMinute.replace("{time}", fmtWait(e.waitSec));
  return t.apiErr;
}

export async function askAI(userContent, maxTokens = 1500, maxRetries = 2) {
  let useReasoningParam = true; // gpt-oss is a reasoning model: cap hidden thinking so it doesn't eat the JSON budget
  let rateWaits = 0; // 429s: wait out the TPM window instead of failing (max 3)
  const inputTok = estimateTokens(SYSTEM_MSG + userContent) + 60;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      /* clamp so input + max_tokens always fits inside one minute's quota */
      const effMax = Math.max(600, Math.min(maxTokens * (i + 1), PER_KEY_TPM - inputTok - 100));
      await reserveTPM(inputTok + effMax);
      const body = {
        model: GROQ_MODEL, temperature: 0.1,
        max_tokens: effMax,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_MSG },
          { role: "user", content: userContent },
        ],
      };
      if (useReasoningParam) body.reasoning_effort = "low";
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...((await window.storage?.authHeader?.()) || {}) },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.text();
        if (useReasoningParam && e.includes("reasoning_effort")) { useReasoningParam = false; i--; continue; }
        if (res.status === 400 && /json_validate_failed/i.test(e)) throw new AIError("json_output", 0, e);
        if (res.status === 429) {
          const ra = parseFloat(res.headers.get("retry-after")) || parseRetryHint(e) || 60;
          // Daily quota (TPD): waiting inside the request would look like a hang and can take hours. Fail fast, tell the user.
          if (/tokens per day|\(TPD\)/i.test(e)) throw new AIError("daily", Math.ceil(parseRetryHint(e) || ra), e);
          if (rateWaits < 3) {
            rateWaits++;
            const total = Math.ceil(ra + 2);
            for (let left = total; left > 0; left--) { aiNotify({ kind: "wait", sec: left }); await new Promise((r) => setTimeout(r, 1000)); }
            aiNotify(null);
            i--; continue; // rate wait doesn't burn a retry
          }
          throw new AIError("minute", Math.ceil(ra), e);
        }
        throw new AIError("http", 0, `Groq ${res.status}: ${e.slice(0, 200)}`);
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "";
      const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
      const start = clean.indexOf("{"); const end = clean.lastIndexOf("}");
      if (start === -1 || end === -1) throw new Error("no json in response");
      return JSON.parse(clean.slice(start, end + 1));
    } catch (e) {
      console.error("Groq call error:", e);
      aiNotify(null);
      if (e.message?.includes("exceeds safe limit")) throw e;
      if (e instanceof AIError && (e.kind === "daily" || e.kind === "minute" || e.kind === "json_output")) throw e; // retrying the same input cannot help
      if (i === maxRetries) throw e;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}