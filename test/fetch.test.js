// fetch.test.js — which works are fetched, pacing, caps, blocking, and the library queue. Fake fetch and clock only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, now } from "../src/db.js";
import { normDoi, normTitle } from "../src/work.js";
import { fetchFullTexts, libraryQueue } from "../src/fetch.js";
import { makePdf } from "./fixtures/pdf/make-pdf.js";

const CAPTCHA = fs.readFileSync(new URL("./fixtures/pdf/captcha.html", import.meta.url), "utf8");
const LANDING = fs.readFileSync(new URL("./fixtures/pdf/landing.html", import.meta.url), "utf8");
const T0 = Date.UTC(2026, 9, 9, 10, 0, 0);
const DAY = 24 * 3600 * 1000;
const EMAIL = "owner@example.edu";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "rgod-fetch-"));
function config(dir, over = {}) {
  return {
    contactEmail: EMAIL,
    fetch: {
      minIntervalMs: 60000, perHostDailyCap: 25, dailyCap: 75,
      inbox: path.join(dir, "inbox"), pdfDir: path.join(dir, "pdfs"), fulltextDir: path.join(dir, "fulltext"),
      ...over,
    },
    library: { proxyPrefix: "" },
  };
}
// Fake clock and sleep: sleeping advances the clock, so pacing is visible without waiting.
function timeSource(start = T0) {
  let t = start;
  return { clock: () => t, sleep: async (ms) => { t += ms; }, set: (v) => { t = v; } };
}
// A fake web: routes maps a URL to a Response factory; every call is recorded with the clock time.
function fakeWeb(routes, time) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, at: time.clock(), headers: init.headers ?? {} });
    const route = routes[url] ?? routes[new URL(url).origin + "*"];
    if (!route) return new Response("nope", { status: 404 });
    return route();
  };
  return { fetch, calls };
}
const pdfResponse = (pages = [["A downloaded study about mentoring"]]) => () =>
  new Response(makePdf(pages), { status: 200, headers: { "content-type": "application/pdf" } });
const htmlResponse = (body, status = 200) => () =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const jsonResponse = (obj) => () => new Response(JSON.stringify(obj), { status: 200 });

