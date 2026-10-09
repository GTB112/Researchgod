// extract.js — study-template extraction with quotes. Owns the rules: the model never infers (a field it does not
// report is a not_reported row), and every quote is checked word for word against its page or the abstract.
import fs from "node:fs";
import path from "node:path";
import { now } from "./db.js";
import { verbatimIn } from "./verbatim.js";

export const PROMPT_VERSION = "extract-v1";
export const TEMPLATE_FIELDS = ["population", "setting_country", "setting_context", "intervention", "deliverer",
  "intensity_duration", "comparator", "outcomes", "follow_up", "design", "sample_size", "attrition", "effect",
  "bias_concerns", "implementation_notes", "claim_kinds"];
const CLAIM_KINDS = ["outcome", "mechanism", "implementation", "local_fit"];
const TEMPLATE = fs.readFileSync(new URL("../prompts/extract.md", import.meta.url), "utf8");
const MAX_CHARS = 150000; // keep one call inside a free-tier context window
const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");

function loadPages(db, workId, fulltextDir) {
  const ft = db.prepare("SELECT text_path FROM fulltexts WHERE work_id=?").get(workId);
  if (!ft?.text_path) return null;
  const p = path.isAbsolute(ft.text_path) || !fulltextDir ? ft.text_path : path.join(fulltextDir, ft.text_path);
  if (!fs.existsSync(p)) return null;
  const pages = JSON.parse(fs.readFileSync(p, "utf8")).pages;
  return Array.isArray(pages) ? pages.map(String) : null;
}

export async function extractWork(db, llm, { workId, questionId, fulltextDir } = {}) {
  const w = db.prepare("SELECT * FROM works WHERE id=?").get(workId);
  if (!w) throw new Error(`unknown work: ${workId}`);
  const q = db.prepare("SELECT * FROM questions WHERE id=?").get(questionId);
  if (!q) throw new Error(`unknown question: ${questionId}`);
  const pages = loadPages(db, workId, fulltextDir);
  const source = pages ? "full_text" : "abstract";
  const abstractText = `${w.title}\n${w.abstract ?? ""}`;
  const hasText = pages ? pages.some((p) => p.trim()) : !!w.abstract?.trim();

  let fields = {};
  if (hasText) { // no text at all: nothing to ask, every field is not reported
    const text = (pages ? pages.map((p, i) => `[[page ${i + 1}]]\n${p}`).join("\n\n") : abstractText).slice(0, MAX_CHARS);
    const prompt = fill(TEMPLATE, { question: q.text, source: pages ? "full text with [[page N]] markers" : "title and abstract only", text });
    fields = (await llm.json(prompt, { purpose: "extract", maxTokens: 3000 })).data?.fields ?? {};
  }

  const res = { fields: 0, quotesOk: 0, quotesBad: 0, notReported: 0 };
  const insert = db.prepare(`INSERT INTO extractions (work_id, question_id, field, value, quote, page, not_reported, quote_ok, source, by, prompt_version, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const field of TEMPLATE_FIELDS) {
    const f = fields[field];
    let value = f && !f.not_reported && f.value != null ? String(f.value).trim() : "";
    const quote = f && f.quote != null ? String(f.quote).trim() : "";
    if (field === "claim_kinds" && value) {
      value = value.split(/[,;]\s*/).map((s) => s.trim().toLowerCase()).filter((s) => CLAIM_KINDS.includes(s)).join(", ");
    }
    res.fields++;
    if (!value) { // never infer: absent means not reported
      insert.run(workId, questionId, field, null, null, null, 1, null, source, llm.by, PROMPT_VERSION, now());
      res.notReported++;
      continue;
    }
    let ok = 0, page = null;
    if (quote) {
      if (pages) {
        const given = Number.isInteger(+f.page) ? +f.page : null;
        if (given && given >= 1 && given <= pages.length && verbatimIn(pages[given - 1], quote)) { ok = 1; page = given; }
        else { // wrong or missing page: accept the quote if it is anywhere, and record where it is
          const found = pages.findIndex((p) => verbatimIn(p, quote));
          if (found >= 0) { ok = 1; page = found + 1; } else page = given;
        }
      } else ok = verbatimIn(abstractText, quote) ? 1 : 0;
    }
    insert.run(workId, questionId, field, value, quote || null, page, 0, ok, source, llm.by, PROMPT_VERSION, now());
    ok ? res.quotesOk++ : res.quotesBad++;
  }
  return res;
}
