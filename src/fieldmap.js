// fieldmap.js — owns the field map: what the included studies cover (year, subject, extracted fields) and a grid of
// two extracted fields, with empty cells flagged only as candidate gaps (absence here is not proof of absence).
import { fromJson } from "./db.js";

const NR = "not reported";

// A person's latest decision wins over the model's latest (created_at, then id).
function latestDecision(db, workId, questionId, stage) {
  const q = (who) => db.prepare(`SELECT decision FROM screenings WHERE work_id = ? AND question_id = ? AND stage = ? AND ${who}
    ORDER BY created_at DESC, id DESC LIMIT 1`).get(workId, questionId, stage)?.decision;
  return q("by = 'person'") ?? q("by LIKE 'model:%'") ?? null;
}

const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const bucket = (e) => (!e || e.not_reported || !String(e.value ?? "").trim() ? NR : String(e.value).trim().toLowerCase());

export function fieldMap(db, { questionId, rows = "design", cols = "setting_country" } = {}) {
  const ids = db.prepare("SELECT DISTINCT work_id FROM screenings WHERE question_id = ? AND stage = 'title_abstract' ORDER BY work_id")
    .all(questionId).map((r) => r.work_id).filter((id) => latestDecision(db, id, questionId, "title_abstract") === "include");
  const map = { total: ids.length, byYear: {}, byField: {}, byExtraction: {}, grid: { rows, cols, cells: {} }, candidateGaps: [] };
  const per = new Map(); // workId → { field → bucket }
  for (const id of ids) {
    const w = db.prepare("SELECT year, fields FROM works WHERE id = ?").get(id);
    bump(map.byYear, w.year ?? "unknown");
    for (const f of fromJson(w.fields, [])) bump(map.byField, f);
    const latest = {};
    for (const e of db.prepare("SELECT * FROM extractions WHERE work_id = ? AND question_id = ? ORDER BY created_at, id").all(id, questionId)) latest[e.field] = e;
    const b = {};
    for (const [f, e] of Object.entries(latest)) { b[f] = bucket(e); bump((map.byExtraction[f] ??= {}), b[f]); }
    per.set(id, b);
  }
  const rv = new Set(), cv = new Set();
  for (const b of per.values()) {
    const r = b[rows] ?? NR, c = b[cols] ?? NR; // not yet extracted counts as not reported
    rv.add(r); cv.add(c);
    bump((map.grid.cells[r] ??= {}), c);
  }
  map.grid.rowValues = [...rv].sort(); map.grid.colValues = [...cv].sort();
  for (const r of map.grid.rowValues) for (const c of map.grid.colValues) {
    if (r !== NR && c !== NR && !map.grid.cells[r]?.[c]) map.candidateGaps.push({ row: r, col: c });
  }
  return map;
}

const table = (head, body) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");

export function toMarkdown(map) {
  const out = [`# Field map`, "", `Included studies: ${map.total}`, ""];
  const years = Object.entries(map.byYear).sort(([a], [b]) => String(a).localeCompare(String(b)));
  out.push("## By year", "", table(["Year", "Studies"], years), "");
  const fields = Object.entries(map.byField).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (fields.length) out.push("## By subject", "", table(["Subject", "Studies"], fields), "");
  for (const [f, counts] of Object.entries(map.byExtraction)) {
    out.push(`## ${f}`, "", table(["Value", "Studies"], Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))), "");
  }
  const { rows, cols, cells, rowValues = [], colValues = [] } = map.grid;
  out.push(`## ${rows} by ${cols}`, "", table([rows, ...colValues], rowValues.map((r) => [r, ...colValues.map((c) => cells[r]?.[c] ?? 0)])), "");
  if (map.candidateGaps.length) {
    out.push("## Candidate gaps", "");
    for (const g of map.candidateGaps) out.push(`- ${g.row} × ${g.col}: candidate: confirm with a broad search`);
    out.push("");
  }
  return out.join("\n");
}
