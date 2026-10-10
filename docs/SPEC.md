# Build spec

The contract between modules. Read this, `AGENTS.md`, `src/schema.sql`, `src/db.js`, `src/work.js` and
`src/verbatim.js`; nothing else is needed to build a module. Do not change those four files; if a contract is wrong,
say so in your report instead.

## Conventions

- Node ≥ 22.13, ES modules, plain JavaScript, no TypeScript, no framework, no bundler. Dependencies: only `exceljs` and
  `pdfjs-dist` (already installed). Use global `fetch`, `node:sqlite` (via `src/db.js`), `node:test`, `node:assert`.
- Short header comment per file saying what it owns; a one-line *why* comment where a rule is enforced. No line
  numbers in docs.
- Every network function takes an injectable `fetch` option (default `globalThis.fetch`) so tests never touch the
  network. Send `user-agent: researchgod/0.1 (mailto:<contactEmail>)` when an email is configured.
- Tests: `test/<module>.test.js`, `node --no-warnings --test test/<module>.test.js`. No network in tests; fixtures in
  `test/fixtures/`. Use `openDb()` (in-memory) for database tests.
- Dates: ISO strings from `now()` in `src/db.js`.

## Modules

### Sources — `src/sources/*.js`

Each exports `async function search(query, { from, until, limit = 100, fetch, email, apiKey } = {})` returning
`{ works: Work[], total, url }` (`from`/`until` are years; `total` is the source's reported count; `url` is the request
made, for the search log). Works go through `makeWork`. Page through results until `limit`.

| File | API | Notes |
|---|---|---|
| `openalex.js` | `https://api.openalex.org/works?search=` | Abstract from `abstract_inverted_index` (rebuild word order); `ids.openalex`; `oaUrl` from `best_oa_location.pdf_url`; `fields` from `topics[].display_name` (or `concepts`); cursor paging; `mailto` param when email set. Also export `async function citations(openalexId, { direction: 'references' \| 'cited_by', limit, fetch })` → `{ works }` for citation chasing. |
| `crossref.js` | `https://api.crossref.org/works?query=` | Abstract is JATS XML: strip tags. `filter=from-pub-date:<from>,until-pub-date:<until>`. |
| `pubmed.js` | E-utilities `esearch` then `efetch` (XML) | `ids.pmid`, abstract sections joined; parse XML with regex, no XML dependency. |
| `europepmc.js` | `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core` | `ids.pmid`, `ids.pmcid`; `cursorMark` paging. |
| `eric.js` | `https://api.ies.ed.gov/eric/?search=&format=json` | `ids.eric`; `fields` from subjects. |
| `semanticscholar.js` | `https://api.semanticscholar.org/graph/v1/paper/search` | Optional `x-api-key`; `ids.s2`; `oaUrl` from `openAccessPdf.url`. |
| `unpaywall.js` | `https://api.unpaywall.org/v2/<doi>?email=` | Export `async function oaPdf(doi, { email, fetch })` → PDF URL or null. Not a search. |
| `index.js` | — | `export const SOURCES = { openalex, crossref, pubmed, europepmc, eric, semanticscholar }` (module namespaces). |

### Importers — `src/importers/*.js`

Each exports `parse(text) → Work[]` (via `makeWork`; skip records without a title).

- `ris.js`: RIS (EBSCO, ProQuest, Web of Science, Scopus, Consensus exports). TI/T1, AU/A1, PY/Y1/DA, JO/JF/T2/JA,
  AB/N2, DO, UR, KW, LA, TY. DOI also from a `doi.org` URL.
- `bibtex.js`: BibTeX (Consensus, Google Scholar, Zotero). Braces and quoted values, nested braces, `and`-separated
  authors (`Family, Given` → `Given Family`), LaTeX accents to Unicode for common cases.
- `csv.js`: CSV with a header row (RFC 4180 quoting). Columns matched case-insensitively to common names: title,
  authors/author (`;` separated), year/publication year, journal/source/venue/source title, abstract, doi, url.
  Also export `parseCsv(text) → string[][]` for other modules.
- `index.js`: `export function parseFile(name, text)` choosing by extension (`.ris`, `.bib`, `.csv`, `.txt` → RIS if
  it has `TY  -`).

### Store — `src/dedupe.js`, `src/store.js`

- `upsertWork(db, work, { searchId, rank } = {}) → { id, isNew }`: match by `doi`; else by `title_norm` with year
  within ±1 (or either year null) and the same `firstSurname`. On a match, fill null columns, keep the longer abstract,
  merge `ids`, `fields` (union), take the larger `cited_by`; never overwrite a non-null value with null. Insert into
  `work_searches` when `searchId` is given.
