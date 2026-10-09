import { test } from "node:test";
import assert from "node:assert";
import { openDb } from "../src/db.js";
import { fieldMap, toMarkdown } from "../src/fieldmap.js";

function seed() {
  const db = openDb();
  db.exec("INSERT INTO projects VALUES ('p','P','field-map',NULL,'t'); INSERT INTO questions (id, project_id, text) VALUES ('q1','p','Q?')");
  const w = (id, year, fields) => db.prepare("INSERT INTO works (id, title, title_norm, year, fields, added_at) VALUES (?,?,?,?,?,'t')").run(id, `T${id}`, `t${id}`, year, JSON.stringify(fields));
  const scr = (id, d, by, at) => db.prepare("INSERT INTO screenings (work_id, question_id, stage, decision, by, created_at) VALUES (?, 'q1', 'title_abstract', ?, ?, ?)").run(id, d, by, at);
  const ext = (id, field, value, nr = 0) => db.prepare("INSERT INTO extractions (work_id, question_id, field, value, not_reported, source, by, created_at) VALUES (?, 'q1', ?, ?, ?, 'abstract', 'model:m', 't')").run(id, field, value, nr);
  w(1, 2020, ["education"]); w(2, 2020, ["education", "health"]); w(3, 2021, []); w(4, 2021, []); w(5, 2022, []);
  scr(1, "include", "model:m", "1"); scr(2, "include", "model:m", "1"); scr(3, "include", "model:m", "1");
  scr(4, "include", "model:m", "1"); scr(4, "exclude", "person", "2"); // person wins
  scr(5, "exclude", "model:m", "1");
  ext(1, "design", " RCT "); ext(1, "setting_country", "Kenya");
  ext(2, "design", "RCT"); ext(2, "setting_country", "Indonesia");
  ext(3, "design", "Quasi-experimental"); ext(3, "setting_country", "Kenya");
  ext(3, "outcomes", null, 1);
  return db;
}

test("fieldMap counts, grid and candidate gaps", () => {
  const m = fieldMap(seed(), { questionId: "q1" });
  assert.equal(m.total, 3);
  assert.deepEqual(m.byYear, { 2020: 2, 2021: 1 });
  assert.deepEqual(m.byField, { education: 2, health: 1 });
  assert.deepEqual(m.byExtraction.design, { rct: 2, "quasi-experimental": 1 });
  assert.deepEqual(m.byExtraction.outcomes, { "not reported": 1 });
  assert.equal(m.grid.rows, "design"); assert.equal(m.grid.cols, "setting_country");
  assert.equal(m.grid.cells.rct.kenya, 1); assert.equal(m.grid.cells.rct.indonesia, 1);
  assert.deepEqual(m.candidateGaps, [{ row: "quasi-experimental", col: "indonesia" }]);
});

test("toMarkdown labels candidate gaps", () => {
  const md = toMarkdown(fieldMap(seed(), { questionId: "q1" }));
  assert.match(md, /Included studies: 3/);
  assert.match(md, /quasi-experimental × indonesia: candidate: confirm with a broad search/);
  assert.match(md, /\| rct \| 1 \| 1 \|/);
});
