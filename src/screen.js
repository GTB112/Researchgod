// screen.js — title/abstract screening with a model. Owns the rules: no abstract means no model call; a quote that is
// not word for word in title+abstract downgrades the decision to 'maybe'; people's decisions outrank the model's.
import fs from "node:fs";
import { now, fromJson } from "./db.js";
import { verbatimIn } from "./verbatim.js";

export const PROMPT_VERSION = "screen-v1";
const TEMPLATE = fs.readFileSync(new URL("../prompts/screen.md", import.meta.url), "utf8");
const bullets = (a) => (a.length ? a.map((x) => `- ${x}`).join("\n") : "- (none given)");
const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");

// A person's latest decision if any, else the model's latest, else null. Returns the screenings row.
export function latestDecision(db, workId, questionId, stage = "title_abstract") {
  const q = (cond) => db.prepare(`SELECT * FROM screenings WHERE work_id=? AND question_id=? AND stage=? AND ${cond} ORDER BY id DESC LIMIT 1`)
    .get(workId, questionId, stage);
  return q("by = 'person'") ?? q("by != 'person'") ?? null;
}

export async function screenQuestion(db, llm, { questionId, limit, workIds } = {}) {
  const q = db.prepare("SELECT * FROM questions WHERE id=?").get(questionId);
  if (!q) throw new Error(`unknown question: ${questionId}`);
  const include = bullets(fromJson(q.include_criteria, [])), exclude = bullets(fromJson(q.exclude_criteria, []));
  let works = db.prepare(`SELECT DISTINCT w.* FROM works w JOIN work_searches ws ON ws.work_id = w.id
    JOIN searches s ON s.id = ws.search_id WHERE s.question_id = ? ORDER BY w.id`).all(questionId);
  if (workIds) works = works.filter((w) => workIds.includes(w.id));
  const done = db.prepare("SELECT 1 FROM screenings WHERE work_id=? AND question_id=? AND stage='title_abstract' LIMIT 1");
  const counts = { include: 0, exclude: 0, maybe: 0, skipped: 0, failed: 0 };
  const insert = db.prepare(`INSERT INTO screenings (work_id, question_id, stage, decision, reason, quote, quote_ok, by, prompt_version, created_at)
    VALUES (?,?,'title_abstract',?,?,?,?,?,?,?)`);
  const store = (w, decision, reason, quote, ok) => {
    insert.run(w.id, questionId, decision, reason, quote, ok, llm.by, PROMPT_VERSION, now());
    counts[decision]++;
  };
  let n = 0;
  for (const w of works) {
    if (done.get(w.id, questionId)) { counts.skipped++; continue; }
    if (limit != null && n >= limit) break;
    n++;
    if (!w.abstract?.trim()) { store(w, "maybe", "no abstract", null, null); continue; } // nothing to quote, so no call
    const prompt = fill(TEMPLATE, { question: q.text, include, exclude, title: w.title, abstract: w.abstract });
    let out;
    try { out = (await llm.json(prompt, { purpose: "screen", maxTokens: 300 })).data; }
    catch (e) { if (e.name === "BudgetError") throw e; counts.failed++; continue; } // leave unscreened; retried next run
    let decision = String(out?.decision ?? "").toLowerCase().trim();
    let reason = String(out?.reason ?? "").trim() || null;
    const quote = String(out?.quote ?? "").trim() || null;
    if (!["include", "exclude", "maybe"].includes(decision)) { reason = `invalid decision "${out?.decision}": ${reason ?? ""}`.trim(); decision = "maybe"; }
    let ok = null;
    if (quote) ok = verbatimIn(`${w.title}\n${w.abstract}`, quote) ? 1 : 0;
    else if (decision !== "maybe") ok = 0;
    if (ok === 0) { reason = `quote not found: ${reason ?? ""}`.trim(); decision = "maybe"; } // verbatim or nothing
    store(w, decision, reason, quote, ok);
  }
  return counts;
}
