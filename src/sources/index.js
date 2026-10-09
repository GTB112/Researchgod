// Source registry: each search module by name. Unpaywall is a DOI lookup, not a search, so it is not listed.
import * as openalex from './openalex.js';
import * as crossref from './crossref.js';
import * as pubmed from './pubmed.js';
import * as europepmc from './europepmc.js';
import * as eric from './eric.js';
import * as semanticscholar from './semanticscholar.js';

export const SOURCES = { openalex, crossref, pubmed, europepmc, eric, semanticscholar };
