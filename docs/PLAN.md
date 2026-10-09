# Plan (drafted 9 Oct 2026)

## The goal

Program recommendations for particular sites in Indonesia that can be defended, not a verdict on whether
"mentorship works". The question for each site: given this community need, the relationships already there, and what
the organisation can deliver, which program should the site run, adapt, pilot, or avoid?

The fields: organisational behaviour, psychology, neuroscience, social studies, social work, civil society.

## What the tool produces

**site need → candidate programs (always including "no new program") → a dossier for each → a decision brief**

A dossier holds four kinds of evidence, each row quoted from its source with a page:

| Kind | Question it answers |
|---|---|
| Outcome | Does a similar program improve the outcome we care about? |
| Mechanism | Why might it? (a hypothesis, labelled as one) |
| Implementation | What do staffing, training, supervision, safeguarding and cost require? |
| Local fit | Indonesian evidence and site findings: is the barrier present, do people want this? |

A decision brief (one page per site and need):

- **Recommendation:** pilot [program] with [group], delivered by [partner], for [duration].
- **Why here:** site finding + closest outside evidence + Indonesian or comparable implementation evidence.
- **Required adaptations**, each justified by site evidence.
- **Main uncertainty:** what the evidence does not establish.
- **Decision gate:** continue, revise or stop after checking [participation, continuity, feedback, outcome].
- **Alternative rejected**, and why.

## Workflows

| # | Workflow | Who decides | The agent's job | Automatic check |
|---|---|---|---|---|
| 1 | Decision frame: needs and candidate programs per site | Owner | Drafts options and alternatives | Every need has a "no new program" option |
| 2 | Searches by field; free databases automated, library databases by export; an Indonesian lane | Owner approves strings | Synonyms per field, Indonesian terms; import and deduplicate | Every search logged |
| 3 | Match screening: closeness to program model, population, setting | Owner confirms | Sorts abstracts, flags close matches in lower- and middle-income countries | A sample of exclusions goes to the owner |
| 4 | Study extraction with a fixed template | Owner verifies | Fills study rows | Every field quoted or "not reported"; quotes found word for word |
| 5 | Transfer argument per program | Owner writes | Asks what differs between study setting and site; what must be adapted | Every claim labelled by kind |
| 6 | Site evidence from interviews | People score independently on a pilot set | Pulls cited passages, flags gaps and disagreements | Only where consent and data rules allow |
| 7 | Decision brief | Owner | Drafts and traces each sentence | Fails if a sentence lacks a source |
| 8 | Living review, weekly | Owner reviews | New evidence screened; affected dossiers flagged | Gmail digest names affected briefs |

## Sources

- **Free, automated:** OpenAlex (backbone, citations both ways), Crossref, Semantic Scholar, PubMed and Europe PMC,
  ERIC, Unpaywall (open-access copies).
- **Development evaluations:** 3ie Development Evidence Portal, J-PAL (Southeast Asia office in Jakarta), World Bank
  Open Knowledge Repository, Campbell Collaboration evidence maps.
- **Indonesian:** Garuda, SINTA, Neliti, SMERU. Terms such as *pendampingan*, *pembinaan*, *bimbingan*,
  *kakak asuh*, *pemberdayaan masyarakat*, *program CSR*. Leads to check: PKH facilitators, Kartu Prakerja.
- **Library databases by export** (owner runs the saved search, exports, the tool imports): PsycINFO, Business
  Source, Sociological Abstracts, Social Services Abstracts, Web of Science, Scopus.
- **Consensus Pro:** a few Deep Searches as seed lists for outcome evidence; its search through the connector
  (500 calls a month). Not used for implementation or local fit.
- **Seeds to verify first:** the reviews named in the planning conversation (for example the 2019 youth-mentoring
  meta-analysis, Allen et al. on workplace mentoring, the DuBois reviews), each confirmed against OpenAlex.

## Where things run

| Where | What |
|---|---|
| This repo (private) | Code, questions, protocols, data as JSONL (git history is the audit trail) |
| Cloud, scheduled | Searches, abstract screening (Mistral free API tier, training off), weekly review, digest, Sheet upload |
| M1 Air | BC-login downloads, PDF text, on-device OCR for scans, full-text extraction with Claude Code, local-only interview work |

Models: Mistral (free API tier) for bulk abstract screening; Claude (Max) for judgment, extraction and drafting;
Gemini as tie-breaker if its quota holds. No single model chooses a program.

## Data and ethics

- Interviews and field notes stay in an encrypted local folder until consent terms, the organisation's data rules and
  Indonesia's personal data protection law (Law 27 of 2022) have been checked. Only approved, de-identified excerpts
  are committed.
- Licensed full text goes only to services with training switched off, and never into git.
- Downloads follow AGENTS.md rule 9. The sanctioned bulk route is publisher text-mining access through BC's library.

## Build order

1. Data model and the trace check (rules 1 and 7 of the briefs, as a script with tests).
2. Workflow 1: the decision frame for one site and need.
3. Workflow 2: OpenAlex, Crossref, PubMed and ERIC searches with the search log; library-export import; duplicates.
4. Workflow 3: match screening with the owner's sample check.
5. Workflow 4: extraction template and quote check.
6. Review one real dossier with the owner before scaling to more sites.

## Open items

- The questions sheet, or one site, its priority need, and the programs being considered.
- Whether interviews exist yet, and what the consent forms say about third-party tools.
- The email to BC's librarian about text-mining access and Scopus.
