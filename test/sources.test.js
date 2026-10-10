// Source adapters: each maps its fixture to Work records, pages until the limit, and never touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as openalex from '../src/sources/openalex.js';
import * as crossref from '../src/sources/crossref.js';
import * as pubmed from '../src/sources/pubmed.js';
import * as europepmc from '../src/sources/europepmc.js';
import * as eric from '../src/sources/eric.js';
import * as semanticscholar from '../src/sources/semanticscholar.js';
import * as unpaywall from '../src/sources/unpaywall.js';
import { SOURCES } from '../src/sources/index.js';

const fx = (name) => readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url), 'utf8');
const json = (name) => JSON.parse(fx(name));

// Injected fetch: records every call and answers from `route(url, init)` with { body, status }.
function fakeFetch(route) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, headers: init.headers ?? {} });
    const r = route(new URL(u), init);
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(body, { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  f.calls = calls;
  return f;
}

test('OpenAlex maps works: DOI, authors, abstract rebuilt in order, ids, OA URL, topics, citations', async () => {
  const fetch = fakeFetch(() => ({ body: json('openalex.json') }));
  const { works, total, url } = await openalex.search('adaptive tutoring', { limit: 2, fetch });
  const [w, bare] = works;
  assert.equal(total, 412);
  assert.equal(new URL(url).searchParams.get('search'), 'adaptive tutoring');
  assert.equal(w.title, 'Adaptive tutoring systems and feedback quality');
  assert.equal(w.doi, '10.9999/rgod.fixture.1');
  assert.equal(w.year, 2021);
  assert.deepEqual(w.authors, ['Mei Lin', 'Omar Haddad']);
  assert.equal(w.venue, 'Computers & Education');
  assert.equal(w.abstract, 'Adaptive tutoring systems use machine learning to personalize feedback. Teachers report that the systems improve engagement in the classroom.');
  assert.deepEqual(w.ids, { openalex: 'W2100000001', pmid: '34000001' });
  assert.equal(w.oaUrl, 'https://example.org/oa/adaptive-tutoring.pdf');
  assert.deepEqual(w.fields, ['Intelligent Tutoring Systems', 'Educational Technology']);
  assert.equal(w.citedBy, 37);
  // Second record: no DOI, no abstract, concepts used when topics are empty.
  assert.equal(bare.doi, null);
  assert.equal(bare.abstract, null);
  assert.deepEqual(bare.fields, ['Education']);
  assert.equal(bare.oaUrl, null);
});

test('OpenAlex rebuildAbstract orders words by position, not by key order', () => {
  assert.equal(openalex.rebuildAbstract({ z: [2], the: [1, 3], a: [0] }), 'a the z the');
  assert.equal(openalex.rebuildAbstract(null), null);
});

test('OpenAlex paging stops at the limit and sends the cursor on', async () => {
  const fetch = fakeFetch((u) => {
    const page = json('openalex.json');
    const c = u.searchParams.get('cursor');
    page.meta.next_cursor = c === '*' ? 'C2' : c === 'C2' ? 'C3' : null;
    return { body: page };
  });
  const { works } = await openalex.search('x', { limit: 3, fetch });
  assert.equal(works.length, 3);
  assert.equal(fetch.calls.length, 2);
  const second = new URL(fetch.calls[1].url).searchParams;
  assert.equal(second.get('cursor'), 'C2');
  assert.equal(second.get('per-page'), '1');
});

test('OpenAlex paging stops when there is no next cursor', async () => {
  const fetch = fakeFetch(() => {
    const page = json('openalex.json');
    page.meta.next_cursor = null;
    return { body: page };
  });
  const { works } = await openalex.search('x', { limit: 10, fetch });
  assert.equal(works.length, 2);
  assert.equal(fetch.calls.length, 1);
});

test('OpenAlex year bounds and mailto are sent when configured', async () => {
  const fetch = fakeFetch(() => ({ body: json('openalex.json') }));
  await openalex.search('x', { from: 2019, until: 2021, limit: 1, fetch, email: 'contact@example.org' });
  const p = new URL(fetch.calls[0].url).searchParams;
  assert.equal(p.get('filter'), 'publication_year:2019-2021');
  assert.equal(p.get('mailto'), 'contact@example.org');
  assert.equal(fetch.calls[0].headers['user-agent'], 'researchgod/0.1 (mailto:contact@example.org)');
});

test('OpenAlex citations: cited_by uses the cites filter', async () => {
  const fetch = fakeFetch(() => ({ body: json('openalex.json') }));
  const { works } = await openalex.citations('https://openalex.org/W2100000001', { direction: 'cited_by', limit: 2, fetch });
  assert.equal(new URL(fetch.calls[0].url).searchParams.get('filter'), 'cites:W2100000001');
  assert.equal(works.length, 2);
});

test('OpenAlex citations: references come from referenced_works, then one filtered lookup', async () => {
  const fetch = fakeFetch((u) => {
    if (u.pathname === '/works/W2100000001') return { body: json('openalex.json').results[0] };
    return { body: json('openalex.json') };
  });
  const { works } = await openalex.citations('W2100000001', { direction: 'references', fetch });
  assert.equal(fetch.calls.length, 2);
  assert.equal(new URL(fetch.calls[1].url).searchParams.get('filter'), 'openalex:W2000000001|W2000000002');
  assert.equal(works.length, 2);
});

test('Crossref maps works: JATS abstract stripped, DOI, year from issued, authors, container, citations', async () => {
  const fetch = fakeFetch(() => ({ body: json('crossref.json') }));
  const { works, total, url } = await crossref.search('machine learning education', { limit: 1, fetch });
  const [w] = works;
  assert.equal(total, 2344432);
  assert.equal(new URL(url).searchParams.get('query'), 'machine learning education');
  assert.equal(w.title, 'Machine Learning in Multicultural Education');
  assert.equal(w.doi, '10.2139/ssrn.4885996');
  assert.equal(w.year, 2024);
  assert.deepEqual(w.authors, ['Dwi Mariyono']);
  assert.match(w.abstract, /^This study explores machine learning's role in multicultural education/);
  assert.doesNotMatch(w.abstract, /[<>]/);
  assert.equal(w.citedBy, 2);
  assert.equal(w.url, 'https://doi.org/10.2139/ssrn.4885996');
});

test('Crossref stripJats removes tags and headings, keeps inline text and decodes entities', () => {
  assert.equal(
    crossref.stripJats('<jats:title>Abstract</jats:title><jats:p>E. <jats:italic>coli</jats:italic> &amp; mice</jats:p>'),
    'E. coli & mice',
  );
  assert.equal(crossref.stripJats(null), null);
});

test('Crossref paging stops at the limit', async () => {
  const fetch = fakeFetch((u) => {
    const page = json('crossref.json');
    page.message['next-cursor'] = u.searchParams.get('cursor') === '*' ? 'C2' : 'C3';
    return { body: page };
  });
  const { works } = await crossref.search('x', { limit: 3, fetch });
  assert.equal(works.length, 3);
  assert.equal(fetch.calls.length, 2);
  assert.equal(new URL(fetch.calls[1].url).searchParams.get('cursor'), 'C2');
});

test('Crossref date filter uses the from/until-pub-date form', async () => {
  const fetch = fakeFetch(() => ({ body: json('crossref.json') }));
  await crossref.search('x', { from: 2019, until: 2021, limit: 1, fetch });
  assert.equal(new URL(fetch.calls[0].url).searchParams.get('filter'), 'from-pub-date:2019,until-pub-date:2021');
});

test('PubMed: esearch then efetch maps XML records, in search order', async () => {
  const fetch = fakeFetch((u) => (u.pathname.endsWith('esearch.fcgi')
    ? { body: json('pubmed_esearch.json') }
    : { body: fx('pubmed.xml') }));
  const { works, total, url } = await pubmed.search('machine learning', { limit: 2, fetch });
  assert.equal(total, 27799);
  assert.match(url, /esearch\.fcgi\?/);
  assert.deepEqual(works.map((w) => w.ids.pmid), ['42849043', '42848157']);
  const [w] = works;
  assert.equal(w.title, 'Machine Learning-Based Risk Prediction Models for Peripheral Artery Disease: A Nationally Representative Analysis of NHANES 1999-2004.');
  assert.equal(w.doi, '10.1177/10760296261496971');
  assert.equal(w.year, 2026);
  assert.equal(w.authors[0], 'Haijun Feng');
  assert.equal(w.type, 'Journal Article');
  assert.equal(w.language, 'eng');
  assert.equal(w.url, 'https://pubmed.ncbi.nlm.nih.gov/42849043/');
  // Labelled sections are joined as "LABEL: text".
  const labelled = works[1];
  assert.equal(labelled.doi, '10.1007/s12072-026-11159-4');
  assert.equal(labelled.venue, 'Hepatology international');
  assert.match(labelled.abstract, /^BACKGROUND: Metabolic dysfunction-associated steatotic liver disease/);
  assert.match(labelled.abstract, / METHODS: /);
  // efetch is asked for XML with the ids found by esearch.
  assert.equal(new URL(fetch.calls[1].url).searchParams.get('id'), '42849043,42848157');
});

test('PubMed paging: esearch retstart and efetch ids respect the limit', async () => {
  const fetch = fakeFetch((u) => (u.pathname.endsWith('esearch.fcgi')
    ? { body: json('pubmed_esearch.json') }
    : { body: fx('pubmed.xml') }));
  const { works } = await pubmed.search('x', { limit: 1, fetch });
  assert.equal(works.length, 1);
  assert.equal(new URL(fetch.calls[0].url).searchParams.get('retmax'), '1');
  assert.equal(new URL(fetch.calls[1].url).searchParams.get('id'), '42849043');
});

test('Europe PMC maps core results: ids, authors from firstName/lastName, cleaned abstract, OA PDF', async () => {
  const fetch = fakeFetch(() => ({ body: json('europepmc.json') }));
  const { works, total } = await europepmc.search('x', { limit: 1, fetch });
  const [w] = works;
  assert.equal(total, 144776);
  assert.equal(w.title, 'Fostering Multidisciplinary Collaboration in Artificial Intelligence and Machine Learning Education: Tutorial Based on the AI-READI Bootcamp.');
  assert.equal(w.doi, '10.2196/83154');
  assert.equal(w.year, 2025);
  assert.deepEqual(w.authors.slice(0, 2), ['Taiki W Nishihara', 'Fritz Gerald P Kalaw']);
  assert.equal(w.venue, 'JMIR medical education');
  assert.match(w.abstract, /^Background The integration of artificial intelligence \(AI\)/);
  assert.doesNotMatch(w.abstract, /[<>]/);
  assert.deepEqual(w.ids, { pmid: '41461109', pmcid: 'PMC12747659' });
  assert.match(w.oaUrl, /PMC12747659/);
  assert.equal(w.url, 'https://europepmc.org/article/MED/41461109');
  assert.deepEqual(w.fields.slice(0, 2), ['Artificial intelligence', 'Medical education']);
  assert.ok(w.fields.includes('Machine Learning'));
});

test('Europe PMC paging follows cursorMark and stops at the limit', async () => {
  const fetch = fakeFetch((u) => {
    const page = json('europepmc.json');
    page.nextCursorMark = u.searchParams.get('cursorMark') === '*' ? 'NEXT' : 'NEXT2';
    return { body: page };
  });
  const { works } = await europepmc.search('x', { limit: 3, fetch });
  assert.equal(works.length, 3);
  assert.equal(fetch.calls.length, 2);
  assert.equal(new URL(fetch.calls[1].url).searchParams.get('cursorMark'), 'NEXT');
});

test('Europe PMC stops when the cursor does not advance', async () => {
  const fetch = fakeFetch(() => {
    const page = json('europepmc.json');
    page.nextCursorMark = '*';
    return { body: page };
  });
  const { works } = await europepmc.search('x', { limit: 10, fetch });
  assert.equal(works.length, 2);
  assert.equal(fetch.calls.length, 1);
});

test('ERIC maps docs: EJ id, subjects as fields, "Family, Given" authors flipped', async () => {
  const fetch = fakeFetch(() => ({ body: json('eric.json') }));
  const { works, total } = await eric.search('machine learning', { limit: 2, fetch });
  assert.equal(total, 1646085);
  const [a, b] = works;
  assert.equal(a.title, 'Understanding Machine Translation Fit for Language Learning: The Mediating Effect of Machine Translation Literacy');
  assert.equal(a.year, 2024);
  assert.deepEqual(a.authors, ['Yanxia Yang']);
  assert.deepEqual(a.ids, { eric: 'EJ1449081' });
  assert.equal(a.url, 'https://eric.ed.gov/?id=EJ1449081');
  assert.ok(a.fields.includes('Translation'));
  assert.deepEqual(b.authors, ['Zhongmin Cui']);
  assert.equal(b.year, 2021);
});

test('ERIC paging advances start and stops at the limit', async () => {
  const fetch = fakeFetch(() => ({ body: json('eric.json') }));
  const { works } = await eric.search('x', { limit: 3, fetch });
  assert.equal(works.length, 3);
  assert.equal(fetch.calls.length, 2);
  assert.equal(new URL(fetch.calls[1].url).searchParams.get('start'), '2');
  assert.equal(new URL(fetch.calls[1].url).searchParams.get('rows'), '1');
});

test('Semantic Scholar maps papers: ids, OA PDF, citations, PubMed/PMC ids, null-safe fields', async () => {
  const fetch = fakeFetch(() => ({ body: json('semanticscholar.json') }));
  const { works, total } = await semanticscholar.search('x', { limit: 2, fetch });
  assert.equal(total, 2);
  const [a, b] = works;
  assert.equal(a.title, 'Adaptive tutoring systems and feedback quality');
  assert.equal(a.doi, '10.9999/rgod.fixture.2');
  assert.equal(a.year, 2021);
  assert.deepEqual(a.authors, ['Mei Lin', 'Omar Haddad']);
  assert.equal(a.venue, 'Journal of Learning Analytics');
  assert.equal(a.type, 'JournalArticle');
  assert.equal(a.oaUrl, 'https://example.org/oa/s2-fixture.pdf');
  assert.equal(a.citedBy, 12);
  assert.deepEqual(a.ids, { s2: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', pmid: '34000002', pmcid: 'PMC9000002' });
  assert.equal(b.doi, null);
  assert.equal(b.venue, null);
  assert.equal(b.oaUrl, null);
  assert.equal(b.type, null);
  assert.deepEqual(b.ids, { s2: 'ffeeddccbbaa00112233445566778899aabbccdd' });
});

test('Semantic Scholar sends x-api-key when given, and the year range when bounded', async () => {
  const fetch = fakeFetch(() => ({ body: json('semanticscholar.json') }));
  await semanticscholar.search('x', { from: 2019, until: 2021, limit: 1, fetch, apiKey: 'k-test' });
  assert.equal(fetch.calls[0].headers['x-api-key'], 'k-test');
  assert.equal(new URL(fetch.calls[0].url).searchParams.get('year'), '2019-2021');
});

test('Semantic Scholar paging follows next offsets and stops at the limit', async () => {
  const fetch = fakeFetch((u) => {
    const page = json('semanticscholar.json');
    page.next = Number(u.searchParams.get('offset')) + 2;
    return { body: page };
  });
  const { works } = await semanticscholar.search('x', { limit: 3, fetch });
  assert.equal(works.length, 3);
  assert.equal(fetch.calls.length, 2);
  assert.equal(new URL(fetch.calls[1].url).searchParams.get('offset'), '2');
});

test('Unpaywall returns the best OA PDF, sends the email, and returns null for unknown DOIs', async () => {
  const fetch = fakeFetch(() => ({ body: json('unpaywall.json') }));
  const pdf = await unpaywall.oaPdf('10.1038/nature12373', { email: 'contact@example.org', fetch });
  assert.equal(pdf, 'https://www.nature.com/articles/nature12373.pdf');
  assert.equal(new URL(fetch.calls[0].url).pathname, '/v2/10.1038/nature12373');
  assert.equal(new URL(fetch.calls[0].url).searchParams.get('email'), 'contact@example.org');
  const missing = fakeFetch(() => ({ status: 404, body: {} }));
  assert.equal(await unpaywall.oaPdf('10.0000/none', { email: 'contact@example.org', fetch: missing }), null);
  await assert.rejects(unpaywall.oaPdf('10.1038/nature12373', { fetch }), /requires an email/);
});

test('source registry lists the six search sources', () => {
  assert.deepEqual(Object.keys(SOURCES), ['openalex', 'crossref', 'pubmed', 'europepmc', 'eric', 'semanticscholar']);
  for (const mod of Object.values(SOURCES)) assert.equal(typeof mod.search, 'function');
});
