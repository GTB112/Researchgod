# researchgod: agent entry point

researchgod turns research evidence into program decisions that can be defended: for each site and priority need,
a short decision brief whose every sentence traces to a study or an interview excerpt. It is not a meta-analysis tool
and does not rank papers. The plan is [docs/PLAN.md](docs/PLAN.md).

## Rules the code must keep

1. **Verbatim or nothing.** A study row's fields carry a quote from the source with its page, or say "not reported".
   Nothing is inferred. A quote is checked word for word against the source text. A non-English source keeps its
   original quote, which is the one checked, with a labelled translation beside it.
2. **The model never supplies a citation.** References come from database records (OpenAlex, Crossref, PubMed, ERIC,
   imports from library databases), never from model output.
3. **Every claim says what kind it is**: outcome, mechanism, implementation, or local fit. Mechanism evidence (for
   example neuroscience of social support) is never presented as evidence that a program works.
4. **People decide.** The agent drafts options, rows and arguments, and flags disagreements. Official interview scores,
   inclusion decisions and recommendations are recorded as a person's decision.
5. **No single evidence score.** Rows are described (design, sample, setting, bias concerns), never collapsed into
   one number.
6. **Every search is logged**: source, date, full search string, result count.
7. **Interviews and field notes never enter the repository or a cloud model** unless the participants' consent and the
   organisation's data rules allow it. Only de-identified excerpts the owner approves are committed.
8. **No PDFs or full paper text in git.** Only extracted fields and short quotes.
9. **Downloads are paced and capped** (one a minute at most; open-access sources first; a daily cap per publisher;
   stop at any person-check or warning page). Never disguise the downloader.

## Verify what you changed

Run the checks (`npm test` once it exists). The trace check must pass: every sentence of a decision brief cites a
study row or an interview excerpt, and every quote is found in its source. Say what you verified and what you did not.

## Working style

Plan first only when the scope is unclear or the change spans several files; make small, clear fixes directly.
Plain Node, no framework or bundler. Keep the docs true: if a rule changes, change it here.
