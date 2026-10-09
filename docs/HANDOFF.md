# Handoff (9 Oct 2026): from the cloud session to a local one

Read `AGENTS.md`, then this file, then `docs/PLAN.md` and `docs/SPEC.md` as needed. This file holds what exists only in
the conversation that built the first version.

## The owner's settings

- **Claude Pro, not Max: be frugal.** Bulk model work goes to Mistral's free API tier (switch training off in Mistral's
  settings). Use Claude (`claude -p`, default model haiku) only for hard cases. Prefer working locally over cloud
  sessions.
- **Machines:** the owner's laptop for development. A spare **M1 Air** (little memory: no local language models) for
  downloads with the owner's Boston College login, PDF text, and local-only interview work.
- **Downloads:** the owner wanted up to one a minute and 300 a day. Agreed defaults are one a minute, about 25 per
  publisher site and 75 a day for licensed sites, higher for open-access copies, a stop at any person-check page, and
  no disguising the downloader (config `fetch`). The owner may raise the caps; explain the risk to BC's access once.
- **Consensus Pro** (through BC): Deep Searches as seed lists for outcome evidence; exports (BibTeX/RIS) come in
  through `src/importers`. The connector gives 500 searches a month. Don't script its website.
- **Perplexity Pro** is being cancelled; nothing depends on it. **Gemini** is a possible tie-breaker only.
- **Sharing:** SQLite first; later a formatted workbook that opens in Google Sheets ("clean, not exhaustive").

## What is built (tested: `npm test`)

| Area | Files | Status |
|---|---|---|
| Schema, helpers | `src/schema.sql`, `src/db.js`, `src/work.js`, `src/verbatim.js` | Done |
| Model calls | `src/llm.js` (mistral, claude-cli, mock; spacing, retries, usage rows, call budget) | Done |
| Screening, extraction | `src/screen.js`, `src/extract.js`, `prompts/` | Done |
| Store | `src/dedupe.js` (upsertWork, logSearch), `src/store.js` (JSONL export/import) | Done |
| Outputs | `src/review.js` (CSV round trip, kappa), `src/fieldmap.js`, `src/brief.js` (trace check) | Done |
| Full text | `src/fetch.js` (paced downloads, BC link queue), `src/ingest.js` (PDF text, inbox matching) | Done |
| Sources, importers | `src/sources/*`, `src/importers/*` | See git log: committed if finished in the cloud session |

Choices the builders made where the spec was silent:

- `llm.json()` returns `{ data, usage: { inputTokens, outputTokens } }`; the llm object also has `provider`, `model`,
  `by`. `screenQuestion` also returns `failed`; a work whose call errors stays unscreened. `latestDecision` returns the
  screenings row. Abstract quotes are checked against title + abstract. Full text sent to a model is capped at 150,000
  characters.
- Review samples give each model decision an equal share, so excluded papers are always checked. Kappa is null when
  chance agreement is 1. `importReview` returns `{ imported, skipped, include, exclude, maybe, agreement }`.
- Field map: a work with no extraction for a field counts as "not reported"; candidate gaps ignore that bucket.
- Brief check: sentences are not split inside quotations; **each table row counts as a sentence and needs a marker**.
- "Included" for fetching means the latest decision per work and question (a person's ahead of the model's) is include
  on any question. Unpaywall lookups are paced with downloads but not logged as downloads. Inbox title matching uses
  whole words and refuses ties.

## Known gaps

1. **Re-running extraction appends rows.** Before `extractWork` runs again for a work and question, delete that pair's
   earlier model rows (keep rows a person verified).
2. If the sources and importers commit is missing, rebuild them from `docs/SPEC.md` ("Sources", "Importers").

## What is left (in order)

1. **CLI** (`bin/rgod.js`, `src/cli.js`): the commands in SPEC "CLI and living review", reading `./config.json` or
   `config.example.json`. Include the extraction fix above and `rgod usage` (calls and tokens by provider and purpose).
2. **Workbook export** (`src/export/xlsx.js`, exceljs): SPEC "Outputs".
3. **Living review** (`src/living.js`, `.github/workflows/living-review.yml`), with `MISTRAL_API_KEY` as a repo secret.
4. **README usage section** and an end-to-end test with a mock model and fixtures.
5. **First real run:** one Wings question, OpenAlex plus one BC library export, screening a small batch on Mistral,
   checking a review sample of about 100.

## Open items with the owner

- The questions sheet (Google Drive link).
- For Wings: one site, its priority need, the programs being considered; whether interviews exist and what the consent
  forms allow about third-party tools.
- An email to BC's librarian about publisher text-mining access, a Scopus API key, and EBSCO's search API.

## Starting on the laptop

```bash
git clone https://github.com/GTB112/researchgod && cd researchgod
git checkout claude/charming-ramanujan-3jroa1   # until PR #1 is merged
npm install && npm test                         # Node 22.13 or newer
```

Then ask the local agent: "Read AGENTS.md and docs/HANDOFF.md, then build 'What is left' item 1."