- `logSearch(db, { questionId, source, kind, query, params, resultCount }) → searchId`.
- `store.js`: `exportJsonl(db, dir)` writes one `<table>.jsonl` per table in `TABLES` (rows ordered by primary key;
  JSON columns kept as text). `importJsonl(db, dir)` loads them into an empty database (missing files skipped).
  Round-trip must be lossless.

### Models — `src/llm.js`, `src/screen.js`, `src/extract.js`, `prompts/`

- `llm.js`: `makeLlm({ provider, model, minIntervalMs = 1100, maxCalls = 300, db, fetch, mock })` →
  `{ json(prompt, { purpose, maxTokens }) → { data, usage }, calls }`.
  - `mistral`: POST `https://api.mistral.ai/v1/chat/completions`, `Authorization: Bearer $MISTRAL_API_KEY`,
    `response_format: { type: 'json_object' }`, `temperature: 0.1`. Spaces calls by `minIntervalMs`; retries 429 and
    5xx three times with backoff (honour `retry-after`).
  - `claude-cli`: `spawn('claude', ['-p', '--model', model, '--output-format', 'json'])`, prompt on stdin, parse the
    JSON envelope's `result` (strip a ```json fence), usage from its `usage`. Binary from `CLAUDE_CLI` env if set.
  - `mock`: `mock(prompt) → object` for tests.
  - Every call (ok or failed) writes a `usage` row when `db` is given. Throws `BudgetError` once `maxCalls` is reached.
- `screen.js`: `export const PROMPT_VERSION`; `async function screenQuestion(db, llm, { questionId, limit, workIds })`
  screens works linked to the question (through `work_searches`→`searches.question_id`) that have no title_abstract
  screening yet. Prompt from `prompts/screen.md` (placeholders `{{question}}`, `{{include}}`, `{{exclude}}`,
  `{{title}}`, `{{abstract}}`). Model returns `{ decision, reason, quote }`. Rules: no abstract → store `maybe`,
  reason "no abstract", no model call. Quote not verbatim in title+abstract (`verbatimIn`) → store `maybe` with
  reason prefixed "quote not found:". Lean towards include/maybe (said in the prompt). Returns counts
  `{ include, exclude, maybe, skipped }`. Also export `latestDecision(db, workId, questionId, stage)` → a person's
  latest decision if any, else the model's latest, else null.
- `extract.js`: `export const TEMPLATE_FIELDS = ['population', 'setting_country', 'setting_context', 'intervention',
  'deliverer', 'intensity_duration', 'comparator', 'outcomes', 'follow_up', 'design', 'sample_size', 'attrition',
  'effect', 'bias_concerns', 'implementation_notes', 'claim_kinds']`.
  `async function extractWork(db, llm, { workId, questionId, fulltextDir })`: source is the full text when
  `fulltexts.text_path` exists (pages joined with `[[page N]]` markers), else the abstract. Prompt from
  `prompts/extract.md`; the model returns `{ fields: { <field>: { value, quote, page } | { not_reported: true } } }`.
  Store one `extractions` row per template field (missing field → not_reported). `quote_ok`: full text → the quote is
  verbatim in that page's text (or, if page missing/wrong, anywhere — then store the page where it was found);
  abstract → verbatim in the abstract. `claim_kinds` value is a comma list from outcome, mechanism, implementation,
  local_fit. Returns `{ fields, quotesOk, quotesBad, notReported }`.
- Prompts say: answer only from the text given; never infer; quote exactly; say not reported when absent.

### Files — `src/fetch.js`, `src/ingest.js`

- `fetch.js`: `async function fetchFullTexts(db, { config, fetch, sleep, log, dryRun })` for works with a model or
  person `include` (latest decision, any question) and no `fulltexts` row. URL: `works.oa_url`, else Unpaywall by DOI.
  Rules (from AGENTS.md rule 9): at most one request per `minIntervalMs`; `perHostDailyCap` and `dailyCap` counted
  from today's `downloads` rows; a response must start with `%PDF-` or it is `not_pdf`; an HTTP 403/429 or an HTML
  page mentioning captcha, "verify you are human", "unusual traffic", cloudflare or "access denied" marks the host
  `blocked` and skips that host for the rest of the day; never retry a blocked host the same day; honest user-agent.
  Saved to `<pdfDir>/<work_id>.pdf`, then `ingestPdf`. Returns counts. Also
  `function libraryQueue(db, { config }) → html`: a plain page listing included works without full text, each linked
  through `config.library.proxyPrefix + 'https://doi.org/' + doi` (or the work url), so the owner opens them in their
  signed-in browser and saves PDFs into the inbox.
