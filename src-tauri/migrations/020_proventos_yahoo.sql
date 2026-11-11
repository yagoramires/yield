-- Proventos por cota dos últimos 12 meses que o Yahoo informa junto com a cotação (valores em reais, com as casas que vierem).
-- Só existe linha para ativo que pagou algo no período; last_date é a data ex do último provento.
CREATE TABLE quote_dividends (
  symbol TEXT PRIMARY KEY,
  sum_12m REAL NOT NULL,
  last_amount REAL NOT NULL,
  last_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

UPDATE meta SET value = '20' WHERE key = 'schema_version';
