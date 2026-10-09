// OpenAlex: works search (cursor paging) and citation chasing. Abstracts are rebuilt from the inverted index.
import { makeWork } from '../work.js';

const BASE = 'https://api.openalex.org/works';

// "https://openalex.org/W123" → "W123"; trailing slashes ignored.
const tail = (s) => (s ? String(s).replace(/\/+$/, '').split('/').pop() : null);

// {word: [positions]} → sentence. Word order comes from the positions, not from key order.
export function rebuildAbstract(inv) {
  if (!inv || typeof inv !== 'object') return null;
  const words = [];
  for (const [word, positions] of Object.entries(inv)) for (const p of positions) words[p] = word;
  return Array.from(words, (w) => w ?? '').join(' ').replace(/\s+/g, ' ').trim() || null;
}

function toWork(w) {
  const title = w.display_name ?? w.title;
  if (!title) return null;
  const topics = w.topics?.length ? w.topics : w.concepts || [];
  return makeWork({
    title,
    doi: w.doi,
    year: w.publication_year,
    authors: (w.authorships || []).map((a) => a.author?.display_name),
    venue: w.primary_location?.source?.display_name,
    abstract: rebuildAbstract(w.abstract_inverted_index),
    language: w.language,
    type: w.type,
    url: w.doi ?? w.id,
    oaUrl: w.best_oa_location?.pdf_url,
    citedBy: w.cited_by_count,
    fields: topics.map((t) => t.display_name),
    ids: {
      openalex: tail(w.id),
      pmid: tail(w.ids?.pmid),
      pmcid: String(w.ids?.pmcid ?? '').match(/PMC\d+/i)?.[0] ?? null,
    },
  });
}

const headersFor = (email) => (email ? { 'user-agent': `researchgod/0.1 (mailto:${email})` } : {});

async function getJson(url, fetch, email) {
  const res = await fetch(url, { headers: headersFor(email) });
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Pages a works listing (search or filter) with cursor paging until `limit` works are collected.
async function collect({ params, limit, fetch, email }) {
  const buildUrl = (cursor, perPage) => {
    const p = new URLSearchParams({ ...params, 'per-page': String(perPage), cursor });
    if (email) p.set('mailto', email);
    return `${BASE}?${p}`;
  };
  const works = [];
  let cursor = '*';
  let total = null;
  const url = buildUrl(cursor, Math.min(200, limit || 1));
  while (works.length < limit) {
    const page = await getJson(buildUrl(cursor, Math.min(200, limit - works.length)), fetch, email);
    total ??= page.meta?.count ?? null;
    const results = page.results || [];
    for (const r of results) {
      if (works.length >= limit) break;
      const w = toWork(r);
      if (w) works.push(w);
    }
    cursor = page.meta?.next_cursor;
    if (!cursor || !results.length) break;
  }
  return { works, total, url };
}

// Year bounds as an OpenAlex publication_year filter.
function yearFilter(from, until) {
  if (from && until) return `publication_year:${from}-${until}`;
  if (from) return `publication_year:>${Number(from) - 1}`;
  if (until) return `publication_year:<${Number(until) + 1}`;
  return null;
}

export async function search(query, { from, until, limit = 100, fetch, email } = {}) {
  const f = fetch ?? globalThis.fetch;
  const params = { search: query };
  const filter = yearFilter(from, until);
  if (filter) params.filter = filter;
  return collect({ params, limit, fetch: f, email });
}

// Citation chasing. 'cited_by' lists works citing the given one; 'references' lists works it cites.
export async function citations(openalexId, { direction = 'cited_by', limit = 100, fetch, email } = {}) {
  const f = fetch ?? globalThis.fetch;
  const id = tail(openalexId);
  if (direction === 'cited_by') {
    const { works } = await collect({ params: { filter: `cites:${id}` }, limit, fetch: f, email });
    return { works };
  }
  if (direction === 'references') {
    const source = await getJson(`${BASE}/${id}`, f, email);
    const refs = (source.referenced_works || []).slice(0, limit).map(tail);
    const works = [];
    for (let i = 0; i < refs.length; i += 50) {
      const chunk = refs.slice(i, i + 50);
      const page = await collect({ params: { filter: `openalex:${chunk.join('|')}` }, limit: chunk.length, fetch: f, email });
      works.push(...page.works);
    }
    return { works };
  }
  throw new Error(`unknown citation direction: ${direction}`);
}
