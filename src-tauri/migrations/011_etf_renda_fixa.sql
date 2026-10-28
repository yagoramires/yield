-- ETF de renda fixa (ex. IMAB11): imposto retido na fonte, fica fora da apuração mensal. O CHECK de asset_type não aceita tipo novo: refaz a tabela.
CREATE TABLE trades_new (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('C', 'V')),
  asset_type TEXT NOT NULL CHECK (asset_type IN ('Ação', 'FII', 'ETF', 'BDR', 'ETF RF')),
  ticker TEXT NOT NULL,
  qty INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  fees_cents INTEGER NOT NULL,
  irrf_cents INTEGER NOT NULL
);
INSERT INTO trades_new (id, note_id, seq, side, asset_type, ticker, qty, price_cents, fees_cents, irrf_cents)
  SELECT id, note_id, seq, side, asset_type, ticker, qty, price_cents, fees_cents, irrf_cents FROM trades;
DROP TABLE trades;
ALTER TABLE trades_new RENAME TO trades;
CREATE INDEX trades_note ON trades (note_id);

UPDATE meta SET value = '11' WHERE key = 'schema_version';
