-- researchgod schema. The contract every module shares (docs/SPEC.md). JSON columns hold JSON text.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,                -- short slug, e.g. "wings"
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('field-map', 'decision')),
  context TEXT,                       -- where findings are applied, e.g. "Indonesia" (null for a field map)
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,                -- e.g. "q1"
  project_id TEXT NOT NULL REFERENCES projects(id),
  text TEXT NOT NULL,
  include_criteria TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  exclude_criteria TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  notes TEXT
);
CREATE TABLE IF NOT EXISTS options (  -- candidate programs for a decision question
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT NOT NULL REFERENCES questions(id),
  name TEXT NOT NULL,
  description TEXT,
  is_null INTEGER NOT NULL DEFAULT 0  -- 1 = "do nothing new"
);
CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT NOT NULL REFERENCES questions(id),
  source TEXT NOT NULL,               -- openalex | crossref | pubmed | europepmc | eric | semanticscholar | an import label (psycinfo, consensus, ...)
  kind TEXT NOT NULL CHECK (kind IN ('api', 'import')),
  query TEXT NOT NULL,                -- full search string (for an import: the string the owner ran, or the file name)
  params TEXT NOT NULL DEFAULT '{}',  -- JSON: from, until, limit, file
  run_at TEXT NOT NULL,
  result_count INTEGER                -- total the source reported
);
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doi TEXT UNIQUE,                    -- normalized (normDoi), or null
  title TEXT NOT NULL,
  title_norm TEXT NOT NULL,           -- normTitle(title)
  year INTEGER,
  authors TEXT NOT NULL DEFAULT '[]', -- JSON array of "Given Family" strings
  venue TEXT,
  abstract TEXT,
  language TEXT,
  type TEXT,
  url TEXT,
  oa_url TEXT,                        -- a direct open-access PDF if known
  cited_by INTEGER,
  fields TEXT NOT NULL DEFAULT '[]',  -- JSON array of subject/topic labels
  ids TEXT NOT NULL DEFAULT '{}',     -- JSON: openalex, pmid, pmcid, eric, s2
  added_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS works_title_norm ON works(title_norm);
CREATE TABLE IF NOT EXISTS work_searches (
  work_id INTEGER NOT NULL REFERENCES works(id),
  search_id INTEGER NOT NULL REFERENCES searches(id),
  rank INTEGER,
  PRIMARY KEY (work_id, search_id)
);
CREATE TABLE IF NOT EXISTS screenings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  stage TEXT NOT NULL CHECK (stage IN ('title_abstract', 'full_text')),
  decision TEXT NOT NULL CHECK (decision IN ('include', 'exclude', 'maybe')),
  reason TEXT,
  quote TEXT,
  quote_ok INTEGER,                   -- 1 if quote is verbatim in title+abstract (null for a person's decision)
  by TEXT NOT NULL,                   -- 'person' or 'model:<provider>/<model>'
  prompt_version TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fulltexts (
  work_id INTEGER PRIMARY KEY REFERENCES works(id),
  pdf_path TEXT,
  text_path TEXT,                     -- <fulltextDir>/<work_id>.json: {"pages": ["...", ...]}
  pages INTEGER,
  sha256 TEXT,
  source TEXT,                        -- 'oa' | 'library' | 'manual'
  needs_ocr INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id),
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done', 'failed', 'blocked', 'not_pdf')),
  note TEXT,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  field TEXT NOT NULL,                -- one of TEMPLATE_FIELDS (src/extract.js)
  value TEXT,
  quote TEXT,
  page INTEGER,                       -- 1-based page of the full text, null when from the abstract
  not_reported INTEGER NOT NULL DEFAULT 0,
  quote_ok INTEGER,                   -- 1 if quote is verbatim in its source (page text, or abstract)
  source TEXT NOT NULL CHECK (source IN ('abstract', 'full_text')),
  by TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0, -- 1 once a person has checked it
  prompt_version TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS excerpts (  -- approved, de-identified interview excerpts only
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  site TEXT,
  label TEXT,                         -- e.g. "Interview 3, youth participant"
  text TEXT NOT NULL,
  language TEXT,
  translation TEXT,
  approved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,              -- 'screen' | 'extract' | ...
  input_tokens INTEGER,
  output_tokens INTEGER,
  ok INTEGER NOT NULL
);
