import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/db.js";
import { TABLES } from "../src/db.js";
import { upsertWork, logSearch } from "../src/dedupe.js";
import { exportJsonl, importJsonl } from "../src/store.js";
import { makeWork } from "../src/work.js";

test("JSONL round trip is lossless", () => {
  const db = openDb();
  db.exec(`INSERT INTO projects VALUES ('p','P','decision','Indonesia','2026-01-01');
    INSERT INTO questions (id, project_id, text, include_criteria) VALUES ('q1','p','Does "mentoring" work?, really\nyes','["a","b"]');
    INSERT INTO options (question_id, name, is_null) VALUES ('q1','Do nothing new',1);
    INSERT INTO excerpts (project_id, text, approved_at) VALUES ('p','Ünïcode “text”','2026-01-02');
    `);
  upsertWork(db, makeWork({ title: "One", doi: "10.1000/a", authors: ["A B"], fields: ["x"], citedBy: 2, year: 2020, abstract: "abs" }));
  db.exec(`INSERT INTO screenings (work_id, question_id, stage, decision, by, created_at) VALUES (1,'q1','title_abstract','include','person','2026-01-03');
    INSERT INTO extractions (work_id, question_id, field, value, quote_ok, source, by, created_at) VALUES (1,'q1','design','rct',1,'abstract','person','2026-01-03');
    INSERT INTO usage (at, provider, model, purpose, ok) VALUES ('2026-01-03','mistral','m','screen',1)`);
  const sid = logSearch(db, { questionId: "q1", source: "openalex", kind: "api", query: "q", params: { a: 1 }, resultCount: 2 });
  upsertWork(db, makeWork({ title: "One", doi: "10.1000/a" }), { searchId: sid, rank: 1 });
  upsertWork(db, makeWork({ title: "Two" }), { searchId: sid, rank: 2 });
  const d1 = fs.mkdtempSync(path.join(os.tmpdir(), "rg1-")), d2 = fs.mkdtempSync(path.join(os.tmpdir(), "rg2-"));
  const counts = exportJsonl(db, d1);
  assert.equal(counts.works, 2);
  const db2 = openDb();
  importJsonl(db2, d1);
  exportJsonl(db2, d2);
  for (const t of TABLES) assert.equal(fs.readFileSync(path.join(d2, `${t}.jsonl`), "utf8"), fs.readFileSync(path.join(d1, `${t}.jsonl`), "utf8"), t);
  assert.equal(db2.prepare("SELECT text FROM excerpts").get().text, "Ünïcode “text”");
});

test("importJsonl skips missing files", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rg3-"));
  fs.writeFileSync(path.join(d, "projects.jsonl"), JSON.stringify({ id: "p", name: "P", kind: "field-map", context: null, created_at: "t" }) + "\n");
  const db = openDb();
  importJsonl(db, d);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM projects").get().n, 1);
});
