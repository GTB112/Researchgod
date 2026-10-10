// ingest.test.js — page text, the fulltexts row, and inbox matching. Generated PDFs only; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { openDb, now } from "../src/db.js";
import { normDoi, normTitle } from "../src/work.js";
import { pdfPages, ingestPdf, ingestInbox } from "../src/ingest.js";
import { writePdf } from "./fixtures/pdf/make-pdf.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "rgod-ingest-"));
const config = (dir) => ({
  contactEmail: "",
  fetch: {
    minIntervalMs: 60000, perHostDailyCap: 25, dailyCap: 75,
    inbox: path.join(dir, "inbox"), pdfDir: path.join(dir, "pdfs"), fulltextDir: path.join(dir, "fulltext"),
  },
  library: { proxyPrefix: "" },
});
function addWork(db, title, doi = null) {
  const r = db.prepare("INSERT INTO works (doi, title, title_norm, added_at) VALUES (?, ?, ?, ?)")
    .run(doi ? normDoi(doi) : null, title, normTitle(title), now());
  return Number(r.lastInsertRowid);
}

test("pdfPages returns each page's text", async () => {
  const dir = tmp();
  const file = writePdf(dir, "two.pdf", [["Alpha beta gamma"], ["Delta epsilon zeta"]]);
  const pages = await pdfPages(file);
  assert.equal(pages.length, 2);
  assert.match(pages[0], /Alpha beta gamma/);
  assert.match(pages[1], /Delta epsilon zeta/);
  assert.doesNotMatch(pages[0], /Delta/);
});

test("ingestPdf writes the page JSON and a fulltexts row with sha256 and needs_ocr", async () => {
  const dir = tmp();
  const cfg = config(dir);
  const db = openDb();
  const id = addWork(db, "A short study");
  const file = writePdf(dir, "short.pdf", [["Only a few words here."], ["And a second page."]]);
  const out = await ingestPdf(db, id, file, { config: cfg, source: "oa" });
  const json = JSON.parse(fs.readFileSync(path.join(cfg.fetch.fulltextDir, `${id}.json`), "utf8"));
  assert.deepEqual(json.pages, await pdfPages(file));
  const row = db.prepare("SELECT * FROM fulltexts WHERE work_id = ?").get(id);
  const sha = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  assert.equal(row.sha256, sha);
  assert.equal(row.pages, 2);
  assert.equal(row.needs_ocr, 1);
  assert.equal(row.source, "oa");
  assert.equal(row.text_path, out.textPath);
  assert.equal(row.pdf_path, path.resolve(file));
});

test("ingestPdf does not flag a text-rich PDF as needing OCR", async () => {
  const dir = tmp();
  const cfg = config(dir);
  const db = openDb();
  const id = addWork(db, "A long study");
  const line = "Participants reported that mentoring from a trusted adult helped them stay in school. ";
  const file = writePdf(dir, "long.pdf", [[line, line, line, line], [line, line, line, line]]);
  const out = await ingestPdf(db, id, file, { config: cfg, source: "library" });
  assert.equal(out.needsOcr, false);
  assert.equal(db.prepare("SELECT needs_ocr FROM fulltexts WHERE work_id = ?").get(id).needs_ocr, 0);
});

test("ingestInbox matches by DOI and by title, leaves unknown files, and files matched PDFs", async () => {
  const dir = tmp();
  const cfg = config(dir);
  const db = openDb();
  const byDoi = addWork(db, "Mentoring and school engagement", "https://doi.org/10.1000/XYZ.123");
  const byTitle = addWork(db, "Peer mentoring for young adults in rural towns");
  addWork(db, "Unrelated work about transport");
  fs.mkdirSync(cfg.fetch.inbox, { recursive: true });
  // The DOI sits on page 2, which the inbox match reads.
  writePdf(cfg.fetch.inbox, "doi-match.pdf", [["Front matter only"], ["Cite as: doi: 10.1000/xyz.123."]]);
  writePdf(cfg.fetch.inbox, "title-match.pdf", [["Peer Mentoring for Young Adults in Rural Towns"], ["Body text"]]);
  writePdf(cfg.fetch.inbox, "unknown.pdf", [["Something about cooking pasta"]]);
  fs.writeFileSync(path.join(cfg.fetch.inbox, "broken.pdf"), "not a pdf at all");

  const { matched, unmatched } = await ingestInbox(db, { config: cfg });
  assert.deepEqual(matched.map((m) => [m.file, m.workId, m.by]), [
    ["doi-match.pdf", byDoi, "doi"],
    ["title-match.pdf", byTitle, "title"],
  ]);
  assert.deepEqual(unmatched.map((u) => u.file), ["broken.pdf", "unknown.pdf"]);
  assert.match(unmatched[0].reason, /unreadable/);

  assert.ok(fs.existsSync(path.join(cfg.fetch.pdfDir, `${byDoi}.pdf`)));
  assert.ok(fs.existsSync(path.join(cfg.fetch.pdfDir, `${byTitle}.pdf`)));
  assert.ok(!fs.existsSync(path.join(cfg.fetch.inbox, "doi-match.pdf")));
  assert.ok(fs.existsSync(path.join(cfg.fetch.inbox, "unknown.pdf")));

  const rows = db.prepare("SELECT work_id, source FROM fulltexts ORDER BY work_id").all();
  assert.deepEqual(rows.map((r) => [r.work_id, r.source]), [[byDoi, "library"], [byTitle, "library"]]);
});

test("ingestInbox returns empty results when there is no inbox folder", async () => {
  const dir = tmp();
  const res = await ingestInbox(openDb(), { config: config(dir) });
  assert.deepEqual(res, { matched: [], unmatched: [] });
});
