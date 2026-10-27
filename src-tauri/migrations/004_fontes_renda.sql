CREATE TABLE income_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pj', 'fixo')),
  gross_cents INTEGER,
  pro_labore_pct REAL NOT NULL,
  irpj_pct REAL NOT NULL,
  inss_pct REAL NOT NULL,
  contabilidade_cents INTEGER NOT NULL,
  outros_cents INTEGER NOT NULL,
  net_cents INTEGER,
  source_key TEXT UNIQUE
);

ALTER TABLE budget_lines ADD COLUMN source_id TEXT REFERENCES income_sources (id) ON DELETE SET NULL;
ALTER TABLE budget_lines DROP COLUMN pj_gross_cents;
DELETE FROM meta WHERE key = 'orcamento.pj';

UPDATE meta SET value = '4' WHERE key = 'schema_version';
