import test from "node:test";
import assert from "node:assert/strict";
import { openDb, now } from "../src/db.js";
import { makeLlm, BudgetError } from "../src/llm.js";
import { screenQuestion, latestDecision, PROMPT_VERSION } from "../src/screen.js";

function seed() {
  const db = openDb();
  db.prepare("INSERT INTO projects (id,name,kind,created_at) VALUES ('p','P','field-map',?)").run(now());
  db.prepare("INSERT INTO questions (id,project_id,text,include_criteria,exclude_criteria) VALUES ('q1','p','Does mentoring help youth?',?,?)")
    .run(JSON.stringify(["youth mentoring"]), JSON.stringify(["adults only"]));
  db.prepare("INSERT INTO searches (question_id,source,kind,query,run_at) VALUES ('q1','openalex','api','mentoring',?)").run(now());
  const add = (title, abstract) => {
    const id = Number(db.prepare("INSERT INTO works (title,title_norm,abstract,added_at) VALUES (?,?,?,?)").run(title, title.toLowerCase(), abstract, now()).lastInsertRowid);
    db.prepare("INSERT INTO work_searches (work_id,search_id,rank) VALUES (?,1,1)").run(id);
    return id;
  };
  return { db, add };
}
const mk = (db, mock, extra = {}) => makeLlm({ provider: "mock", mock, db, ...extra });

test("include with a verbatim quote; quote-not-found becomes maybe", async () => {
  const { db, add } = seed();
  const a = add("Mentoring study", "Youth mentoring raised school attendance by 10 percent.");
  const b = add("Other study", "Tutoring raised grades.");
  const llm = mk(db, (p) => p.includes("Mentoring study")
    ? { decision: "include", reason: "on topic", quote: "Youth  mentoring raised school attendance" }
    : { decision: "exclude", reason: "off topic", quote: "Tutoring boosted grades" });
  const r = await screenQuestion(db, llm, { questionId: "q1" });
  assert.deepEqual([r.include, r.exclude, r.maybe, r.skipped], [1, 0, 1, 0]);
  const da = latestDecision(db, a, "q1", "title_abstract");
  assert.equal(da.decision, "include"); assert.equal(da.quote_ok, 1); assert.equal(da.prompt_version, PROMPT_VERSION);
  assert.equal(da.by, "model:mock/mock");
  const dbb = latestDecision(db, b, "q1", "title_abstract");
  assert.equal(dbb.decision, "maybe"); assert.equal(dbb.quote_ok, 0); assert.match(dbb.reason, /^quote not found: off topic/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM usage WHERE purpose='screen'").get().n, 2);
});

test("prompt carries question, criteria, title and abstract", async () => {
  const { db, add } = seed();
  add("T1", "Abstract one.");
  let seen;
  await screenQuestion(db, mk(db, (p) => { seen = p; return { decision: "maybe", reason: "", quote: "" }; }), { questionId: "q1" });
  for (const s of ["Does mentoring help youth?", "- youth mentoring", "- adults only", "T1", "Abstract one."]) assert.ok(seen.includes(s), s);
  assert.ok(!seen.includes("{{"));
});

test("no abstract: maybe with zero model calls", async () => {
  const { db, add } = seed();
  const id = add("No abstract here", null);
  const llm = mk(db, () => assert.fail("model must not be called"));
  const r = await screenQuestion(db, llm, { questionId: "q1" });
  assert.equal(r.maybe, 1); assert.equal(llm.calls, 0);
  const d = latestDecision(db, id, "q1", "title_abstract");
  assert.equal(d.reason, "no abstract");
});

test("already-screened works are skipped; limit and budget respected", async () => {
  const { db, add } = seed();
  const a = add("A", "alpha text"); add("B", "beta text"); add("C", "gamma text");
  db.prepare("INSERT INTO screenings (work_id,question_id,stage,decision,by,created_at) VALUES (?,?,?,?,?,?)").run(a, "q1", "title_abstract", "include", "person", now());
  const mock = () => ({ decision: "include", reason: "r", quote: "text" });
  const llm = mk(db, mock);
  const r = await screenQuestion(db, llm, { questionId: "q1", limit: 1 });
  assert.equal(r.skipped, 1); assert.equal(r.include, 1); assert.equal(llm.calls, 1);
  await assert.rejects(screenQuestion(db, mk(db, mock, { maxCalls: 0 }), { questionId: "q1" }), BudgetError);
});

test("latestDecision prefers a person over a later model decision", () => {
  const { db, add } = seed();
  const id = add("A", "x");
  const ins = db.prepare("INSERT INTO screenings (work_id,question_id,stage,decision,by,created_at) VALUES (?,?,?,?,?,?)");
  ins.run(id, "q1", "title_abstract", "exclude", "person", now());
  ins.run(id, "q1", "title_abstract", "include", "model:mock/mock", now());
  assert.equal(latestDecision(db, id, "q1", "title_abstract").decision, "exclude");
  assert.equal(latestDecision(db, id, "q1", "full_text"), null);
});
