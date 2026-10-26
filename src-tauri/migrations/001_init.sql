CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO meta (key, value) VALUES ('app', 'yield'), ('schema_version', '1');

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  broker TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  settle_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'pdf', 'planilha', 'sem_nota')),
  source_key TEXT,
  label TEXT,
  UNIQUE (broker, number, trade_date)
);

CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('C', 'V')),
  asset_type TEXT NOT NULL CHECK (asset_type IN ('Ação', 'FII', 'ETF', 'BDR')),
  ticker TEXT NOT NULL,
  qty INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  fees_cents INTEGER NOT NULL,
  irrf_cents INTEGER NOT NULL
);
CREATE INDEX trades_note ON trades (note_id);

CREATE TABLE corporate_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('bonificacao', 'desdobramento', 'grupamento', 'mudanca_ticker')),
  ticker TEXT NOT NULL,
  new_ticker TEXT,
  date TEXT NOT NULL,
  qty_delta INTEGER,
  unit_cost_cents INTEGER,
  source_key TEXT UNIQUE
);

CREATE TABLE dividends (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('Dividendo', 'JCP', 'Rendimento')),
  pay_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  broker TEXT,
  source TEXT NOT NULL CHECK (source IN ('b3', 'planilha', 'manual')),
  source_key TEXT UNIQUE
);

CREATE TABLE darf_payments (
  month TEXT PRIMARY KEY,
  paid_at TEXT NOT NULL,
  principal_cents INTEGER NOT NULL,
  total_paid_cents INTEGER NOT NULL
);

CREATE TABLE quotes (
  symbol TEXT PRIMARY KEY,
  price_cents INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('yahoo', 'manual'))
);

CREATE TABLE manual_assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  asset_class TEXT NOT NULL CHECK (asset_class IN ('renda_fixa', 'cripto', 'dolar', 'outro')),
  quote_symbol TEXT,
  quantity REAL,
  value_cents INTEGER,
  updated_at TEXT NOT NULL,
  source_key TEXT UNIQUE
);

CREATE TABLE ticker_aliases (spec TEXT PRIMARY KEY, ticker TEXT NOT NULL);
