-- Insights do Assistente por mês: o modelo leva de 10 a 30 s, então guarda o último e só regera quando a pessoa pede.
CREATE TABLE ai_insights (
  month TEXT PRIMARY KEY,
  facts_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

UPDATE meta SET value = '17' WHERE key = 'schema_version';
