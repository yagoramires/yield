-- Saldo de cada conta como a Pluggy informa na sincronização (conta: saldo disponível; cartão: fatura em aberto). Conta por arquivo fica sem.
ALTER TABLE accounts ADD COLUMN balance_cents INTEGER;
ALTER TABLE accounts ADD COLUMN balance_at TEXT;

UPDATE meta SET value = '16' WHERE key = 'schema_version';
