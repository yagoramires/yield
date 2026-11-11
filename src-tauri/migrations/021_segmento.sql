-- Segmento do ativo (setor da ação, tipo do FII): o Yahoo preenche uma vez; o digitado à mão prevalece e nunca é sobrescrito.
-- segment NULL = o Yahoo não tinha (não busca de novo; a pessoa pode digitar).
CREATE TABLE asset_segments (
  symbol TEXT PRIMARY KEY,
  segment TEXT,
  source TEXT NOT NULL CHECK (source IN ('yahoo', 'manual'))
);

UPDATE meta SET value = '21' WHERE key = 'schema_version';
