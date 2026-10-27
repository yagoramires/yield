CREATE TABLE budget_months (month TEXT PRIMARY KEY);

CREATE TABLE budget_lines (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL REFERENCES budget_months (month) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('entrada', 'saida')),
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  recurring INTEGER NOT NULL,
  position INTEGER NOT NULL,
  category_id TEXT REFERENCES categories (id) ON DELETE SET NULL,
  installment_current INTEGER,
  installment_total INTEGER,
  pj_gross_cents INTEGER,
  source_key TEXT UNIQUE
);
CREATE INDEX budget_lines_month ON budget_lines (month);

CREATE TABLE budget_dismissals (
  month TEXT NOT NULL,
  key TEXT NOT NULL,
  PRIMARY KEY (month, key)
);

UPDATE meta SET value = '3' WHERE key = 'schema_version';
