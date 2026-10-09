import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/db.js";
import { makeLlm, BudgetError } from "../src/llm.js";

const okBody = (content, usage = { prompt_tokens: 11, completion_tokens: 7 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 });
const usageRows = (db) => db.prepare("SELECT * FROM usage ORDER BY id").all();

test("mistral request shape, usage row, fence stripping", async () => {
  process.env.MISTRAL_API_KEY = "k123";
  const db = openDb();
  const seen = [];
  const fetch = async (url, init) => { seen.push({ url, init }); return okBody('```json\n{"a":1}\n```'); };
  const llm = makeLlm({ provider: "mistral", model: "m1", db, fetch, sleep: async () => {} });
  const r = await llm.json("hello", { purpose: "screen", maxTokens: 50 });
  assert.deepEqual(r.data, { a: 1 });
  assert.deepEqual(r.usage, { inputTokens: 11, outputTokens: 7 });
  assert.equal(seen[0].url, "https://api.mistral.ai/v1/chat/completions");
  assert.equal(seen[0].init.headers.authorization, "Bearer k123");
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, "m1");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.temperature, 0.1);
  assert.equal(body.messages[0].content, "hello");
  const u = usageRows(db);
  assert.equal(u.length, 1);
  assert.deepEqual([u[0].provider, u[0].model, u[0].purpose, u[0].input_tokens, u[0].output_tokens, u[0].ok], ["mistral", "m1", "screen", 11, 7, 1]);
});

test("mistral retries 429 honouring retry-after, then succeeds", async () => {
  process.env.MISTRAL_API_KEY = "k";
  let n = 0;
  const sleeps = [];
  const fetch = async () => (++n === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "2" } }) : okBody('{"ok":true}'));
  const llm = makeLlm({ provider: "mistral", fetch, sleep: async (ms) => sleeps.push(ms), minIntervalMs: 0 });
  assert.deepEqual((await llm.json("x")).data, { ok: true });
  assert.equal(n, 2);
  assert.ok(sleeps.includes(2000));
  assert.equal(llm.calls, 1);
});

test("mistral gives up after 3 retries and logs a failed usage row", async () => {
  process.env.MISTRAL_API_KEY = "k";
  const db = openDb();
  let n = 0;
  const fetch = async () => { n++; return new Response("boom", { status: 503 }); };
  const llm = makeLlm({ provider: "mistral", db, fetch, sleep: async () => {} });
  await assert.rejects(llm.json("x", { purpose: "extract" }), /HTTP 503/);
  assert.equal(n, 4);
  const u = usageRows(db);
  assert.equal(u.length, 1);
  assert.equal(u[0].ok, 0);
  assert.equal(u[0].purpose, "extract");
});

test("mistral without a key fails clearly; calls are spaced", async () => {
  const saved = process.env.MISTRAL_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  await assert.rejects(makeLlm({ provider: "mistral", fetch: async () => okBody("{}") }).json("x"), /MISTRAL_API_KEY/);
  process.env.MISTRAL_API_KEY = saved ?? "k";
  let t = 1000;
  const sleeps = [];
  const llm = makeLlm({ provider: "mistral", fetch: async () => okBody("{}"), minIntervalMs: 1100, clock: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
  await llm.json("a"); t += 300; await llm.json("b");
  assert.deepEqual(sleeps, [800]);
});

test("BudgetError at maxCalls; mock writes usage", async () => {
  const db = openDb();
  const llm = makeLlm({ provider: "mock", mock: () => ({ x: 1 }), maxCalls: 2, db });
  await llm.json("a", { purpose: "screen" }); await llm.json("b", { purpose: "screen" });
  await assert.rejects(llm.json("c"), BudgetError);
  assert.equal(llm.calls, 2);
  assert.equal(usageRows(db).length, 2);
  assert.equal(llm.by, "model:mock/mock");
});

test("claude-cli runs the binary, reads the JSON envelope", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rg-cli-"));
  const bin = path.join(dir, "fakeclaude");
  fs.writeFileSync(bin, `#!/usr/bin/env node
let s = ""; process.stdin.on("data", (d) => s += d).on("end", () => {
  const result = "\`\`\`json\\n" + JSON.stringify({ args: process.argv.slice(2), prompt: s }) + "\\n\`\`\`";
  console.log(JSON.stringify({ type: "result", is_error: false, result, usage: { input_tokens: 5, output_tokens: 3 } }));
});
`, { mode: 0o755 });
  const saved = process.env.CLAUDE_CLI;
  process.env.CLAUDE_CLI = bin;
  try {
    const db = openDb();
    const llm = makeLlm({ provider: "claude-cli", model: "haiku", db, minIntervalMs: 0 });
    const r = await llm.json("the prompt", { purpose: "screen" });
    assert.deepEqual(r.data, { args: ["-p", "--model", "haiku", "--output-format", "json"], prompt: "the prompt" });
    assert.deepEqual(r.usage, { inputTokens: 5, outputTokens: 3 });
    assert.equal(usageRows(db)[0].provider, "claude-cli");
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CLI; else process.env.CLAUDE_CLI = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
