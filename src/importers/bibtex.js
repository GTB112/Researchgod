// BibTeX: entries with brace and quoted values, @string macros, "and"-separated authors and LaTeX accents → Work[].
import { makeWork } from '../work.js';

const SPECIAL = { ss: 'ß', oe: 'œ', OE: 'Œ', ae: 'æ', AE: 'Æ', aa: 'å', AA: 'Å', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł' };
const ACCENT = { '"': '̈', "'": '́', '`': '̀', '^': '̂', '~': '̃', '=': '̄', '.': '̇' };
const LETTER_ACCENT = { v: '̌', u: '̆', H: '̋', c: '̧' };
const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

// Index of the brace (or paren) that closes the one at `open`; -1 when unbalanced. Escaped characters are skipped.
function matchClose(s, open) {
  const o = s[open];
  const c = o === '{' ? '}' : ')';
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === o) depth++;
    else if (ch === c && --depth === 0) return i;
  }
  return -1;
}

// Splits at `sep` (a sticky regex) only where brace depth is zero, so "{European Union}" and "{A, B}" stay whole.
function splitTop(s, sep) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 0) {
      sep.lastIndex = i;
      const m = sep.exec(s);
      if (m) {
        parts.push(s.slice(start, i));
        i += m[0].length - 1;
        start = i + 1;
      }
    }
  }
  parts.push(s.slice(start));
  return parts;
}

// LaTeX to Unicode for the cases bibliographies use. Accents run before braces are dropped, so "{\"o}" and "\"{o}" both work.
export function cleanLatex(s) {
  let t = String(s ?? '');
  t = t.replace(/\\i(?![A-Za-z])/g, 'i');
  t = t.replace(/\\(ss|oe|OE|ae|AE|aa|AA|o|O|l|L)(?![A-Za-z])(\{\})?/g, (_, k) => SPECIAL[k]);
  t = t.replace(/\\(["'`^~=.])\{?([A-Za-z])\}?/g, (_, k, ch) => ch + ACCENT[k]);
  t = t.replace(/\\([vuHc])\{([A-Za-z])\}/g, (_, k, ch) => ch + LETTER_ACCENT[k]);
  t = t.replace(/\\([&%$#_])/g, '$1').replace(/~/g, ' ');
  t = t.replace(/\\[A-Za-z]+\s*/g, '').replace(/[{}]/g, '');
  return t.normalize('NFC').replace(/\s+/g, ' ').trim();
}

// "Family, Given" → "Given Family"; "Given Family" is kept; a fully braced name is an organisation and kept whole.
function personName(raw) {
  const s = raw.trim();
  if (!s || /^others$/i.test(s)) return null;
  if (s.startsWith('{') && matchClose(s, 0) === s.length - 1) return cleanLatex(s);
  const parts = splitTop(s, /,/y).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return cleanLatex(parts[0] ?? s);
  const family = parts[0];
  const given = parts.slice(1).find((p) => !SUFFIX.test(p));
  return cleanLatex(given ? `${given} ${family}` : family);
}

// Reads `name = value` pairs from an entry body. Values keep inner braces; one outer layer is removed.
// Quoted values and `#` concatenation are supported; bare tokens are looked up in the @string macros.
function readFields(body, start, macros) {
  const out = [];
  const n = body.length;
  let i = start;
  const skipWs = (k) => {
    while (k < n && /\s/.test(body[k])) k++;
    return k;
  };
  for (;;) {
    while (i < n && /[\s,]/.test(body[i])) i++;
    const nameRe = /([A-Za-z][\w:.-]*)\s*=/y;
    nameRe.lastIndex = i;
    const nm = nameRe.exec(body);
    if (!nm) break;
    i = nameRe.lastIndex;
    let val = '';
    for (;;) {
      i = skipWs(i);
      const ch = body[i];
      if (ch === '{') {
        const e = matchClose(body, i);
        const end = e < 0 ? n : e;
        val += body.slice(i + 1, end);
        i = end + 1;
      } else if (ch === '"') {
        let j = i + 1;
        let depth = 0;
        for (; j < n; j++) {
          const c = body[j];
          if (c === '\\') j++;
          else if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '"' && depth === 0) break;
        }
        val += body.slice(i + 1, j);
        i = j + 1;
      } else {
        const tokRe = /[^\s,#{}"]+/y;
        tokRe.lastIndex = i;
        const tok = tokRe.exec(body);
        if (!tok) break;
        i = tokRe.lastIndex;
        val += macros.get(tok[0].toLowerCase()) ?? tok[0];
      }
      i = skipWs(i);
      if (body[i] !== '#') break;
      i++;
    }
    out.push([nm[1].toLowerCase(), val]);
  }
  return out;
}

// The citation key ends at the first top-level comma; fields start after it.
function citeKeyEnd(body) {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === ',' && depth === 0) return i + 1;
  }
  return body.length;
}

function toWork({ type, fields }) {
  const get = (k) => cleanLatex(fields.get(k) ?? '') || null;
  const title = get('title');
  if (!title) return null;
  const url = get('url');
  const kw = get('keywords');
  return makeWork({
    title,
    doi: get('doi') ?? (url?.includes('doi.org') ? url : null),
    year: (get('year') ?? get('date') ?? '').match(/\d{4}/)?.[0],
    authors: splitTop(fields.get('author') ?? '', /\s+and\s+/iy).map(personName).filter(Boolean),
    venue: get('journal') ?? get('journaltitle') ?? get('booktitle'),
    abstract: get('abstract'),
    language: get('langid') ?? get('language'),
    type,
    url,
    fields: kw ? kw.split(/[,;]/).map((k) => k.trim()).filter(Boolean) : [],
  });
}

export function parse(text) {
  const src = String(text).replace(/^﻿/, '');
  const macros = new Map();
  const entries = [];
  const entryRe = /@([A-Za-z]+)\s*([{(])/g;
  let m;
  while ((m = entryRe.exec(src))) {
    const type = m[1].toLowerCase();
    const open = m.index + m[0].length - 1;
    const close = matchClose(src, open);
    const end = close < 0 ? src.length : close;
    const body = src.slice(open + 1, end);
    entryRe.lastIndex = end + 1;
    if (type === 'comment' || type === 'preamble') continue;
    if (type === 'string') {
      for (const [k, v] of readFields(body, 0, macros)) macros.set(k, v);
      continue;
    }
    entries.push({ type, fields: new Map(readFields(body, citeKeyEnd(body), macros)) });
  }
  return entries.map(toWork).filter(Boolean);
}
