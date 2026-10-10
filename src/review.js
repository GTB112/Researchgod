// review.js — owns the human check of model screening: export a (seeded, stratified) CSV for the owner to fill in,
// import it back as the person's decisions (rule 4: people decide), and report agreement with the model.
import { now } from "./db.js";

const COLUMNS = ["work_id", "title", "year", "venue", "doi", "model_decision", "model_reason", "model_quote", "your_decision", "note"];
const DECISIONS = ["include", "exclude", "maybe"];

const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// Small RFC-4180 parser (quotes, doubled quotes, CRLF, BOM); kept local so this module has no dependencies.
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false, any = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') { q = true; any = true; }
    else if (c === ",") { row.push(cell); cell = ""; any = true; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      if (any || cell) { row.push(cell); rows.push(row); }
      row = []; cell = ""; any = false;
    } else { cell += c; any = true; }
  }
  if (any || cell) { row.push(cell); rows.push(row); }
  return rows;
}

// Latest model decision for a work (created_at, then id).
const latestModel = (db, workId, questionId) => db.prepare(
  `SELECT * FROM screenings WHERE work_id = ? AND question_id = ? AND stage = 'title_abstract' AND by LIKE 'model:%'
   ORDER BY created_at DESC, id DESC LIMIT 1`).get(workId, questionId);

function rng(seed) {
  let a = typeof seed === "number" ? seed >>> 0 : [...String(seed)].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Equal share per model decision (redistributing what small groups cannot use), so excluded papers are always checked.
function allocate(sizes, n) {
  const alloc = Object.fromEntries(Object.keys(sizes).map((k) => [k, 0]));
  let left = n;
  for (;;) {
    const open = Object.keys(sizes).sort().filter((k) => alloc[k] < sizes[k]);
    if (!left || !open.length) return alloc;
    const share = Math.max(1, Math.floor(left / open.length));
    for (const k of open) { const g = Math.min(share, sizes[k] - alloc[k], left); alloc[k] += g; left -= g; }
  }
}

export function exportReview(db, { questionId, sample, decision, seed = 1 } = {}) {
  const works = db.prepare(
    `SELECT w.* FROM works w WHERE w.id IN (SELECT work_id FROM screenings WHERE question_id = ? AND stage = 'title_abstract')
     ORDER BY w.id`).all(questionId);
  let items = works.map((w) => ({ w, m: latestModel(db, w.id, questionId) }));
  if (decision) items = items.filter((x) => x.m?.decision === decision);
  if (sample != null && sample < items.length) {
    const groups = {};
    for (const x of items) (groups[x.m?.decision ?? "none"] ??= []).push(x);
    const alloc = allocate(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])), sample);
    const rand = rng(seed), picked = [];
    for (const k of Object.keys(groups).sort()) {
      const g = groups[k];
      for (let i = g.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [g[i], g[j]] = [g[j], g[i]]; }
      picked.push(...g.slice(0, alloc[k]));
    }
    items = picked.sort((a, b) => a.w.id - b.w.id);
  }
  const lines = [COLUMNS.join(",")];
  for (const { w, m } of items) {
    lines.push([w.id, w.title, w.year, w.venue, w.doi, m?.decision, m?.reason, m?.quote, "", ""].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

export function cohenKappa(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const agree = pairs.filter(([a, b]) => a === b).length;
  const cats = [...new Set(pairs.flat())];
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return pe === 1 ? null : (agree / n - pe) / (1 - pe);
}

export function importReview(db, csvText, { questionId } = {}) {
  const [header, ...rows] = parseCsv(csvText);
  const counts = { imported: 0, skipped: 0, include: 0, exclude: 0, maybe: 0 };
  if (!header) return { ...counts, agreement: { n: 0, agree: 0, percent: null, kappa: null } };
  const col = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const pairs = [];
  const ins = db.prepare(`INSERT INTO screenings (work_id, question_id, stage, decision, reason, quote, quote_ok, by, prompt_version, created_at)
    VALUES (?, ?, 'title_abstract', ?, ?, NULL, NULL, 'person', NULL, ?)`);
  for (const r of rows) {
    const decision = (r[col.your_decision] ?? "").trim().toLowerCase();
    const workId = parseInt(r[col.work_id], 10);
    if (!DECISIONS.includes(decision) || !db.prepare("SELECT 1 FROM works WHERE id = ?").get(workId)) {
      if (decision) counts.skipped++;
      continue;
    }
    const model = latestModel(db, workId, questionId);
    ins.run(workId, questionId, decision, (r[col.note] ?? "").trim() || null, now());
    counts.imported++; counts[decision]++;
    if (model) pairs.push([decision, model.decision]);
  }
  const agree = pairs.filter(([a, b]) => a === b).length;
  const kappa = cohenKappa(pairs);
  return {
    ...counts,
    agreement: {
      n: pairs.length, agree,
      percent: pairs.length ? Math.round((1000 * agree) / pairs.length) / 10 : null,
      kappa: kappa == null ? null : Math.round(kappa * 1000) / 1000,
    },
  };
}
