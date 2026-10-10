import { test } from "node:test";
import assert from "node:assert";
import { openDb } from "../src/db.js";
import { exportReview, importReview } from "../src/review.js";

function seed(counts) {
  const db = openDb();
  db.exec("INSERT INTO projects VALUES ('p','P','field-map',NULL,'t'); INSERT INTO questions (id, project_id, text) VALUES ('q1','p','Q?')");
  let id = 0;
  for (const [decision, n] of Object.entries(counts)) for (let i = 0; i < n; i++) {
    id++;
    db.prepare("INSERT INTO works (id, title, title_norm, year, venue, doi, added_at) VALUES (?,?,?,?,?,?,'t')").run(id, `Title, ${id} "q"`, `title ${id}`, 2000 + id, "Venue", `10.1000/${id}`);
    db.prepare("INSERT INTO screenings (work_id, question_id, stage, decision, reason, quote, by, created_at) VALUES (?, 'q1', 'title_abstract', ?, 'because', 'a quote', 'model:mistral/x', 't')").run(id, decision);
  }
  return db;
}
const modelOf = (csv) => csv.trim().split("\n").slice(1);

test("sample is seeded, stratified, and always includes excludes", () => {
  const db = seed({ include: 20, exclude: 20, maybe: 2 });
  const a = exportReview(db, { questionId: "q1", sample: 12, seed: 7 });
  assert.equal(a, exportReview(db, { questionId: "q1", sample: 12, seed: 7 }));
  assert.notEqual(a, exportReview(db, { questionId: "q1", sample: 12, seed: 8 }));
  const lines = modelOf(a);
  assert.equal(lines.length, 12);
  for (const d of ["include", "exclude", "maybe"]) assert.ok(lines.filter((l) => l.includes(`,${d},because`)).length >= 2, d);
  assert.ok(a.startsWith("work_id,title,year,venue,doi,model_decision,model_reason,model_quote,your_decision,note\n"));
  assert.ok(exportReview(db, { questionId: "q1" }).includes('"Title, 1 ""q"""'));
  assert.equal(modelOf(exportReview(db, { questionId: "q1", decision: "maybe" })).length, 2);
});

test("import computes agreement and kappa on a known example", () => {
  // Classic 2x2: 20 include/include, 5 include(person)/exclude(model), 10 exclude/include, 15 exclude/exclude
  const db = seed({ include: 30, exclude: 20 });
  const rows = [];
  const person = (i) => (i <= 20 ? "include" : i <= 25 ? "include" : i <= 30 ? "exclude" : "exclude");
  // works 1-30 are model include, 31-50 model exclude
  const plan = {}; // work -> person decision
  for (let i = 1; i <= 20; i++) plan[i] = "include";   // agree
  for (let i = 21; i <= 30; i++) plan[i] = "exclude";  // person exclude, model include (10)
  for (let i = 31; i <= 35; i++) plan[i] = "include";  // person include, model exclude (5)
  for (let i = 36; i <= 50; i++) plan[i] = "exclude";  // agree (15)
  assert.ok(person);
  for (const [id, d] of Object.entries(plan)) rows.push(`${id},"t",,,,,,,${d},"note, ${id}"`);
  rows.push("1,t,,,,,,,,"); // blank decision ignored
  rows.push("999,t,,,,,,,include,"); // unknown work skipped
  const res = importReview(db, "work_id,title,year,venue,doi,model_decision,model_reason,model_quote,your_decision,note\r\n" + rows.join("\r\n") + "\r\n", { questionId: "q1" });
  assert.equal(res.imported, 50); assert.equal(res.skipped, 1);
  assert.equal(res.agreement.n, 50); assert.equal(res.agreement.agree, 35); assert.equal(res.agreement.percent, 70);
  // po=.7; person include 25, model include 30 -> pe = .5*.6 + .5*.4 = .5 ; kappa = .4
  assert.equal(res.agreement.kappa, 0.4);
  const s = db.prepare("SELECT * FROM screenings WHERE by = 'person' AND work_id = 3").get();
  assert.equal(s.decision, "include"); assert.equal(s.reason, "note, 3"); assert.equal(s.stage, "title_abstract");
});
