/* global process */
// The AI client used by the hosted Ask the Brain pipeline. Server only: the Groq keys never leave the server.
//
// What it does for everybody at once (the browser used to guess this for itself, per tab):
//   * a shared per-minute token budget that SMOOTHS traffic: a request that does not fit waits a few seconds for room, then goes ahead anyway.
//     The budget is advisory. The real referee is Groq, whose rate limit (429) makes server/groqProxy.js move to the next key;
//   * the budget is charged with what a call really used (Groq reports it), not with the worst case, so it does not shut out a lone user;
//   * if every key is limited and the wait is short, the call waits and retries once instead of failing; longer waits come back as a typed
//     error that says how long to wait, never as a raw upstream message;
//   * the JSON reply is parsed, and retried once with more room if it was cut off or malformed.

import { forwardToGroq, loadGroqKeys } from '../groqProxy.js';

export const GROQ_MODEL = 'openai/gpt-oss-120b';
const SYSTEM = 'You are a precise JSON engine. Always respond with a single valid JSON object and nothing else.';
const PER_KEY_TPM = 7600;          // just under the 8,000 tokens/minute of one Groq key
const MAX_ROOM_WAIT_MS = 8000;     // how long a call waits for budget before going ahead anyway
const MAX_AUTO_WAIT_SEC = 20;      // a rate limit that clears within this long is waited out, once or twice, instead of failing

export class LlmError extends Error {
  constructor(kind, message, waitSec = 0) { super(message); this.kind = kind; this.waitSec = waitSec; }
}

const estimateTokens = (s) => Math.ceil(String(s || '').length / 3.5);
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A rolling 60-second token budget shared by all callers. reserve() returns a handle; settle() replaces the estimate with the real usage. */
export function makeBudget({ limit, now = Date.now, sleep = realSleep, maxWaitMs = MAX_ROOM_WAIT_MS }) {
  const log = [];
  return {
    async reserve(tokens) {
      const need = Math.min(tokens, limit); // one call can never need more than the whole budget
      const started = now();
      for (;;) {
        const t = now();
        while (log.length && t - log[0].at > 60000) log.shift();
        const used = log.reduce((s, x) => s + x.tokens, 0);
        const entry = { at: t, tokens: need };
        if (used + need <= limit) { log.push(entry); return { entry, waited: t - started, over: false }; }
        const waitMs = log.length ? 61000 - (t - log[0].at) : 1000;
        if (t - started + Math.min(waitMs, 2000) > maxWaitMs) { log.push(entry); return { entry, waited: t - started, over: true }; } // go ahead: Groq decides
        await sleep(Math.min(Math.max(waitMs, 300), 2000));
      }
    },
    settle(handle, actualTokens) { if (handle && Number.isFinite(actualTokens) && actualTokens > 0) handle.entry.tokens = actualTokens; },
    _log: log,
  };
}

const parseJson = (text) => {
  const clean = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no json in response');
  return JSON.parse(clean.slice(start, end + 1));
};

const retryHint = (msg) => {
  const m = String(msg || '').match(/try again in\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*([\d.]+)s/i);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + parseFloat(m[3]) : 0;
};

export function makeLlm({ env = process.env, forward = forwardToGroq, budget, keys, log = console.error, sleep = realSleep } = {}) {
  const groqKeys = keys || loadGroqKeys(env);
  const shared = budget || makeBudget({ limit: PER_KEY_TPM * Math.max(1, groqKeys.length) });

  /* options: maxTokens (ceiling for the reply), retries (for unreadable replies), expectedOutput (what the reply usually needs: used only to
     charge the budget), waitOnLimit:false (fail at once on a rate limit instead of waiting it out: for optional calls), reasoning (how much the
     model thinks first: low | medium | high; default is ASK_REASONING or low. More thinking reads long sources more carefully but is slower and
     uses more tokens) */
  const effortOf = (v) => (['low', 'medium', 'high'].includes(String(v)) ? String(v) : null);
  const defaultEffort = effortOf(env.ASK_REASONING) || 'low';
  async function json(prompt, { maxTokens = 1500, retries = 1, expectedOutput = 600, waitOnLimit = true, reasoning } = {}) {
    const effort = effortOf(reasoning) || defaultEffort;
    let useReasoning = true;
    let lastErr;
    let limitWaits = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const inputTokens = estimateTokens(SYSTEM + prompt) + 60;
      const max = Math.max(600, Math.min(maxTokens * (attempt + 1), PER_KEY_TPM - inputTokens - 100));
      const handle = await shared.reserve(inputTokens + Math.min(max, expectedOutput));
      const body = { model: GROQ_MODEL, temperature: 0.1, max_tokens: max, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] };
      if (useReasoning) body.reasoning_effort = effort;
      const { status, text, retryAfter } = await forward(body, { keys: groqKeys });
      if (status === 400 && useReasoning && /reasoning_effort/i.test(text)) { useReasoning = false; attempt--; continue; }
      if (status === 429) {
        shared.settle(handle, 1); // nothing was used
        const wait = Math.ceil(parseFloat(retryAfter) || retryHint(text) || 60);
        const daily = /tokens per day|\(TPD\)/i.test(text);
        if (!daily && waitOnLimit && wait <= MAX_AUTO_WAIT_SEC && limitWaits < 2) { limitWaits++; attempt--; await sleep((wait + 0.5) * 1000); continue; }
        throw new LlmError(daily ? 'daily' : 'minute', 'The AI service is rate-limited.', wait);
      }
      if (status === 400 && /json_validate_failed/i.test(text)) { lastErr = new LlmError('json_output', 'The AI returned malformed JSON.'); continue; } // retry with more room
      if (status < 200 || status >= 300) throw new LlmError('http', `AI service error (HTTP ${status}).`);
      try {
        const data = JSON.parse(text);
        shared.settle(handle, data.usage && Number(data.usage.total_tokens));
        return parseJson(data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
      } catch (e) {
        lastErr = new LlmError('json_output', `The AI reply could not be read (${e.message}).`);
        log(`AI reply unreadable on attempt ${attempt + 1}: ${e.message}`);
      }
    }
    throw lastErr || new LlmError('http', 'The AI request failed.');
  }
  return { json };
}
