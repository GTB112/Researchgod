import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, now } from "../src/db.js";
import { makeLlm } from "../src/llm.js";
import { extractWork, TEMPLATE_FIELDS, PROMPT_VERSION } from "../src/extract.js";

function seed(abstract) {
  const db = openDb();
  db.prepare("INSERT INTO projects (id,name,kind,created_at) VALUES ('p','P','field-map',?)").run(now());
  db.prepare("INSERT INTO questions (id,project_id,text) VALUES ('q1','p','Does mentoring help youth?')").run();
  db.prepare("INSERT INTO works (id,title,title_norm,abstract,added_at) VALUES (1,'Mentoring RCT','mentoring rct',?,?)").run(abstract, now());
  return db;
}
const rows = (db) => Object.fromEntries(db.prepare("SELECT * FROM extractions ORDER BY id").all().map((r) => [r.field, r]));

test("abstract extraction: verbatim ok, bad quote flagged, missing fields not_reported", async () => {
  const db = seed("We ran a randomized trial with 120 adolescents in Kenya. Attendance rose.");
  let prompt;
  const llm = makeLlm({ provider: "mock", db, mock: (p) => { prompt = p; return { fields: {
    population: { value: "adolescents", quote: "120 adolescents", page: null },
    setting_country: { value: "Kenya", quote: "in Kenya", page: null },
    design: { value: "RCT", quote: "a controlled trial", page: null },
    attrition: { not_reported: true },
    claim_kinds: { value: "outcome, magic", quote: "Attendance rose", page: null },
  } }; } });
  const res = await extractWork(db, llm, { workId: 1, questionId: "q1" });
  assert.ok(prompt.includes("Mentoring RCT") && prompt.includes("Does mentoring help youth?") && !prompt.includes("{{"));
  assert.deepEqual(res, { fields: TEMPLATE_FIELDS.length, quotesOk: 3, quotesBad: 1, notReported: TEMPLATE_FIELDS.length - 4 });
  const r = rows(db);
  assert.equal(Object.keys(r).length, TEMPLATE_FIELDS.length);
  assert.equal(r.population.quote_ok, 1); assert.equal(r.population.source, "abstract"); assert.equal(r.population.page, null);
  assert.equal(r.population.prompt_version, PROMPT_VERSION);
  assert.equal(r.design.quote_ok, 0);
  assert.equal(r.attrition.not_reported, 1); assert.equal(r.attrition.value, null);
  assert.equal(r.effect.not_reported, 1);
  assert.equal(r.claim_kinds.value, "outcome");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM usage WHERE purpose='extract'").get().n, 1);
});

test("no text at all: everything not_reported, no model call", async () => {
  const db = seed(null);
  const llm = makeLlm({ provider: "mock", db, mock: () => assert.fail("no call") });
  const res = await extractWork(db, llm, { workId: 1, questionId: "q1" });
  assert.equal(res.notReported, TEMPLATE_FIELDS.length); assert.equal(llm.calls, 0);
});

test("full text from JSON file: page markers, page correction", async () => {
  const db = seed("short abstract");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rg-ft-"));
  try {
    fs.writeFileSync(path.join(dir, "1.json"), JSON.stringify({ pages: ["Page one intro text.", "Methods: 60 students\nwere randomized.", "Results: scores rose by 0.3 SD."] }));
    db.prepare("INSERT INTO fulltexts (work_id,text_path,pages,added_at) VALUES (1,'1.json',3,?)").run(now());
    let prompt;
    const llm = makeLlm({ provider: "mock", db, mock: (p) => { prompt = p; return { fields: {
      sample_size: { value: "60", quote: "60 students were randomized", page: 2 },
      effect: { value: "0.3 SD", quote: "scores rose by 0.3 SD", page: 1 }, // wrong page
      design: { value: "RCT", quote: "randomised controlled", page: 2 }, // not in text
    } }; } });
    const res = await extractWork(db, llm, { workId: 1, questionId: "q1", fulltextDir: dir });
    assert.ok(prompt.includes("[[page 1]]") && prompt.includes("[[page 3]]"));
    assert.equal(res.quotesOk, 2); assert.equal(res.quotesBad, 1);
    const r = rows(db);
    assert.equal(r.sample_size.page, 2); assert.equal(r.sample_size.quote_ok, 1); assert.equal(r.sample_size.source, "full_text");
    assert.equal(r.effect.page, 3); assert.equal(r.effect.quote_ok, 1);
    assert.equal(r.design.quote_ok, 0);
    assert.equal(r.population.not_reported, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
