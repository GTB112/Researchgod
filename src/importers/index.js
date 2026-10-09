// Importer dispatch: picks the parser from the file extension. A .txt file is sniffed: RIS if it has a TY tag, else BibTeX.
import * as ris from './ris.js';
import * as bibtex from './bibtex.js';
import * as csv from './csv.js';

export function parseFile(name, text) {
  const n = String(name).toLowerCase();
  if (n.endsWith('.ris')) return ris.parse(text);
  if (n.endsWith('.bib')) return bibtex.parse(text);
  if (n.endsWith('.csv')) return csv.parse(text);
  if (n.endsWith('.txt')) {
    if (/^﻿?TY {2}-/m.test(text)) return ris.parse(text);
    if (/@[A-Za-z]+\s*[{(]/.test(text)) return bibtex.parse(text);
  }
  throw new Error(`unsupported import file: ${name}`);
}
