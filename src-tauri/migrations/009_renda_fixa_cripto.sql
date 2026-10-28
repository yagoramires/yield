-- Renda fixa da B3 (movimentações + último valor da Posição), saldos da Binance e ativos manuais do exterior (em US$).
CREATE TABLE rf_moves (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  product TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('aplicacao', 'saida', 'juros')),
  qty REAL NOT NULL,
  value_cents INTEGER, -- NULL: a B3 não informou (ex. "VENCIMENTO" com valor 0)
  source_key TEXT NOT NULL UNIQUE
);
CREATE INDEX rf_moves_key ON rf_moves (key);

CREATE TABLE rf_positions (
  key TEXT PRIMARY KEY,
  family TEXT NOT NULL CHECK (family IN ('tesouro', 'rf')),
  product TEXT NOT NULL,
  issuer TEXT,
  indexer TEXT NOT NULL,
  maturity TEXT,
  qty REAL NOT NULL,
  applied_cents INTEGER,
  value_cents INTEGER NOT NULL,
  as_of TEXT NOT NULL
);

CREATE TABLE crypto_balances (
  asset TEXT PRIMARY KEY,
  qty REAL NOT NULL,
  cost_cents INTEGER,
  fetched_at TEXT NOT NULL
);

-- O CHECK de asset_class não aceita classe nova: refaz a tabela preservando ids e source_key.
CREATE TABLE manual_assets_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  asset_class TEXT NOT NULL CHECK (asset_class IN ('renda_fixa', 'cripto', 'dolar', 'exterior', 'outro')),
  quote_symbol TEXT,
  quantity REAL,
  value_cents INTEGER,
  updated_at TEXT NOT NULL,
  source_key TEXT UNIQUE,
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency IN ('BRL', 'USD'))
);
INSERT INTO manual_assets_new (id, name, asset_class, quote_symbol, quantity, value_cents, updated_at, source_key)
  SELECT id, name, asset_class, quote_symbol, quantity, value_cents, updated_at, source_key FROM manual_assets;
DROP TABLE manual_assets;
ALTER TABLE manual_assets_new RENAME TO manual_assets;

UPDATE meta SET value = '9' WHERE key = 'schema_version';
