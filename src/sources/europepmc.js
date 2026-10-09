// Europe PMC: REST search with cursorMark paging. Abstracts and keywords come from the core result type.
import { makeWork } from '../work.js';
import { plainText } from './crossref.js';

const BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

const headersFor = (email) => (email ? { 'user-agent': `researchgod/0.1 (mailto:${email})` } : {});

async function getJson(url, fetch, email) {
  const res = await fetch(url, { headers: headersFor(email) });
  if (!res.ok) throw new Error(`Europe PMC HTTP ${res.status}`);
  return res.json();
}

function toWork(r) {
  const title = plainText(r.title);
  if (!title) return null;
  const authors = r.authorList?.author?.length
    ? r.authorList.author.map((a) => (a.firstName ? `${a.firstName} ${a.lastName}` : a.fullName))
    : String(r.authorString ?? '').split(/,\s*/).map((s) => s.replace(/\.$/, ''));
  const pdf = (r.fullTextUrlList?.fullTextUrl || [])
    .find((u) => u.documentStyle === 'pdf' && /open access|free/i.test(u.availability ?? ''));
  return makeWork({
    title,
    doi: r.doi,
    year: r.pubYear,
    authors,
    venue: r.journalInfo?.journal?.title,
    abstract: plainText(r.abstractText),
    language: r.language,
    type: [r.pubTypeList?.pubType ?? []].flat()[0],
    url: r.source && r.id ? `https://europepmc.org/article/${r.source}/${r.id}` : null,
    oaUrl: pdf?.url,
    citedBy: r.citedByCount,
    fields: r.keywordList?.keyword ?? [],
    ids: { pmid: r.pmid, pmcid: r.pmcid },
  });
}

export async function search(query, { from, until, limit = 100, fetch, email } = {}) {
  const f = fetch ?? globalThis.fetch;
  const q = from || until ? `(${query}) AND PUB_YEAR:[${from ?? 1000} TO ${until ?? 3000}]` : query;
  const buildUrl = (cursorMark, pageSize) =>
    `${BASE}?${new URLSearchParams({ query: q, format: 'json', resultType: 'core', pageSize: String(pageSize), cursorMark })}`;
  const works = [];
  let cursor = '*';
  let total = null;
  const url = buildUrl(cursor, Math.min(100, limit || 1));
  while (works.length < limit) {
    const j = await getJson(buildUrl(cursor, Math.min(100, limit - works.length)), f, email);
    total ??= j.hitCount ?? null;
    const list = j.resultList?.result || [];
    for (const r of list) {
      if (works.length >= limit) break;
      const w = toWork(r);
      if (w) works.push(w);
    }
    const next = j.nextCursorMark;
    if (!next || next === cursor || !list.length) break;
    cursor = next;
  }
  return { works, total, url };
}