function seed(db) {
  db.prepare("INSERT INTO projects (id, name, kind, created_at) VALUES ('p', 'P', 'decision', ?)").run(now());
  db.prepare("INSERT INTO questions (id, project_id, text) VALUES ('q1', 'p', 'Does mentoring work?')").run();
  db.prepare("INSERT INTO questions (id, project_id, text) VALUES ('q2', 'p', 'Does transport help?')").run();
}
function addWork(db, title, { doi = null, oa = null, url = null } = {}) {
  const r = db.prepare("INSERT INTO works (doi, title, title_norm, oa_url, url, authors, venue, year, added_at) " +
    "VALUES (?, ?, ?, ?, ?, '[\"Ana Lee\"]', 'Journal of Tests', 2021, ?)")
    .run(doi ? normDoi(doi) : null, title, normTitle(title), oa, url, now());
  return Number(r.lastInsertRowid);
}
function screen(db, workId, qid, decision, by, at, stage = "title_abstract") {
  db.prepare("INSERT INTO screenings (work_id, question_id, stage, decision, by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(workId, qid, stage, decision, by, at);
}
const downloads = (db) => db.prepare("SELECT work_id, host, status, at FROM downloads ORDER BY id").all();

test("picks included works by latest decision, person over model, any question", () => {
  const db = openDb();
  seed(db);
  const a = addWork(db, "Model includes A", { oa: "https://pub-a.example/a.pdf" });
  const b = addWork(db, "Model includes, person excludes later", { oa: "https://pub-b.example/b.pdf" });
  const c = addWork(db, "Person includes, model excludes later", { oa: "https://pub-c.example/c.pdf" });
  const d = addWork(db, "Included but already has full text", { oa: "https://pub-d.example/d.pdf" });
  const e = addWork(db, "Included for q2 only", { oa: "https://pub-e.example/e.pdf" });
  screen(db, a, "q1", "include", "model:mistral/s", "2026-01-01T00:00:00Z");
  screen(db, b, "q1", "include", "model:mistral/s", "2026-01-01T00:00:00Z");
  screen(db, b, "q1", "exclude", "person", "2026-02-01T00:00:00Z");
  screen(db, c, "q1", "include", "person", "2026-01-01T00:00:00Z");
  screen(db, c, "q1", "exclude", "model:mistral/s", "2026-02-01T00:00:00Z");
  screen(db, d, "q1", "include", "model:mistral/s", "2026-01-01T00:00:00Z");
  screen(db, e, "q2", "include", "model:mistral/s", "2026-01-01T00:00:00Z");
  screen(db, e, "q1", "exclude", "model:mistral/s", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO fulltexts (work_id, source, added_at) VALUES (?, 'manual', ?)").run(d, now());
  const time = timeSource();
  return fetchFullTexts(db, { config: config(tmp()), dryRun: true, clock: time.clock })
    .then((r) => assert.deepEqual(r.planned.map((p) => p.workId), [a, c, e]));
});

test("downloads an open-access PDF, ingests it, and logs the download", async () => {
  const dir = tmp();
  const db = openDb();
  seed(db);
  const id = addWork(db, "Mentoring study", { oa: "https://pub-a.example/a.pdf" });
  screen(db, id, "q1", "include", "person", "2026-01-01T00:00:00Z");
  const time = timeSource();
  const web = fakeWeb({ "https://pub-a.example/a.pdf": pdfResponse() }, time);
  const r = await fetchFullTexts(db, { config: config(dir), fetch: web.fetch, sleep: time.sleep, clock: time.clock });
  assert.equal(r.done, 1);
  assert.equal(r.stopped, null);
  const file = path.join(dir, "pdfs", `${id}.pdf`);
  assert.ok(fs.existsSync(file));
  const row = db.prepare("SELECT source, pages, needs_ocr, pdf_path FROM fulltexts WHERE work_id = ?").get(id);
  assert.equal(row.source, "oa");
  assert.equal(row.pages, 1);
  assert.equal(row.pdf_path, path.resolve(file));
  assert.deepEqual(downloads(db).map((d) => [d.work_id, d.host, d.status]), [[id, "pub-a.example", "done"]]);
});

test("uses Unpaywall by DOI when there is no OA URL, with the contact email", async () => {
  const dir = tmp();
  const db = openDb();
  seed(db);
  const id = addWork(db, "Only a DOI", { doi: "10.5555/abc.1" });
  screen(db, id, "q1", "include", "model:mistral/s", "2026-01-01T00:00:00Z");
  const time = timeSource();
  const web = fakeWeb({
    "https://api.unpaywall.org/v2/10.5555/abc.1?email=owner%40example.edu":
      jsonResponse({ best_oa_location: { url_for_pdf: "https://repo.example/abc.pdf" } }),
    "https://repo.example/abc.pdf": pdfResponse(),
  }, time);
  const r = await fetchFullTexts(db, { config: config(dir), fetch: web.fetch, sleep: time.sleep, clock: time.clock });
  assert.equal(r.done, 1);
  assert.equal(web.calls[0].url.startsWith("https://api.unpaywall.org/v2/10.5555/abc.1?email="), true);
  assert.equal(web.calls[0].headers["user-agent"], `researchgod/0.1 (mailto:${EMAIL})`);
  assert.equal(web.calls[1].headers["user-agent"], `researchgod/0.1 (mailto:${EMAIL})`);
});

test("waits so that requests start at least minIntervalMs apart", async () => {
  const dir = tmp();
  const db = openDb();
  seed(db);
  for (const n of [1, 2, 3]) {
    const id = addWork(db, `Study ${n}`, { oa: `https://pub-${n}.example/${n}.pdf` });
    screen(db, id, "q1", "include", "person", "2026-01-01T00:00:00Z");
  }
  const time = timeSource();
  const responses = {};
  for (const n of [1, 2, 3]) responses[`https://pub-${n}.example/${n}.pdf`] = pdfResponse();
  const web = fakeWeb(responses, time);
  let sleeps = 0;
  const sleep = async (ms) => { sleeps++; await time.sleep(ms); };
  const r = await fetchFullTexts(db, { config: config(dir), fetch: web.fetch, sleep, clock: time.clock });
  assert.equal(r.done, 3);
  assert.equal(web.calls.length, 3);
  for (let i = 1; i < web.calls.length; i++) {
    assert.ok(web.calls[i].at - web.calls[i - 1].at >= 60000, `gap ${i}`);
  }
  assert.equal(sleeps, 2);
});

test("a non-PDF body is not_pdf and leaves no full text", async () => {
  const dir = tmp();
  const db = openDb();
  seed(db);
  const id = addWork(db, "Behind a landing page", { oa: "https://pub-l.example/landing" });
  screen(db, id, "q1", "include", "person", "2026-01-01T00:00:00Z");
  const time = timeSource();
  const web = fakeWeb({ "https://pub-l.example/landing": htmlResponse(LANDING) }, time);
  const r = await fetchFullTexts(db, { config: config(dir), fetch: web.fetch, sleep: time.sleep, clock: time.clock });
  assert.equal(r.not_pdf, 1);
  assert.equal(r.blocked, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fulltexts").get().n, 0);
  assert.equal(fs.existsSync(path.join(dir, "pdfs")), false);
  assert.deepEqual(downloads(db).map((d) => d.status), ["not_pdf"]);
});

test("403 and captcha pages block the host for the rest of the day, including the next run", async () => {
  const dir = tmp();
  const db = openDb();
  seed(db);
  const w1 = addWork(db, "Forbidden", { oa: "https://wall.example/1.pdf" });
  const w2 = addWork(db, "Same host, later", { oa: "https://wall.example/2.pdf" });
  const w3 = addWork(db, "Captcha page elsewhere", { oa: "https://tollgate.example/3.pdf" });
  const w4 = addWork(db, "Fine host", { oa: "https://open.example/4.pdf" });
  for (const id of [w1, w2, w3, w4]) screen(db, id, "q1", "include", "person", "2026-01-01T00:00:00Z");
  const time = timeSource();
  const web = fakeWeb({
    "https://wall.example/1.pdf": htmlResponse("<h1>Forbidden</h1>", 403),
    "https://tollgate.example/3.pdf": htmlResponse(CAPTCHA.replace("Verify You Are Human", "VERIFY YOU ARE HUMAN")),
    "https://open.example/4.pdf": pdfResponse(),
  }, time);
  const cfg = config(dir);
  const first = await fetchFullTexts(db, { config: cfg, fetch: web.fetch, sleep: time.sleep, clock: time.clock });
  assert.equal(first.blocked, 2);
  assert.equal(first.done, 1);
  // w2 shares the blocked host: skipped without a request, in the same run and in the next one that day.
  assert.equal(first.skipped, 1);
  const urlsAfterFirst = web.calls.map((c) => c.url);
  assert.ok(!urlsAfterFirst.includes("https://wall.example/2.pdf"));
  const w5 = addWork(db, "Another on the wall", { oa: "https://wall.example/5.pdf" });
  screen(db, w5, "q1", "include", "person", "2026-01-01T00:00:00Z");
  time.set(T0 + 3600 * 1000);
  const second = await fetchFullTexts(db, { config: cfg, fetch: web.fetch, sleep: time.sleep, clock: time.clock });
  // w1, w2, w5 (wall.example) and w3 (tollgate.example) are all still blocked for today.
  assert.equal(second.skipped, 4);
  assert.equal(second.done, 0);
  assert.ok(!web.calls.some((c) => c.url.includes("wall.example/2") || c.url.includes("wall.example/5")));
  // The next day the block lapses: wall.example is requested again. It is answered 403 again, so w2 and w5 wait.
  time.set(T0 + DAY);
  web.calls.length = 0;
  const third = await fetchFullTexts(db, { config: cfg, fetch: web.fetch, sleep: time.sleep, clock: time.clock });
  assert.deepEqual(web.calls.map((c) => c.url).filter((u) => u.includes("wall.example")), ["https://wall.example/1.pdf"]);
  assert.ok(web.calls.some((c) => c.url === "https://tollgate.example/3.pdf"));
  assert.equal(third.blocked, 2);
  assert.equal(third.skipped, 2);
});

test("perHostDailyCap skips a host once it has reached the cap today", async () => {
  const dir = tmp();
  const db = openDb();
  seed(db);
  const ids = ["one", "two"].map((k) => addWork(db, `Host cap ${k}`, { oa: `https://same.example/${k}.pdf` }));
  for (const id of ids) screen(db, id, "q1", "include", "person", "2026-01-01T00:00:00Z");
  const time = timeSource();
  const web = fakeWeb({ "https://same.example/one.pdf": pdfResponse(), "https://same.example/two.pdf": pdfResponse() }, time);
  const r = await fetchFullTexts(db, {
    config: config(dir, { perHostDailyCap: 1 }), fetch: web.fetch, sleep: time.sleep, clock: time.clock,
  });
  assert.equal(r.done, 1);
  assert.equal(r.skipped, 1);
  assert.equal(web.calls.length, 1);
});

test("dailyCap counts today's download rows only, and stops the run", async () => {
  const dir = tmp();
  const db = openDb();
  seed(db);
  const other = addWork(db, "Earlier download");
  // One row from today and one from yesterday: only today's counts toward the cap of 2.
  const ins = db.prepare("INSERT INTO downloads (work_id, url, host, status, at) VALUES (?, 'https://x/', 'x', 'done', ?)");
  ins.run(other, new Date(T0).toISOString());
  ins.run(other, new Date(T0 - DAY).toISOString());
  const ids = [1, 2, 3].map((n) => addWork(db, `Cap study ${n}`, { oa: `https://host${n}.example/${n}.pdf` }));
  for (const id of ids) screen(db, id, "q1", "include", "person", "2026-01-01T00:00:00Z");
  const time = timeSource();
  const responses = {};
  for (const n of [1, 2, 3]) responses[`https://host${n}.example/${n}.pdf`] = pdfResponse();
  const web = fakeWeb(responses, time);
  const r = await fetchFullTexts(db, {
    config: config(dir, { dailyCap: 2 }), fetch: web.fetch, sleep: time.sleep, clock: time.clock,
  });
  assert.equal(r.done, 1);
  assert.equal(r.stopped, "dailyCap");
  assert.equal(web.calls.length, 1);
});

test("dryRun makes no request and writes nothing", async () => {
  const dir = tmp();
  const db = openDb();
  seed(db);
  const id = addWork(db, "Dry run study", { oa: "https://pub-dry.example/d.pdf" });
  screen(db, id, "q1", "include", "person", "2026-01-01T00:00:00Z");
  const boom = async () => { throw new Error("network used"); };
  const r = await fetchFullTexts(db, { config: config(dir), fetch: boom, dryRun: true, clock: timeSource().clock });
  assert.deepEqual(r.planned, [{ workId: id, url: "https://pub-dry.example/d.pdf", doi: null }]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM downloads").get().n, 0);
  assert.equal(fs.existsSync(path.join(dir, "pdfs")), false);
});

test("libraryQueue lists included works without full text, HTML-escaped and proxied", () => {
  const db = openDb();
  seed(db);
  const id = addWork(db, "Mentoring <b>&</b> \"trust\"", { doi: "10.7777/q.9" });
  screen(db, id, "q1", "include", "person", "2026-01-01T00:00:00Z");
  const done = addWork(db, "Already have it", { doi: "10.7777/done" });
  screen(db, done, "q1", "include", "person", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO fulltexts (work_id, source, added_at) VALUES (?, 'manual', ?)").run(done, now());
  const html = libraryQueue(db, {
    config: { fetch: { inbox: "inbox" }, library: { proxyPrefix: "https://proxy.lib.example/login?url=" } },
  });
  const href = "https://proxy.lib.example/login?url=https://doi.org/10.7777/q.9";
  assert.ok(html.includes(`href="${href.replace(/&/g, "&amp;")}"`));
  assert.ok(html.includes("Mentoring &lt;b&gt;&amp;&lt;/b&gt; &quot;trust&quot;"));
  assert.ok(!html.includes("Already have it"));
  assert.ok(!html.includes("<b>&"));
});
