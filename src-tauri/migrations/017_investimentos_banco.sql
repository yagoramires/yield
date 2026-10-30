-- Investimentos do banco e da corretora que a Pluggy informa com saldo (RDB, caixinhas, fundos, CDB…): a cada sincronização
-- o item tem as suas linhas trocadas. Ação e ETF continuam como operações (trades).
CREATE TABLE pluggy_investments (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT,
  balance_cents INTEGER NOT NULL,
  cost_cents INTEGER,
  fetched_at TEXT NOT NULL
);
CREATE INDEX pluggy_investments_item ON pluggy_investments (item_id);

UPDATE meta SET value = '17' WHERE key = 'schema_version';
