// fetch.js — downloads open-access PDFs for included works, slowly and within caps (AGENTS.md rule 9), and lists the
// included works still without full text for the owner's library browser.
import fs from "node:fs";
import path from "node:path";
import { fromJson } from "./db.js";
import { ingestPdf } from "./ingest.js";

const BASE_UA = "researchgod/0.1";
// Warning and person-check pages. Matched case-insensitively in HTML bodies only.
const BLOCK_PATTERN = /captcha|verify you are human|unusual traffic|cloudflare|access denied/i;
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ua = (email) => (email ? `${BASE_UA} (mailto:${email})` : BASE_UA);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Works a person or a model has included at title/abstract that have no full text yet. For each work and question
// the person's latest decision wins over the model's; any question's include counts.
function includedWithoutText(db) {
  return db.prepare(`
    WITH ranked AS (
      SELECT work_id, decision, ROW_NUMBER() OVER (
        PARTITION BY work_id, question_id ORDER BY (by = 'person') DESC, created_at DESC, id DESC) AS rn
      FROM screenings WHERE stage = 'title_abstract')
    SELECT w.* FROM works w
    WHERE EXISTS (SELECT 1 FROM ranked r WHERE r.work_id = w.id AND r.rn = 1 AND r.decision = 'include')
      AND NOT EXISTS (SELECT 1 FROM fulltexts f WHERE f.work_id = w.id)
    ORDER BY w.id`).all();
}

// One request per minIntervalMs: waits, if needed, so that the request starts that long after the previous one.
function makePacer(minIntervalMs, sleep, clock) {
  let last = null;
  return async () => {
    if (last !== null) {
      const wait = last + minIntervalMs - clock();
      if (wait > 0) await sleep(wait);
    }
    last = clock();
  };
}

// Unpaywall lookup by DOI. A metadata request, not a download, so it is not logged in downloads.
async function unpaywallPdf(doi, { email, fetch, pace }) {
  if (!email || !doi) return null;
  await pace();
  const url = `https://api.unpaywall.org/v2/${doi.split("/").map(encodeURIComponent).join("/")}` +
    `?email=${encodeURIComponent(email)}`;
  try {
    const res = await fetch(url, { headers: { "user-agent": ua(email), accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json())?.best_oa_location?.url_for_pdf || null;
  } catch {
    return null;
  }
}

// Downloads a PDF for each included work that lacks full text. Stops at config.fetch.dailyCap downloads a day. A host
// that answers 403/429 or a warning page is blocked for the rest of the day, including later runs that day.
// dryRun lists the works it would try and makes no request and no write.
export async function fetchFullTexts(db, {
  config, fetch = globalThis.fetch, sleep = sleepMs, clock = Date.now, log = () => {}, dryRun = false,
} = {}) {
  const f = config.fetch;
  const email = config.contactEmail || "";
  const headers = { "user-agent": ua(email), accept: "application/pdf, */*;q=0.5" };
  const pace = makePacer(f.minIntervalMs, sleep, clock);
  const counts = { done: 0, failed: 0, blocked: 0, not_pdf: 0, no_url: 0, skipped: 0, stopped: null };
  const works = includedWithoutText(db);

  if (dryRun) return { ...counts, planned: works.map((w) => ({ workId: w.id, url: w.oa_url, doi: w.doi })) };

  const day = dayOf(clock());
  const at = () => new Date(clock()).toISOString();
  const record = (workId, url, host, status, note) => {
    db.prepare("INSERT INTO downloads (work_id, url, host, status, note, at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(workId, url, host, status, note ?? null, at());
    counts[status]++;
    log(`work ${workId} ${status}${note ? `: ${note}` : ""}`);
  };
  const usedToday = () => db.prepare("SELECT COUNT(*) AS n FROM downloads WHERE substr(at, 1, 10) = ?").get(day).n;
  const hostToday = (host) => db.prepare(
    `SELECT COUNT(*) AS n, MAX(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
     FROM downloads WHERE substr(at, 1, 10) = ? AND host = ?`).get(day, host);

  for (const w of works) {
    if (usedToday() >= f.dailyCap) {
      counts.stopped = "dailyCap";
      break;
    }
    if (!w.oa_url && !(email && w.doi)) {
      counts.no_url++;
      continue;
    }
    const url = w.oa_url || (await unpaywallPdf(w.doi, { email, fetch, pace }));
    if (!url) {
      counts.no_url++;
      continue;
    }
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      counts.no_url++;
      continue;
    }
    const h = hostToday(host);
    if (h.blocked || h.n >= f.perHostDailyCap) {
      counts.skipped++;
      continue;
    }

    await pace();
    let res;
    let buf;
    try {
      res = await fetch(url, { headers, redirect: "follow" });
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      record(w.id, url, host, "failed", e.message);
      continue;
    }
    const isPdf = buf.subarray(0, 5).toString("latin1") === "%PDF-";
    const text = isPdf ? "" : buf.toString("utf8");
    const htmlish = /text\/html/i.test(res.headers.get("content-type") || "") || /^\s*</.test(text);
    if (res.status === 403 || res.status === 429 || (htmlish && BLOCK_PATTERN.test(text))) {
      record(w.id, url, host, "blocked", `HTTP ${res.status}`);
      continue;
    }
    if (isPdf && res.ok) {
      const dest = path.join(f.pdfDir, `${w.id}.pdf`);
      fs.mkdirSync(f.pdfDir, { recursive: true });
      fs.writeFileSync(dest, buf);
      try {
        await ingestPdf(db, w.id, dest, { config, source: "oa" });
        record(w.id, url, host, "done", `${buf.length} bytes`);
      } catch (e) {
        fs.rmSync(dest, { force: true });
        record(w.id, url, host, "failed", `unreadable PDF: ${e.message}`);
      }
      continue;
    }
    if (!res.ok) record(w.id, url, host, "failed", `HTTP ${res.status}`);
    else record(w.id, url, host, "not_pdf", `${res.headers.get("content-type") || "no content type"}`);
  }
  return counts;
}

// A plain HTML page listing included works without full text, each linked through the library proxy (empty prefix
// for none) so the owner can open it signed in and save the PDF into the inbox.
export function libraryQueue(db, { config }) {
  const prefix = config.library?.proxyPrefix ?? "";
  const items = includedWithoutText(db).map((w) => {
    const authors = fromJson(w.authors, []).join(", ");
    const meta = [w.year, authors, w.venue].filter(Boolean).join(" · ");
    const target = w.doi ? `${prefix}https://doi.org/${w.doi}` : (w.url ? `${prefix}${w.url}` : null);
    const title = target ? `<a href="${esc(target)}" rel="noopener">${esc(w.title)}</a>` : esc(w.title);
    return `<li>${title}<br><small>${esc(meta)} · work ${w.id}</small></li>`;
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Library queue</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 48rem; margin: 1rem auto; padding: 0 1rem;">
<h1>Included works without full text</h1>
<p>Open each link while signed in to your library, save the PDF to the inbox folder (${esc(config.fetch?.inbox ?? "")}).
Files are matched to works by DOI or title.</p>
<ol>${items.join("\n")}</ol>
</body></html>
`;
}
