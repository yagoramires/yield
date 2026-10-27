-- Cadastro para a declaração de IR: razão social e CNPJ de cada ticker e de cada corretora (chave = texto de trades.broker).
CREATE TABLE issuers (ticker TEXT PRIMARY KEY, name TEXT NOT NULL, cnpj TEXT NOT NULL);
CREATE TABLE brokers (code TEXT PRIMARY KEY, name TEXT NOT NULL, cnpj TEXT NOT NULL);

UPDATE meta SET value = '8' WHERE key = 'schema_version';
