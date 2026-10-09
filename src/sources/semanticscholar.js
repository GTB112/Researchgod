// Semantic Scholar: Graph API paper search (offset paging). An API key is optional and sent as x-api-key.
import { makeWork } from '../work.js';

const BASE = 'https://api.semanticscholar.org/graph/v1/paper/search';
const FIELDS = 'title,abstract,year,authors,externalIds,openAccessPdf,venue,publicationTypes,fieldsOfStudy,citationCount,url';

function toWork(p) {
  if (!p.title) return null;
  const ext = p.externalIds || {};
  return makeWork({
    title: p.title,
    doi: ext.DOI,
    year: p.year,
    authors: (p.authors || []).map((a) => a.name),
    venue: p.venue,
    abstract: p.abstract,
    type: (p.publicationTypes || [])[0],
    url: p.url ?? `https://www.semanticscholar.org/paper/${p.paperId}`,
    oaUrl: p.openAccessPdf?.url,
    citedBy: p.citationCount,
    fields: p.fieldsOfStudy || [],
    ids: {
      s2: p.paperId,
      pmid: ext.PubMed,
      pmcid: ext.PubMedCentral ? `PMC${ext.PubMedCentral}` : null,
    },
  });
}

async function getJson(url, fetch, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Semantic Scholar HTTP ${res.status}`);
  return res.json();
}

export async function search(query, { from, until, limit = 100, fetch, email, apiKey } = {}) {
  const f = fetch ?? globalThis.fetch;
  const headers = {
    ...(email ? { 'user-agent': `researchgod/0.1 (mailto:${email})` } : {}),
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  };
  const year = from || until ? `${from ?? ''}-${until ?? ''}` : null;
  const buildUrl = (offset, n) =>
    `${BASE}?${new URLSearchParams({ query, offset: String(offset), limit: String(n), fields: FIELDS, ...(year ? { year } : {}) })}`;
  const works = [];
  let offset = 0;
  let total = null;
  const url = buildUrl(offset, Math.min(100, limit || 1));
  while (works.length < limit) {
    const j = await getJson(buildUrl(offset, Math.min(100, limit - works.length)), f, headers);
    total ??= j.total ?? null;
    const data = j.data || [];
    for (const p of data) {
      if (works.length >= limit) break;
      const w = toWork(p);
      if (w) works.push(w);
    }
    if (!j.next || !data.length) break;
    offset = j.next;
  }
  return { works, total, url };
}
