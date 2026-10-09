// llm.js — the one place a model is called. Providers: mistral (bulk, free tier), claude-cli (the owner's Claude Pro
// login via the `claude` binary), mock (tests). Owns call budgeting, spacing, retries and the `usage` log.
import { spawn } from "node:child_process";
import { now } from "./db.js";

export class BudgetError extends Error {
  constructor(maxCalls) { super(`model call budget reached (${maxCalls} calls)`); this.name = "BudgetError"; }
}

const DEFAULT_MODELS = { mistral: "mistral-small-latest", "claude-cli": "haiku", mock: "mock" };
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Models sometimes wrap JSON in a ```json fence; strip it and parse.
export function parseModelJson(text) {
  let s = String(text ?? "").trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (m) s = m[1];
  return JSON.parse(s);
}

async function callMistral({ model, prompt, maxTokens, fetch, sleep, wait }) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error("MISTRAL_API_KEY is not set (get a free key at console.mistral.ai)");
  const body = { model, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, temperature: 0.1 };
  if (maxTokens) body.max_tokens = maxTokens;
  const init = { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) };
  for (let attempt = 0; ; attempt++) {
    await wait(); // spacing applies to retries too
    const res = await fetch(MISTRAL_URL, init);
    if (res.ok) {
      const j = await res.json();
      const usage = { inputTokens: j.usage?.prompt_tokens ?? null, outputTokens: j.usage?.completion_tokens ?? null };
      try { return { data: parseModelJson(j.choices?.[0]?.message?.content), usage }; }
      catch (e) { throw Object.assign(new Error(`mistral returned non-JSON: ${e.message}`), { usage }); }
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const ra = Number(res.headers?.get?.("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    const text = await res.text().catch(() => "");
    throw new Error(`mistral HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

function callClaudeCli({ model, prompt }) {
  return new Promise((resolve, reject) => {
    const bin = process.env.CLAUDE_CLI || "claude";
    const child = spawn(bin, ["-p", "--model", model, "--output-format", "json"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => reject(new Error(`could not run ${bin}: ${e.message}`)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`${bin} exited ${code}: ${err.slice(0, 200)}`));
      let env;
      try { env = JSON.parse(out); } catch (e) { return reject(new Error(`${bin} gave non-JSON envelope: ${e.message}`)); }
      const usage = { inputTokens: env.usage?.input_tokens ?? null, outputTokens: env.usage?.output_tokens ?? null };
      if (env.is_error) return reject(Object.assign(new Error(`${bin} error: ${String(env.result).slice(0, 200)}`), { usage }));
      try { resolve({ data: parseModelJson(env.result), usage }); }
      catch (e) { reject(Object.assign(new Error(`${bin} result is not JSON: ${e.message}`), { usage })); }
    });
    child.stdin.on("error", () => {}); // a binary that exits early closes the pipe
    child.stdin.end(prompt);
  });
}

export function makeLlm({ provider = "mistral", model, minIntervalMs = 1100, maxCalls = 300, db, fetch = globalThis.fetch,
  mock, sleep = realSleep, clock = Date.now } = {}) {
  if (!["mistral", "claude-cli", "mock"].includes(provider)) throw new Error(`unknown model provider: ${provider}`);
  model ??= DEFAULT_MODELS[provider];
  let calls = 0, last = null;
  const wait = async () => { // keep at least minIntervalMs between requests (free-tier rate limit)
    if (provider !== "mistral" && provider !== "claude-cli") return;
    if (last != null) { const gap = minIntervalMs - (clock() - last); if (gap > 0) await sleep(gap); }
    last = clock();
  };
  const logUsage = (purpose, usage, ok) => db?.prepare(
    "INSERT INTO usage (at, provider, model, purpose, input_tokens, output_tokens, ok) VALUES (?,?,?,?,?,?,?)")
    .run(now(), provider, model, purpose, usage?.inputTokens ?? null, usage?.outputTokens ?? null, ok ? 1 : 0);

  async function json(prompt, { purpose = "other", maxTokens } = {}) {
    if (calls >= maxCalls) throw new BudgetError(maxCalls);
    calls++;
    try {
      let r;
      if (provider === "mock") {
        const data = await mock(prompt);
        r = { data, usage: { inputTokens: Math.ceil(prompt.length / 4), outputTokens: Math.ceil(JSON.stringify(data ?? "").length / 4) } };
      } else if (provider === "mistral") r = await callMistral({ model, prompt, maxTokens, fetch, sleep, wait });
      else { await wait(); r = await callClaudeCli({ model, prompt }); }
      logUsage(purpose, r.usage, true);
      return r;
    } catch (e) {
      logUsage(purpose, e.usage, false);
      throw e;
    }
  }
  return { provider, model, by: `model:${provider}/${model}`, json, get calls() { return calls; } };
}
