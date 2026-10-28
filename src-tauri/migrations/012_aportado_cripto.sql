-- Aportado da cripto: calculado do histórico da Binance ou informado à mão; o à mão nunca é sobrescrito pelo cálculo.
ALTER TABLE crypto_balances ADD COLUMN cost_manual INTEGER NOT NULL DEFAULT 0;
-- 1: parte do histórico não tem custo em real conhecido (outra moeda fiduciária, troca cripto por cripto, fonte não lida)
ALTER TABLE crypto_balances ADD COLUMN cost_partial INTEGER NOT NULL DEFAULT 0;
-- até aqui o aportado só podia ter sido informado à mão
UPDATE crypto_balances SET cost_manual = 1 WHERE cost_cents IS NOT NULL;

UPDATE meta SET value = '12' WHERE key = 'schema_version';
