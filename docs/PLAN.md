# Plan (rewritten 9 Oct 2026)

## What researchgod is

A general research tool for questions across **social studies, psychology, neuroscience, business and organisational
behaviour, social work and civil society**. It searches broadly, screens what it finds, extracts each study's details
quoted from the source, keeps everything in SQLite, publishes a clean spreadsheet when you want to share, and re-runs
searches weekly.

It produces two kinds of output from the same evidence:

- **A field map:** what has been studied, by whom, with what methods, and where the gaps are (each gap confirmed by a
  broad search before it is called one).
- **A decision brief:** a recommendation that can be defended, every sentence traced to a study or an interview excerpt.

Work is organised in **projects**. Each project has questions; a decision project also has candidate options for each
question (always including "do nothing new").

## Sources

1. **Boston College's library** (the main route into the paid literature):
   - *Library databases* (for example PsycINFO, Business Source, Sociological Abstracts, Social Services Abstracts,
     Web of Science, Scopus; BC's exact list to be confirmed). The owner runs the saved search in BC's portal and
     exports RIS, BibTeX or CSV; the tool imports it, removes duplicates and logs the search.
   - *Full text* through the owner's BC login on the M1 Air: free copies first, then BC proxy links, paced and capped.
   - *Consensus Pro* through the BC account: Deep Searches as seed lists, results exported as BibTeX or RIS.
   - *A librarian email* asking about publisher text-mining access, a Scopus API key, and EBSCO's search API, any of
     which would let the tool run library searches itself.
2. **Free databases, searched automatically:** OpenAlex (backbone; citations both ways), Crossref, Semantic Scholar,
   PubMed and Europe PMC, ERIC, Unpaywall for open-access copies.
3. **Program evaluations:** 3ie Development Evidence Portal, J-PAL, World Bank, Campbell Collaboration evidence maps
   (imported by export where there is no API).
4. **Lanes a project adds for its setting.** A project applied somewhere specific adds that place's sources and
   vocabulary. The Wings project adds an Indonesian lane (below).

## Workflows

| # | Workflow | Who decides | The tool's job | Automatic check |
|---|---|---|---|---|
| 1 | Questions and criteria (and, for decision projects, the options) | Owner | Imports the questions sheet | A decision question always has "do nothing new" |
| 2 | Searches: free databases by API, library databases by export | Owner approves strings | Runs, imports, deduplicates | Every search logged with source, date, string, count |
| 3 | Screening of titles and abstracts | Owner checks a sample | Model sorts include, exclude or maybe, with a quote | A decision whose quote is not in the abstract becomes "maybe" |
| 4 | Full text | Owner | Fetches free copies, queues BC links, reads PDFs dropped in the inbox | Paced and capped; stops at any person-check page |
| 5 | Extraction with a fixed template | Owner verifies | Fills each field with a quote and page, or "not reported" | Every quote found word for word in its source |
| 6 | Field map | Owner | Counts by year, field, design, setting; a gaps grid | Gaps marked "candidate" until a broad search confirms them |
| 7 | Decision brief | Owner writes | Traces every sentence | Fails if a sentence has no source, or a quote is not in it |
| 8 | Living review, weekly | Owner reviews | Re-runs searches since the last run, screens new papers, writes a digest | Digest names the questions affected |
| 9 | Sharing | Owner | A formatted workbook (opens in Google Sheets) | Only person-confirmed papers in "Key papers" |

## Models and spending

The owner is on Claude **Pro**, so Claude use is kept small.

- **Mistral's free API tier** does the bulk work: screening (Mistral Small) and extraction (Mistral Medium). Training is
  switched off in Mistral's settings. The free tier is rate-limited, so calls are spaced about a second apart.
- **Claude** (`claude -p`, the owner's subscription) is optional, for hard cases only.
- Every model call is logged with its tokens (`rgod usage`), and each run stops at a call budget set in the config.
- No model supplies a citation, chooses a program, or sets an official score.

## Where things run

| Where | What |
|---|---|
| This repo (private) | Code, the questions, and the data as JSONL files (git history is the audit trail) |
| GitHub Actions, weekly | The living review: rebuild the database from JSONL, re-run searches, screen, write a digest, commit |
| M1 Air | BC-login downloads, PDF text, extraction from full text, local-only interview work |

PDFs, full paper text and raw interviews never go into git.

## Projects

### Wings mentorship (first project, decision type)

Program recommendations for particular Wings sites in Indonesia. Indonesia is where the findings are applied, not a
limit on where evidence comes from: most evidence will be international (youth and workplace mentoring, psychology and
neuroscience on mechanisms, evaluations from other lower- and middle-income countries).

What this project adds:

- **Evidence by kind:** outcome, mechanism, implementation, local fit. Neuroscience supports mechanism claims only.
- **An Indonesian lane:** Garuda, SINTA, Neliti, SMERU; terms such as *pendampingan*, *pembinaan*, *bimbingan*,
  *kakak asuh*, *pemberdayaan masyarakat*, *program CSR*; leads to check such as PKH facilitators and Kartu Prakerja.
  Indonesian quotes are kept in the original, with a labelled translation.
- **Site evidence** from interviews: people score independently on a pilot set; the tool pulls passages and flags gaps.
  Interviews stay in an encrypted local folder until consent terms, Wings' data rules and Indonesia's personal data
  protection law (Law 27 of 2022) have been checked; only approved, de-identified excerpts enter the database.
- **The decision brief** (one page per site and need): recommendation; why here; required adaptations; main
  uncertainty; decision gate; alternative rejected.

### Field survey (second project, field-map type)

The original survey across social studies, neuroscience and organisational behaviour, run from the owner's questions
sheet.

## Open items

- The questions sheet.
- For Wings: one site, its priority need, the programs being considered; whether interviews exist and what the consent
  forms allow.
- The librarian email.