- `ingest.js`: `async function pdfPages(path) → string[]` (pdfjs-dist `legacy/build/pdf.mjs`, text items joined per
  page). `async function ingestPdf(db, workId, path, { config, source })`: writes `<fulltextDir>/<work_id>.json`
  `{ pages }`, a `fulltexts` row (`needs_ocr` = 1 when fewer than ~200 characters per page on average), sha256.
  `async function ingestInbox(db, { config })`: for each PDF in the inbox, match a work by a DOI found in the first two
  pages' text, else by a work's `title_norm` contained in the first page's normalized text; move the PDF to
  `<pdfDir>/<work_id>.pdf`, ingest with `source: 'library'`. Returns `{ matched: [...], unmatched: [...] }`.

### Outputs — `src/review.js`, `src/fieldmap.js`, `src/brief.js`, `src/export/xlsx.js`

- `review.js`: `exportReview(db, { questionId, sample, decision, seed }) → csv` with columns `work_id, title, year,
  venue, doi, model_decision, model_reason, model_quote, your_decision, note`. `sample: n` draws a seeded random
  sample stratified across model decisions (so excluded papers are always checked). `importReview(db, csvText,
  { questionId })` stores rows whose `your_decision` is include/exclude/maybe as `by: 'person'` screenings (note →
  reason); returns counts and the agreement between person and model (percent agreement and Cohen's kappa).
- `fieldmap.js`: `fieldMap(db, { questionId, rows = 'design', cols = 'setting_country' })` over works whose latest
  title_abstract decision is include → `{ total, byYear, byField, byExtraction: { <field>: counts }, grid: { rows, cols,
  cells }, candidateGaps: [{ row, col }] }`. Extraction values are bucketed by lowercase trimmed value; not_reported
  counts as "not reported". `toMarkdown(map)` renders it, labelling gaps "candidate: confirm with a broad search".
- `brief.js`: `checkBrief(db, markdown, { fulltextDir }) → { ok, problems: [{ line, sentence, problem }],
  warnings }`. Markers: `[W12]` or `[W12 p.4]` (work), `[E3]` (excerpt), `[decision]` (the owner's decision),
  `[uncertainty]`. Every sentence of body text (not headings, not empty lines, not table separator rows) needs at least
  one marker. Unknown ids are problems. A quotation ("…" or “…”) followed in the same sentence by a work marker must be
  verbatim in that work's full-text page (when `p.N` given), else its full text, abstract, or one of its extraction
  quotes; with an excerpt marker, in the excerpt text or translation. Warning (not a problem) when a cited work has no
  person `include`. A sentence is split on `.`, `?`, `!` followed by space and a capital letter, keeping markers that
  follow the stop with their sentence.
- `export/xlsx.js`: `async function exportWorkbook(db, { projectId, path })` with exceljs. Sheets: **Overview**
  (project, questions, counts per stage, date), **Key papers** (person-included only: title hyperlinked to doi/url,
  first author et al., year, venue, design, finding quote, question), **Field map** (grid from `fieldMap`), **Searches**
  (the search log). Style: navy header row (`FF1F3A5F`) with white bold text, light cream banding (`FFFAF7F0`), frozen
  header, sensible column widths, wrapped text, Georgia 11 for body. No colours beyond these.

### CLI and living review — `bin/rgod.js`, `src/cli.js`, `src/living.js`, `.github/workflows/living-review.yml`

- `rgod <command>`; config from `./config.json` (else defaults from `config.example.json`); database at `config.db`.
  Commands: `init`, `project add`, `question add`, `questions import <csv>` (columns id, project, text, include,
  exclude; `;`-separated criteria), `option add`, `search`, `import`, `screen`, `review export|import`, `fetch`,
  `queue`, `ingest`, `extract`, `map`, `brief check`, `export xlsx`, `export-jsonl`, `import-jsonl`, `living`,
  `usage`. A decision-project question gets a "Do nothing new" option automatically.
- `living.js`: `runLiving(db, { config, llm, fetch, sources }) → markdown digest`: re-runs each distinct API search
  (source + query) from the year of its last run, logs it as a new search, upserts, screens new works, and lists new
  includes and maybes per question. Writes `digests/<date>.md`.
- Workflow: weekly cron and manual dispatch; Node 22; `npm ci`; `rgod import-jsonl data`; `rgod living`;
  `rgod export-jsonl data`; commit and push `data/` and `digests/` if changed; `MISTRAL_API_KEY` from secrets.
