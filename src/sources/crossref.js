// Crossref: works search with cursor paging. JATS abstracts are reduced to plain text.
import { makeWork } from '../work.js';

const BASE = 'https://api.crossref.org/works';
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Entities to characters, named and numeric. Shared by the sources whose text carries markup.
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return ENT[e.toLowerCase()] ?? m;
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

// Any markup to plain text: block tags become spaces, other tags vanish, entities decoded, whitespace collapsed.
export function plainText(s) {
  const noBlocks = String(s ?? '')
    .replace(/<\/?(p|div|br|h[1-6]|li|ul|ol|sec|title|table|tr|td|th)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(noBlocks).replace(/\s+/g, ' ').trim() || null;
}

// JATS XML to plain text. Inline emphasis vanishes (so "E<i>coli</i>" stays one word), block tags become spaces,
// and <jats:title> headings such as "Abstract" are dropped.
export function stripJats(xml) {
  const s = String(xml ?? '')
    .replace(/<jats:title\b[^>]*>[\s\S]*?<\/jats:title>/gi, ' ')
    .replace(/<\/?jats:(italic|bold|sup|sub|sc|i|b|em|strong|underline)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(s).replace(/\s+/g, ' ').trim() || null;
}

const headersFor = (email) => (email ? { 'user-agent': `researchgod/0.1 (mailto:${email})` } : {});

async function getJson(url, fetch, email) {
  const res = await fetch(url, { headers: headersFor(email) });
  if (!res.ok) throw new Error(`Crossref HTTP ${res.status}`);
  return res.json();
}

function toWork(it) {
  const title = plainText(Array.isArray(it.title) ? it.title[0] : it.title);
  if (!title) return null;
  const year = [it.issued, it['published-print'], it['published-online'], it.published]
    .map((d) => d?.['date-parts']?.[0]?.[0])
    .find(Boolean);
  return makeWork({
    title,
    doi: it.DOI,
    year,
    authors: (it.author || []).map((a) => a.name ?? ([a.given, a.family].filter(Boolean).join(' ') || null)),
    venue: plainText(it['container-title']?.[0]),
    abstract: stripJats(it.abstract),
    language: it.language,
    type: it.type,
    url: it.URL,
    citedBy: it['is-referenced-by-count'],
    fields: it.subject || [],
  });
}

export async function search(query, { from, until, limit = 100, fetch, email } = {}) {
  const f = fetch ?? globalThis.fetch;
  const filter = [from && `from-pub-date:${from}`, until && `until-pub-date:${until}`].filter(Boolean).join(',');
  const buildUrl = (cursor, rows) => {
    const p = new URLSearchParams({ query, rows: String(rows), cursor });
    if (filter) p.set('filter', filter);
    if (email) p.set('mailto', email);
    return `${BASE}?${p}`;
  };
  const works = [];
  let cursor = '*';
  let total = null;
  const url = buildUrl(cursor, Math.min(100, limit || 1));
  while (works.length < limit) {
    const msg = (await getJson(buildUrl(cursor, Math.min(100, limit - works.length)), f, email)).message ?? {};
    total ??= msg['total-results'] ?? null;
    const items = msg.items || [];
    for (const it of items) {
      if (works.length >= limit) break;
      const w = toWork(it);
      if (w) works.push(w);
    }
    cursor = msg['next-cursor'];
    if (!cursor || !items.length) break;
  }
  return { works, total, url };
}
