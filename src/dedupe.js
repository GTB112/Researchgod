// dedupe.js — owns "one row per paper": upsertWork merges a Work into the database by DOI, else by normalized title
// + year (±1) + first author's surname; logSearch records every search (AGENTS.md rule 6).
import { now, toJson, fromJson } from "./db.js";
import { makeWork, firstSurname, normTitle } from "./work.js";

const sameYear = (a, b) => a == null || b == null || Math.abs(a - b) <= 1;
const union = (a, b) => [...new Set([...(a || []), ...(b || [])])];

function findMatch(db, w) {
  if (w.doi) {
    const byDoi = db.prepare("SELECT * FROM works WHERE doi = ?").get(w.doi);
    if (byDoi) return byDoi;
  }
  const titleNorm = normTitle(w.title);
  const sur = firstSurname(w.authors);
  for (const row of db.prepare("SELECT * FROM works WHERE title_norm = ? ORDER BY id").all(titleNorm)) {
    if (sameYear(row.year, w.year) && firstSurname(fromJson(row.authors, [])) === sur) return row;
  }
  return null;
}

// Never overwrites a non-null value with null; fills nulls; keeps the longer abstract; unions fields and ids.
function merge(db, row, w) {
  const abstract = (w.abstract?.length ?? 0) > (row.abstract?.length ?? 0) ? w.abstract : row.abstract;
  const authors = fromJson(row.authors, []);
  const cited = [row.cited_by, w.citedBy].filter((v) => v != null);
  db.prepare(`UPDATE works SET doi = ?, year = ?, authors = ?, venue = ?, abstract = ?, language = ?, type = ?,
    url = ?, oa_url = ?, cited_by = ?, fields = ?, ids = ? WHERE id = ?`).run(
    row.doi ?? w.doi, row.year ?? w.year, toJson(authors.length ? authors : w.authors), row.venue ?? w.venue,
    abstract, row.language ?? w.language, row.type ?? w.type, row.url ?? w.url, row.oa_url ?? w.oaUrl,
    cited.length ? Math.max(...cited) : null, toJson(union(fromJson(row.fields, []), w.fields)),
    toJson({ ...w.ids, ...fromJson(row.ids, {}) }), row.id);
}

export function upsertWork(db, work, { searchId, rank } = {}) {
  const w = makeWork(work);
  let row = findMatch(db, w);
  let id, isNew = false;
  if (row) { merge(db, row, w); id = row.id; }
  else {
    const r = db.prepare(`INSERT INTO works (doi, title, title_norm, year, authors, venue, abstract, language, type, url,
      oa_url, cited_by, fields, ids, added_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      w.doi, w.title, normTitle(w.title), w.year, toJson(w.authors), w.venue, w.abstract, w.language, w.type, w.url,
      w.oaUrl, w.citedBy, toJson(w.fields), toJson(w.ids), now());
    id = Number(r.lastInsertRowid); isNew = true;
  }
  if (searchId != null) {
    db.prepare("INSERT OR IGNORE INTO work_searches (work_id, search_id, rank) VALUES (?,?,?)").run(id, searchId, rank ?? null);
  }
  return { id, isNew };
}

export function logSearch(db, { questionId, source, kind, query, params, resultCount }) {
  const r = db.prepare(`INSERT INTO searches (question_id, source, kind, query, params, run_at, result_count)
    VALUES (?,?,?,?,?,?,?)`).run(questionId, source, kind, query, toJson(params ?? {}), now(), resultCount ?? null);
  return Number(r.lastInsertRowid);
}
