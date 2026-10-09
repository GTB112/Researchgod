// brief.js — owns the trace check (AGENTS.md rules 1-2): every sentence of a decision brief must carry a marker, every
// marker must point at a real record, and every quotation must be word for word in the source it is attributed to.
import fs from "node:fs";
import path from "node:path";
import { verbatimIn } from "./verbatim.js";

const MARKER = /\[(?:W(\d+)(?:\s+p\.?\s*(\d+))?|E(\d+)|(decision)|(uncertainty))\]/g;
const MARKER_RUN = /^(?:\s*\[[^\]]*\])*/;

// Split on . ? ! followed by (markers,) space and a capital letter; never inside a quotation.
function sentences(line) {
  const out = []; let start = 0, inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "“") inQ = true; else if (c === "”") inQ = false; else if (c === '"') inQ = !inQ;
    if (!".?!".includes(c)) continue;
    let j = i + 1;
    if (inQ && (line[j] === "”" || line[j] === '"')) { inQ = false; j++; }
    if (inQ) continue;
    j += line.slice(j).match(MARKER_RUN)[0].length;
    const ws = line.slice(j).match(/^\s+(?=["“(]?\p{Lu})/u);
    if (ws) { out.push(line.slice(start, j)); start = j + ws[0].length; i = start - 1; }
  }
  out.push(line.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

const isTableSeparator = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

function pagesOf(db, workId, fulltextDir) {
  const ft = db.prepare("SELECT text_path FROM fulltexts WHERE work_id = ?").get(workId);
  const files = [ft?.text_path, fulltextDir && path.join(fulltextDir, `${workId}.json`)].filter(Boolean);
  for (const f of files) {
    try { const p = JSON.parse(fs.readFileSync(f, "utf8")).pages; if (Array.isArray(p)) return p; } catch { /* try next */ }
  }
  return null;
}

// Could this quote come from the work? Returns "" if yes, else the reason.
function quoteInWork(db, work, quote, page, fulltextDir) {
  const pages = pagesOf(db, work.id, fulltextDir);
  if (page) {
    if (!pages || pages[page - 1] == null) return `no full-text page ${page} for W${work.id}`;
    return verbatimIn(pages[page - 1], quote) ? "" : `quote not found on page ${page} of W${work.id}`;
  }
  const sources = [pages?.join(" "), work.abstract,
    ...db.prepare("SELECT quote FROM extractions WHERE work_id = ? AND quote IS NOT NULL").all(work.id).map((r) => r.quote)];
  return sources.some((s) => s && verbatimIn(s, quote)) ? "" : `quote not found in W${work.id}`;
}

function personIncluded(db, workId) {
  for (const { question_id } of db.prepare("SELECT DISTINCT question_id FROM screenings WHERE work_id = ? AND by = 'person'").all(workId)) {
    const d = db.prepare(`SELECT decision FROM screenings WHERE work_id = ? AND question_id = ? AND by = 'person'
      ORDER BY created_at DESC, id DESC LIMIT 1`).get(workId, question_id)?.decision;
    if (d === "include") return true;
  }
  return false;
}

export function checkBrief(db, markdown, { fulltextDir } = {}) {
  const problems = [], warnings = [], warned = new Set();
  const lines = String(markdown).split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    if (!raw.trim() || /^\s*#{1,6}\s/.test(raw) || isTableSeparator(raw)) return;
    const text = raw.replace(/^\s*(?:>\s*|[-*+]\s+|\d+[.)]\s+)/, "");
    for (const sentence of sentences(text)) {
      const fail = (problem) => problems.push({ line: lineNo, sentence, problem });
      const markers = [...sentence.matchAll(MARKER)].map((m) => ({
        index: m.index, work: m[1] ? Number(m[1]) : null, page: m[2] ? Number(m[2]) : null, excerpt: m[3] ? Number(m[3]) : null,
      }));
      if (!markers.length) { fail("no marker"); continue; }
      const works = new Map();
      for (const m of markers) {
        if (m.work != null) {
          const w = db.prepare("SELECT * FROM works WHERE id = ?").get(m.work);
          if (!w) { fail(`unknown work [W${m.work}]`); continue; }
          works.set(m.work, w);
          if (!warned.has(m.work) && !personIncluded(db, m.work)) { warned.add(m.work); warnings.push(`W${m.work} has no person include`); }
        } else if (m.excerpt != null) {
          m.row = db.prepare("SELECT * FROM excerpts WHERE id = ?").get(m.excerpt);
          if (!m.row) fail(`unknown excerpt [E${m.excerpt}]`);
        }
      }
      for (const q of sentence.matchAll(/“([^”]+)”|"([^"]+)"/g)) {
        const quote = q[1] ?? q[2], end = q.index + q[0].length;
        const next = [...sentence.slice(end).matchAll(/“[^”]+”|"[^"]+"/g)][0];
        const limit = next ? end + next.index : sentence.length;
        const targets = markers.filter((m) => m.index >= end && m.index < limit && (works.has(m.work) || m.row));
        if (!targets.length) continue;
        const reasons = targets.map((m) => m.row
          ? (verbatimIn(m.row.text, quote) || verbatimIn(m.row.translation, quote) ? "" : `quote not found in E${m.row.id}`)
          : quoteInWork(db, works.get(m.work), quote, m.page, fulltextDir));
        if (reasons.every(Boolean)) fail(`${reasons[0]}: “${quote}”`);
      }
    }
  });
  return { ok: problems.length === 0, problems, warnings };
}
