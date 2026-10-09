// PubMed: E-utilities esearch (ids, paged by retstart) then efetch (XML, read with regex; no XML dependency).
import { makeWork } from '../work.js';
import { plainText } from './crossref.js';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

// Inner text of the first <name>…</name>, or null. Does not match longer names such as <AbstractText>.
const tag = (xml, name) => {
  const m = String(xml ?? '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : null;
};

function parseArticle(a) {
  const mc = tag(a, 'MedlineCitation') ?? a;
  const pd = tag(a, 'PubmedData') ?? '';
  const art = tag(mc, 'Article') ?? mc;
  const journal = tag(art, 'Journal') ?? '';
  const title = plainText(tag(art, 'ArticleTitle'));
  if (!title) return null;

  const abs = tag(art, 'Abstract');
  const abstract = abs
    ? [...abs.matchAll(/<AbstractText(?:\s([^>]*))?>([\s\S]*?)<\/AbstractText>/g)]
      .map(([, attrs = '', body]) => {
        const label = attrs.match(/Label="([^"]+)"/)?.[1];
        const text = plainText(body);
        return text && (label ? `${label}: ${text}` : text);
      })
      .filter(Boolean)
      .join(' ')
    : null;

  const authors = [...(tag(art, 'AuthorList') ?? '').matchAll(/<Author(?:\s[^>]*)?>([\s\S]*?)<\/Author>/g)]
    .map(([, b]) => plainText(tag(b, 'CollectiveName'))
      ?? ([plainText(tag(b, 'ForeName')) ?? plainText(tag(b, 'Initials')), plainText(tag(b, 'LastName'))]
        .filter(Boolean).join(' ') || null))
    .filter(Boolean);

  // The article's own ArticleIdList comes first in PubmedData; later lists belong to references.
  const ids = tag(pd, 'ArticleIdList') ?? '';
  const pmid = plainText(tag(mc, 'PMID'));
  const doi = plainText(ids.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/)?.[1]
    ?? art.match(/<ELocationID EIdType="doi"[^>]*>([^<]+)</)?.[1]);
  const pmcid = plainText(ids.match(/<ArticleId IdType="pmc">([^<]+)<\/ArticleId>/)?.[1]);

  const year = journal.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/)?.[1]
    ?? journal.match(/<MedlineDate>[^<]*?(\d{4})/)?.[1]
    ?? art.match(/<ArticleDate[^>]*>\s*<Year>(\d{4})/)?.[1];

  return makeWork({
    title,
    doi,
    year,
    authors,
    venue: plainText(tag(journal, 'Title')),
    abstract,
    language: plainText(tag(art, 'Language')),
    type: plainText(art.match(/<PublicationType[^>]*>([^<]+)</)?.[1]),
    url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : null,
    fields: [...mc.matchAll(/<DescriptorName[^>]*>([^<]+)<\/DescriptorName>/g)].map((m) => plainText(m[1])),
    ids: { pmid, pmcid },
  });
}

// PubmedArticleSet XML → Work[] (records without a title are skipped).
export function parsePubmedXml(xml) {
  const articles = String(xml).match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
  return articles.map(parseArticle).filter(Boolean);
}

const headersFor = (email) => (email ? { 'user-agent': `researchgod/0.1 (mailto:${email})` } : {});

async function get(url, fetch, email) {
  const res = await fetch(url, { headers: headersFor(email) });
  if (!res.ok) throw new Error(`PubMed HTTP ${res.status}`);
  return res;
}

export async function search(query, { from, until, limit = 100, fetch, email } = {}) {
  const f = fetch ?? globalThis.fetch;
  const dates = from || until
    ? { datetype: 'pdat', mindate: String(from ?? 1000), maxdate: String(until ?? 3000) }
    : {};
  const ids = [];
  let total = null;
  let retstart = 0;
  let url = null;
  while (ids.length < limit) {
    const p = new URLSearchParams({
      db: 'pubmed',
      term: query,
      retmode: 'json',
      retstart: String(retstart),
      retmax: String(Math.min(100, limit - ids.length)),
      tool: 'researchgod',
      ...dates,
    });
    url ??= `${EUTILS}/esearch.fcgi?${p}`;
    const er = (await (await get(`${EUTILS}/esearch.fcgi?${p}`, f, email)).json()).esearchresult ?? {};
    total ??= Number(er.count ?? 0);
    const page = er.idlist ?? [];
    ids.push(...page.slice(0, limit - ids.length));
    retstart += page.length;
    if (!page.length || retstart >= total) break;
  }

  const works = [];
  for (let i = 0; i < ids.length; i += 200) {
    const p = new URLSearchParams({ db: 'pubmed', id: ids.slice(i, i + 200).join(','), retmode: 'xml', tool: 'researchgod' });
    works.push(...parsePubmedXml(await (await get(`${EUTILS}/efetch.fcgi?${p}`, f, email)).text()));
  }
  // Keep only the requested ids, in search order; efetch does not promise either.
  const ordered = ids.flatMap((id) => works.filter((w) => w.ids.pmid === id));
  return { works: ordered, total, url };
}
