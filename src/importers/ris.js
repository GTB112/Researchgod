// RIS: reference exports from EBSCO, ProQuest, Web of Science, Scopus and Consensus → Work[].
import { makeWork } from '../work.js';

// Tag lines are "XX  - value"; a line without that shape continues the previous value.
const TAG = /^([A-Z][A-Z0-9])  - ?(.*)$/;

// "Family, Given" → "Given Family"; a name without a comma is kept as written.
function flipName(s) {
  const i = s.indexOf(',');
  if (i < 0) return s.trim();
  const family = s.slice(0, i).trim();
  const given = s.slice(i + 1).split(',')[0].trim(); // drops suffixes such as ", Jr."
  return given ? `${given} ${family}` : family;
}

function toWork(r) {
  const first = (...keys) => {
    for (const k of keys) for (const v of r[k] ?? []) if (v) return v;
    return null;
  };
  const all = (...keys) => keys.flatMap((k) => r[k] ?? []).filter(Boolean);
  const urls = all('UR');
  const title = first('TI', 'T1');
  if (!title) return null;
  const year = first('PY', 'Y1', 'DA')?.match(/\d{4}/)?.[0];
  // The DOI may only appear inside a doi.org URL; makeWork normalizes whichever is found.
  const doi = first('DO') ?? urls.find((u) => /doi\.org\//i.test(u)) ?? null;
  return makeWork({
    title,
    doi,
    year,
    authors: all('AU', 'A1').map(flipName),
    venue: first('JO', 'JF', 'T2', 'JA', 'J2'),
    abstract: first('AB', 'N2'),
    language: first('LA'),
    type: first('TY'),
    url: urls.find((u) => !/doi\.org\//i.test(u)) ?? urls[0] ?? null,
    fields: all('KW'),
  });
}

export function parse(text) {
  const records = [];
  let cur = null;
  let last = null; // [tag, index] of the value that continuation lines extend
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const m = raw.match(TAG);
    if (m) {
      const [, tag, val] = m;
      if (tag === 'TY') {
        cur = {};
        records.push(cur);
      }
      if (!cur) continue;
      if (tag === 'ER') {
        cur = null;
        last = null;
        continue;
      }
      (cur[tag] ??= []).push(val.trim());
      last = [tag, cur[tag].length - 1];
    } else if (cur && last && raw.trim()) {
      cur[last[0]][last[1]] += ` ${raw.trim()}`;
    }
  }
  return records.map(toWork).filter(Boolean);
}
