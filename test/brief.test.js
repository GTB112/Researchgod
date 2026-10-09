import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/db.js";
import { checkBrief } from "../src/brief.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rg-brief-"));
const ftPath = path.join(dir, "1.json");
fs.writeFileSync(ftPath, JSON.stringify({ pages: ["Page one text.", "Mentors who meet weekly reduce dropout. Second sentence."] }));

function seed() {
  const db = openDb();
  db.exec(`INSERT INTO projects VALUES ('p','P','decision','Kenya','t'); INSERT INTO questions (id, project_id, text) VALUES ('q1','p','Q?');
    INSERT INTO works (id, title, title_norm, abstract, added_at) VALUES (1,'A','a','Youth mentoring improved attendance in rural schools.','t'), (2,'B','b','Plain abstract.','t');
    INSERT INTO screenings (work_id, question_id, stage, decision, by, created_at) VALUES (1,'q1','title_abstract','include','person','t');
    INSERT INTO fulltexts (work_id, text_path, added_at) VALUES (1, '${ftPath}', 't');
    INSERT INTO extractions (work_id, question_id, field, value, quote, source, by, created_at) VALUES (2,'q1','design','rct','Randomised in 40 clusters','abstract','m','t');
    INSERT INTO excerpts (project_id, text, translation, approved_at) VALUES ('p','Kami butuh mentor.','We need mentors.','t')`);
  return db;
}
const check = (md) => checkBrief(seed(), md, { fulltextDir: dir });
const probs = (md) => check(md).problems.map((p) => p.problem);

test("sentence without a marker fails; markers pass; non-body lines skipped", () => {
  const r = check("# Heading\n\n| a | b |\n|---|:---:|\nMentoring helps. [W1] It also costs little [decision].\nNo marker here.\n");
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 2); // table header row + unmarked sentence
  assert.deepEqual(r.problems.map((p) => p.line), [3, 6]);
  assert.equal(r.problems[1].sentence, "No marker here.");
});

test("splits sentences, keeping following markers", () => {
  assert.equal(check("One thing. [W1] Another thing [uncertainty]. Third [E1].").ok, true);
  assert.equal(check("One thing [W1]. Another thing.").problems.length, 1);
});

test("unknown ids are problems", () => {
  assert.match(probs("Claim [W99].")[0], /unknown work/);
  assert.match(probs("Claim [E9].")[0], /unknown excerpt/);
});

test("quotes are checked against abstract, page, excerpt, extraction quotes", () => {
  assert.equal(check('The study found “mentoring improved attendance” [W1].').ok, true);
  assert.equal(check('The study found "Youth  mentoring improved attendance" [W1].').ok, true);
  assert.match(probs('The study found “mentoring cured everything” [W1].')[0], /quote not found/);
  assert.equal(check('Mentors “reduce dropout” [W1 p.2].').ok, true);
  assert.match(probs('Mentors “reduce dropout” [W1 p.1].')[0], /page 1/);
  assert.match(probs('Mentors “reduce dropout” [W1 p.7].')[0], /no full-text page 7/);
  assert.equal(check('Mentors “reduce dropout” [W1].').ok, true); // anywhere in full text
  assert.equal(check('Design: “Randomised in 40 clusters” [W2].').ok, true);
  assert.equal(check('Youth say “We need mentors” [E1] and “Kami butuh mentor.” [E1].').ok, true);
  assert.match(probs('Youth say “We need money” [E1].')[0], /not found in E1/);
  assert.equal(check('A quote with a stop “Yes. Really” [W9999 p.1]'.replace("W9999 p.1", "decision")).ok, true); // no work marker: not checked
});

test("warns when a cited work has no person include", () => {
  const r = check("Plain abstract result [W2]. Mentoring [W1].");
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, ["W2 has no person include"]);
});
