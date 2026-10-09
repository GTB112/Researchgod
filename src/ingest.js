// ingest.js — turns a PDF into stored page text and a fulltexts row, and files PDFs the owner saved into the inbox
// under the work they belong to. The page text is what verbatim quote checks read later.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { normDoi, normTitle } from "./work.js";
import { now } from "./db.js";

// Text of each page, text items joined in reading order (line breaks where pdf.js reports them).
export async function pdfPages(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const task = getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => (it.str ?? "") + (it.hasEOL ? "\n" : " ")).join("").trim());
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

// Stores {pages} as JSON under fulltextDir and writes the fulltexts row. A PDF with fewer than ~200 non-space
// characters per page on average is most likely a scan, so it is flagged needs_ocr.
export async function ingestPdf(db, workId, file, { config, source = "manual" }) {
  const pages = await pdfPages(file);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const chars = pages.reduce((n, p) => n + p.replace(/\s+/g, "").length, 0);
  const needsOcr = pages.length === 0 || chars / pages.length < 200 ? 1 : 0;
  const dir = config.fetch.fulltextDir;
  fs.mkdirSync(dir, { recursive: true });
  const textPath = path.resolve(dir, `${workId}.json`);
  fs.writeFileSync(textPath, JSON.stringify({ pages }));
  db.prepare(`INSERT OR REPLACE INTO fulltexts
    (work_id, pdf_path, text_path, pages, sha256, source, needs_ocr, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(workId, path.resolve(file), textPath, pages.length, sha256, source, needsOcr, now());
  return { workId, pages: pages.length, needsOcr: needsOcr === 1, textPath, sha256 };
}

// The work a PDF belongs to: a DOI found in its first two pages, else a work title found in its first page.
// Titles are matched on whole words; when two titles of equal length both fit, the match is ambiguous and is refused.
function matchWork(pages, dois, titles) {
  for (const m of pages.slice(0, 2).join("\n").matchAll(/10\.\d{4,9}\/\S+/g)) {
    const doi = normDoi(m[0]);
    if (doi && dois.has(doi)) return { workId: dois.get(doi), by: "doi" };
  }
  const first = ` ${normTitle(pages[0] ?? "")} `;
  const hits = titles.filter((t) => first.includes(` ${t.title_norm} `))
    .sort((a, b) => b.title_norm.length - a.title_norm.length);
  if (!hits.length) return null;
  if (hits[1] && hits[1].title_norm.length === hits[0].title_norm.length) return null;
  return { workId: hits[0].id, by: "title" };
}

// Sorts every PDF in config.fetch.inbox to its work: moves it to <pdfDir>/<work_id>.pdf and ingests it with
// source 'library'. Files that match nothing, or cannot be read, stay in the inbox and are reported.
export async function ingestInbox(db, { config }) {
  const { inbox, pdfDir } = config.fetch;
  const matched = [];
  const unmatched = [];
  if (!fs.existsSync(inbox)) return { matched, unmatched };
  const dois = new Map(db.prepare("SELECT id, doi FROM works WHERE doi IS NOT NULL").all().map((r) => [r.doi, r.id]));
  const titles = db.prepare("SELECT id, title_norm FROM works WHERE title_norm <> ''").all();
  const files = fs.readdirSync(inbox).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  for (const name of files) {
    const src = path.join(inbox, name);
    let pages;
    try {
      pages = await pdfPages(src);
    } catch (e) {
      unmatched.push({ file: name, reason: `unreadable: ${e.message}` });
      continue;
    }
    const match = matchWork(pages, dois, titles);
    if (!match) {
      unmatched.push({ file: name, reason: "no DOI or title match" });
      continue;
    }
    fs.mkdirSync(pdfDir, { recursive: true });
    const dest = path.join(pdfDir, `${match.workId}.pdf`);
    fs.copyFileSync(src, dest);
    fs.rmSync(src);
    await ingestPdf(db, match.workId, dest, { config, source: "library" });
    matched.push({ file: name, workId: match.workId, by: match.by });
  }
  return { matched, unmatched };
}
