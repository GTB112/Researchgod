// ERIC: education literature search (offset paging). Subjects become fields; EJ/ED ids become ids.eric.
import { makeWork } from '../work.js';
import { plainText } from './crossref.js';

const BASE = 'https://api.ies.ed.gov/eric/';

const headersFor = (email) => (email ? { 'user-agent': `researchgod/0.1 (mailto:${email})` } : {});

async function getJson(url, fetch, email) {
  const res = await fetch(url, { headers: headersFor(email) });
  if (!res.ok) throw new Error(`ERIC HTTP ${res.status}`);
  return res.json();
}

// ERIC authors arrive as "Family, Given" in some records; the Work contract wants "Given Family".
const flipName = (n) => {
  const i = String(n).indexOf(',');
  return i < 0 ? String(n).trim() : `${n.slice(i + 1).trim()} ${n.slice(0, i).trim()}`;
};

function toWork(d) {
  const title = plainText(d.title);
  if (!title) return null;
  return makeWork({
    title,
    year: d.publicationdateyear,
    authors: [d.author ?? []].flat().map(flipName),
    venue: plainText(d.source),
    abstract: plainText(d.description),
    language: [d.language ?? []].flat()[0],
    type: [d.publicationtype ?? []].flat()[0],
    url: d.id ? `https://eric.ed.gov/?id=${d.id}` : null,
    fields: [d.subject ?? []].flat(),
    ids: { eric: d.id },
  });
}

export async function search(query, { from, until, limit = 100, fetch, email } = {}) {
  const f = fetch ?? globalThis.fetch;
  const q = from || until ? `${query} AND publicationdateyear:[${from ?? '*'} TO ${until ?? '*'}]` : query;
  const buildUrl = (start, rows) =>
    `${BASE}?${new URLSearchParams({ search: q, format: 'json', rows: String(rows), start: String(start) })}`;
  const works = [];
  let start = 0;
  let total = null;
  const url = buildUrl(start, Math.min(200, limit || 1));
  while (works.length < limit) {
    const r = (await getJson(buildUrl(start, Math.min(200, limit - works.length)), f, email)).response ?? {};
    total ??= r.numFound ?? null;
    const docs = r.docs || [];
    for (const d of docs) {
      if (works.length >= limit) break;
      const w = toWork(d);
      if (w) works.push(w);
    }
    start += docs.length;
    if (!docs.length || start >= (r.numFound ?? 0)) break;
  }
  return { works, total, url };
}
