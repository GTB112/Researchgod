import { test } from "node:test";
import assert from "node:assert";
import { openDb } from "../src/db.js";
import { upsertWork, logSearch } from "../src/dedupe.js";
import { makeWork } from "../src/work.js";

const setup = () => {
  const db = openDb();
  db.exec("INSERT INTO projects VALUES ('p','P','field-map',NULL,'2026-01-01'); INSERT INTO questions (id, project_id, text) VALUES ('q1','p','Q?')");
  return db;
};
const row = (db, id) => db.prepare("SELECT * FROM works WHERE id = ?").get(id);

test("merges by DOI, fills nulls, keeps longer abstract, unions fields and ids", () => {
  const db = setup();
  const a = upsertWork(db, makeWork({ title: "Mentoring youth", doi: "https://doi.org/10.1000/ABC", abstract: "short", fields: ["a"], ids: { pmid: "1" }, citedBy: 5 }));
  const b = upsertWork(db, makeWork({ title: "Mentoring youth!", doi: "10.1000/abc", year: 2020, venue: "J", abstract: "a much longer abstract", fields: ["a", "b"], ids: { openalex: "W1", pmid: "9" }, citedBy: 3, oaUrl: "http://x/p.pdf" }));
  assert.equal(a.isNew, true); assert.equal(b.isNew, false); assert.equal(b.id, a.id);
  const r = row(db, a.id);
  assert.equal(r.year, 2020); assert.equal(r.venue, "J"); assert.equal(r.abstract, "a much longer abstract");
  assert.deepEqual(JSON.parse(r.fields), ["a", "b"]);
  assert.deepEqual(JSON.parse(r.ids), { openalex: "W1", pmid: "1" });
  assert.equal(r.cited_by, 5); assert.equal(r.oa_url, "http://x/p.pdf");
});

test("never overwrites a non-null value with null", () => {
  const db = setup();
  const a = upsertWork(db, makeWork({ title: "T one", doi: "10.1000/x", year: 2019, venue: "V", abstract: "long abstract", authors: ["A B"], citedBy: 4 }));
  upsertWork(db, makeWork({ title: "T one", doi: "10.1000/x" }));
  const r = row(db, a.id);
  assert.equal(r.year, 2019); assert.equal(r.venue, "V"); assert.equal(r.abstract, "long abstract");
  assert.equal(r.cited_by, 4); assert.deepEqual(JSON.parse(r.authors), ["A B"]);
});

test("merges by title + year within one + same surname, otherwise not", () => {
  const db = setup();
  const a = upsertWork(db, makeWork({ title: "Social support at work", year: 2020, authors: ["Tammy D. Allen"] }));
  const near = upsertWork(db, makeWork({ title: "Social Support at Work.", year: 2021, authors: ["Allen, Tammy D."], doi: "10.1002/z" }));
  assert.equal(near.id, a.id); assert.equal(row(db, a.id).doi, "10.1002/z");
  assert.equal(upsertWork(db, makeWork({ title: "Social support at work", year: 2023, authors: ["T Allen"] })).isNew, true);
  assert.equal(upsertWork(db, makeWork({ title: "Social support at work", year: 2020, authors: ["Jo Smith"] })).isNew, true);
  assert.equal(upsertWork(db, makeWork({ title: "Social support at work", authors: ["Jo Allen"] })).id, a.id); // null year matches
});

test("logSearch and work_searches link", () => {
  const db = setup();
  const sid = logSearch(db, { questionId: "q1", source: "openalex", kind: "api", query: "mentoring", params: { from: 2000 }, resultCount: 12 });
  const { id } = upsertWork(db, makeWork({ title: "X y" }), { searchId: sid, rank: 3 });
  upsertWork(db, makeWork({ title: "X y" }), { searchId: sid, rank: 4 }); // no duplicate link error
  const s = db.prepare("SELECT * FROM searches WHERE id = ?").get(sid);
  assert.equal(s.result_count, 12); assert.equal(s.query, "mentoring"); assert.deepEqual(JSON.parse(s.params), { from: 2000 });
  assert.deepEqual({ ...db.prepare("SELECT * FROM work_searches").get() }, { work_id: id, search_id: sid, rank: 3 });
});
