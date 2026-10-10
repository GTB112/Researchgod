// Importers: RIS, BibTeX and CSV parsing, and extension-based dispatch. Fixtures live in test/fixtures/importers/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ris from '../src/importers/ris.js';
import * as bibtex from '../src/importers/bibtex.js';
import * as csv from '../src/importers/csv.js';
import { parseFile } from '../src/importers/index.js';

const fx = (name) => readFileSync(new URL(`./fixtures/importers/${name}`, import.meta.url), 'utf8');

test('RIS: multi-record file, continuation lines joined, DOI from UR, no-title record skipped', () => {
  const works = ris.parse(fx('sample.ris'));
  assert.equal(works.length, 2);
  const [a, b] = works;
  assert.equal(a.title, 'Adaptive tutoring systems and feedback quality');
  assert.deepEqual(a.authors, ['Mei Lin', 'Omar Haddad']);
  assert.equal(a.year, 2021);
  assert.equal(a.venue, 'Computers & Education');
  assert.equal(a.doi, '10.9999/rgod.fixture.ris1');
  assert.equal(a.abstract, 'Adaptive tutoring systems use machine learning to personalize feedback.');
  assert.deepEqual(a.fields, ['tutoring', 'feedback']);
  assert.equal(a.language, 'eng');
  assert.equal(a.type, 'JOUR');
  assert.equal(a.url, 'https://doi.org/10.9999/rgod.fixture.ris1');
  assert.equal(b.title, 'Feedback loops in online courses');
  assert.deepEqual(b.authors, ['Sam Ruiz']);
  assert.equal(b.year, 2019);
  assert.equal(b.venue, 'Journal of Learning Analytics');
  assert.equal(b.doi, '10.9999/rgod.fixture.ris2');
  assert.equal(b.url, 'https://example.org/articles/feedback-loops');
});

test('RIS: a DOI given only as a doi.org URL is normalized', () => {
  const [w] = ris.parse('TY  - JOUR\nTI  - Only a link\nUR  - https://doi.org/10.1000/ABC.def.\nER  - \n');
  assert.equal(w.doi, '10.1000/abc.def');
  assert.equal(w.url, 'https://doi.org/10.1000/ABC.def.');
});

test('BibTeX: nested braces, "and"-separated authors, Family, Given order, LaTeX accents, macros, comments', () => {
  const works = bibtex.parse(fx('sample.bib'));
  assert.equal(works.length, 2, 'the @comment and the title-less @misc are not records');
  const [a, b] = works;
  assert.equal(a.title, 'Adaptive Tutoring Systems: BERT-based feedback for NLP essays');
  assert.deepEqual(a.authors, ['Mei Lin', 'Omar Haddad', 'European Education Consortium', 'Anna Schönberger']);
  assert.equal(a.venue, 'Journal of Learning Analytics', '@string macro expanded');
  assert.equal(a.year, 2021);
  assert.equal(a.doi, '10.9999/rgod.fixture.bib1');
  assert.equal(a.abstract, 'Feedback quality improves when LaTeX accents like über are read correctly.');
  assert.deepEqual(a.fields, ['tutoring', 'feedback', 'machine learning']);
  assert.equal(a.type, 'article');
  assert.equal(b.title, 'Café culture and Öztürk trends');
  assert.deepEqual(b.authors, ['Ali Öztürk', 'Jane Q. Doe']);
  assert.equal(b.venue, 'Proceedings of the Example Conference');
  assert.equal(b.year, 2019, 'year taken from the date field');
  assert.equal(b.url, 'https://doi.org/10.9999/rgod.fixture.bib2');
  assert.equal(b.doi, '10.9999/rgod.fixture.bib2', 'DOI taken from a doi.org url');
});

test('BibTeX: LaTeX accent and special-letter conversions', () => {
  assert.equal(bibtex.cleanLatex('Sch{\\"o}nberger'), 'Schönberger');
  assert.equal(bibtex.cleanLatex('\\"{O}zt\\"{u}rk'), 'Öztürk');
  assert.equal(bibtex.cleanLatex('Erd\\H{o}s'), 'Erdős');
  assert.equal(bibtex.cleanLatex('Fran\\c{c}ois'), 'François');
  assert.equal(bibtex.cleanLatex('\\o{}rsted and {\\ss}'), 'ørsted and ß');
  assert.equal(bibtex.cleanLatex('Caf\\\'e'), 'Café');
});

test('BibTeX: nested braces inside quoted values and a bare-number year', () => {
  const [w] = bibtex.parse('@article{k1, title = "A {Nested {Group}} study", author = "Lin, Mei", year = 2020}');
  assert.equal(w.title, 'A Nested Group study');
  assert.deepEqual(w.authors, ['Mei Lin']);
  assert.equal(w.year, 2020);
});

test('CSV: quoted fields with commas, doubled quotes and line breaks', () => {
  const works = csv.parse(fx('sample.csv'));
  assert.equal(works.length, 2, 'the row without a title is skipped');
  const [a, b] = works;
  assert.equal(a.title, 'Tutoring, feedback and "quality"');
  assert.deepEqual(a.authors, ['Lin Mei', 'Omar Haddad']);
  assert.equal(a.year, 2021);
  assert.equal(a.venue, 'Computers & Education', '"Source Title" matches venue');
  assert.equal(a.abstract, 'Line one. Line two, with a comma.');
  assert.equal(a.doi, '10.9999/rgod.fixture.csv1');
  assert.equal(a.url, 'https://example.org/csv1');
  assert.equal(b.year, 2019);
  assert.equal(b.doi, '10.9999/rgod.fixture.csv2');
  assert.equal(b.url, null);
});

test('CSV: a file with no title column is an error, not an empty result', () => {
  assert.throws(() => csv.parse('Author,Journal\nLin,Some Journal\n'), /no title column/);
});

test('CSV: column aliases map to the Work fields', () => {
  const [w] = csv.parse('TI,AU,PY,Journal,AB,LA\r\nA title,Lin Mei,2018,Some Journal,A short note,eng\r\n');
  assert.equal(w.title, 'A title');
  assert.deepEqual(w.authors, ['Lin Mei']);
  assert.equal(w.year, 2018);
  assert.equal(w.venue, 'Some Journal');
  assert.equal(w.abstract, 'A short note');
  assert.equal(w.language, 'eng');
});

test('parseCsv follows RFC 4180 quoting and drops blank lines', () => {
  assert.deepEqual(csv.parseCsv('a,"b,c","d""e"\n"x\ny",z\r\n\r\n'), [['a', 'b,c', 'd"e'], ['x\ny', 'z']]);
});

test('parseFile picks the importer by extension', () => {
  assert.equal(parseFile('export.ris', fx('sample.ris')).length, 2);
  assert.equal(parseFile('export.BIB', fx('sample.bib')).length, 2);
  assert.equal(parseFile('/some/dir/export.csv', fx('sample.csv')).length, 2);
  // .txt is sniffed: RIS when it has a TY tag, BibTeX when it has an entry.
  assert.equal(parseFile('notes.txt', fx('sample.txt'))[0].title, 'Adaptive tutoring systems and feedback quality');
  assert.equal(parseFile('notes.txt', '@article{k, title = {Sniffed}}')[0].title, 'Sniffed');
  assert.throws(() => parseFile('export.xlsx', 'x'), /unsupported import file/);
  assert.throws(() => parseFile('notes.txt', 'plain text with no records'), /unsupported import file/);
});
