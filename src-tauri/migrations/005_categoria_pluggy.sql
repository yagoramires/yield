-- Categoria que a Pluggy manda em cada transação (em inglês, ex. "Groceries"); vira categoria do app em domain/categoriasPluggy.ts.
ALTER TABLE transactions ADD COLUMN pluggy_category TEXT;

-- Força a próxima sincronização a buscar o ano inteiro de novo, para as transações já baixadas ganharem a categoria.
UPDATE accounts SET last_sync_at = NULL WHERE source = 'pluggy';

UPDATE meta SET value = '5' WHERE key = 'schema_version';
