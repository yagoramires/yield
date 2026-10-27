-- Fonte de renda CLT (INSS e IRRF calculados pelo app) e o número de dependentes do IRRF.
-- O CHECK de `kind` só muda recriando a tabela. Apagar a antiga dispara o ON DELETE SET NULL de
-- budget_lines.source_id, então o vínculo das linhas é guardado antes e devolvido depois.
CREATE TEMP TABLE vinculo_fonte AS SELECT id, source_id FROM budget_lines WHERE source_id IS NOT NULL;

CREATE TABLE income_sources_nova (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pj', 'clt', 'fixo')),
  gross_cents INTEGER,
  pro_labore_pct REAL NOT NULL,
  irpj_pct REAL NOT NULL,
  inss_pct REAL NOT NULL,
  contabilidade_cents INTEGER NOT NULL,
  outros_cents INTEGER NOT NULL,
  net_cents INTEGER,
  source_key TEXT UNIQUE,
  dependents INTEGER NOT NULL DEFAULT 0
);
INSERT INTO income_sources_nova (id, name, kind, gross_cents, pro_labore_pct, irpj_pct, inss_pct, contabilidade_cents, outros_cents, net_cents, source_key)
  SELECT id, name, kind, gross_cents, pro_labore_pct, irpj_pct, inss_pct, contabilidade_cents, outros_cents, net_cents, source_key FROM income_sources;
DROP TABLE income_sources;
ALTER TABLE income_sources_nova RENAME TO income_sources;

UPDATE budget_lines SET source_id = (SELECT v.source_id FROM vinculo_fonte v WHERE v.id = budget_lines.id)
  WHERE id IN (SELECT id FROM vinculo_fonte);
DROP TABLE vinculo_fonte;

UPDATE meta SET value = '7' WHERE key = 'schema_version';
