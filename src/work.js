// work.js — the Work record every source and importer returns, and the normalizers deduplication relies on.
//
// Work: { title (required), doi, year, authors: ["Given Family"], venue, abstract, language, type, url, oaUrl,
//         citedBy, fields: [string], ids: { openalex, pmid, pmcid, eric, s2 } }

// "https://doi.org/10.1000/ABC" → "10.1000/abc"; anything without a 10.x prefix → null.
export function normDoi(doi) {
  const m = String(doi ?? "").trim().toLowerCase().match(/10\.\d{4,9}\/\S+/);
  return m ? m[0].replace(/[.,;)\]]+$/, "") : null;
}

// Lowercase, accents removed, punctuation dropped, spaces collapsed.
export function normTitle(title) {
  return String(title ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/<[^>]+>/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Family name of the first author, normalized ("Allen, Tammy D." and "Tammy D. Allen" → "allen").
export function firstSurname(authors) {
  const a = String((authors || [])[0] ?? "").trim();
  if (!a) return "";
  const family = a.includes(",") ? a.split(",")[0] : a.split(/\s+/).pop();
  return normTitle(family);
}

const str = (v) => (v == null || v === "" ? null : String(v).trim() || null);
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

// Clean a partial record into a Work. Throws when there is no title.
export function makeWork(p = {}) {
  const title = str(p.title)?.replace(/\s+/g, " ");
  if (!title) throw new Error("work has no title");
  const ids = {};
  for (const k of ["openalex", "pmid", "pmcid", "eric", "s2"]) if (str(p.ids?.[k])) ids[k] = str(p.ids[k]);
  return {
    title,
    doi: normDoi(p.doi),
    year: int(p.year),
    authors: (p.authors || []).map(str).filter(Boolean),
    venue: str(p.venue),
    abstract: str(p.abstract)?.replace(/\s+/g, " ") ?? null,
    language: str(p.language),
    type: str(p.type),
    url: str(p.url),
    oaUrl: str(p.oaUrl),
    citedBy: int(p.citedBy),
    fields: (p.fields || []).map(str).filter(Boolean),
    ids,
  };
}
