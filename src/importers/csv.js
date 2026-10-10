// CSV: RFC 4180 reader plus a header-matched importer (title, authors, year, venue, abstract, doi, url, ...).
import { makeWork } from '../work.js';

// Rows of fields. Quoted fields may hold commas, doubled quotes and line breaks; blank lines are dropped.
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (s[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// Header names are matched after this normalization, so "Publication_Year" and "publication year" are the same.
const norm = (h) => String(h).toLowerCase().replace(/[()]/g, ' ').replace(/[_\-/]+/g, ' ').replace(/\s+/g, ' ').trim();

const COLUMNS = {
  title: ['title', 'article title', 'document title', 'ti'],
  authors: ['authors', 'author', 'author names', 'author full names', 'au'],
  year: ['year', 'publication year', 'pub year', 'published year', 'publication date', 'py'],
  venue: ['venue', 'journal', 'source', 'source title', 'journal name', 'publication title', 'journal book title', 'container title'],
  abstract: ['abstract', 'ab', 'summary', 'abstract note'],
  doi: ['doi', 'digital object identifier'],
  url: ['url', 'link', 'source url', 'full text url'],
  language: ['language', 'la'],
  type: ['type', 'document type', 'publication type', 'item type'],
};
for (const names of Object.values(COLUMNS)) names.splice(0, names.length, ...names.map(norm));

export function parse(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map(norm);
  const col = {};
  for (const [key, names] of Object.entries(COLUMNS)) col[key] = header.findIndex((h) => names.includes(h));
  if (col.title < 0) throw new Error('CSV has no title column');
  const get = (r, key) => (col[key] >= 0 ? (r[col[key]] ?? '').trim() : '') || null;
  return rows.slice(1).map((r) => {
    const title = get(r, 'title');
    if (!title) return null;
    return makeWork({
      title,
      doi: get(r, 'doi'),
      year: get(r, 'year')?.match(/\d{4}/)?.[0],
      authors: get(r, 'authors')?.split(';').map((a) => a.trim()).filter(Boolean) ?? [],
      venue: get(r, 'venue'),
      abstract: get(r, 'abstract'),
      language: get(r, 'language'),
      type: get(r, 'type'),
      url: get(r, 'url'),
    });
  }).filter(Boolean);
}
