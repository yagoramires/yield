-- Metas do orçamento: cada linha vale do mês dela em diante, até a próxima mudança da mesma chave (mudar não reescreve o passado).
CREATE TABLE budget_goals (
  month TEXT NOT NULL,
  key TEXT NOT NULL CHECK (key = 'investir' OR key = 'variaveis' OR key LIKE 'cat:%'),
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents > 0), -- NULL: sem meta deste mês em diante
  PRIMARY KEY (month, key)
);

-- teto em linha vira meta da categoria só no mês com lançamentos (lá o gasto real substitui a linha);
-- sem lançamento a linha continua valendo, como custo à mão
CREATE TEMP TABLE com_lancamento AS SELECT DISTINCT substr(date, 1, 7) AS month FROM transactions;
INSERT INTO budget_goals (month, key, amount_cents)
  SELECT month, 'cat:' || category_id, SUM(amount_cents) FROM budget_lines
  WHERE kind = 'saida' AND grupo = 'variavel' AND installment_total IS NULL AND category_id IS NOT NULL AND month IN (SELECT month FROM com_lancamento)
  GROUP BY month, category_id HAVING SUM(amount_cents) > 0;
INSERT INTO budget_goals (month, key, amount_cents)
  SELECT month, 'investir', SUM(amount_cents) FROM budget_lines
  WHERE kind = 'saida' AND grupo = 'meta' AND installment_total IS NULL
  GROUP BY month HAVING SUM(amount_cents) > 0;
-- meta que existia num mês e não aparece num mês planejado depois não volta sozinha
INSERT INTO budget_goals (month, key, amount_cents)
  SELECT m.month, k.key, NULL FROM budget_months m, (SELECT DISTINCT key FROM budget_goals) k
  WHERE NOT EXISTS (SELECT 1 FROM budget_goals g WHERE g.month = m.month AND g.key = k.key)
    AND EXISTS (SELECT 1 FROM budget_goals g WHERE g.key = k.key AND g.month < m.month);
DELETE FROM budget_lines WHERE kind = 'saida' AND installment_total IS NULL AND (grupo = 'meta'
  OR (grupo = 'variavel' AND category_id IS NOT NULL AND month IN (SELECT month FROM com_lancamento)));
UPDATE budget_lines SET grupo = 'fixo' WHERE kind = 'saida' AND grupo = 'variavel' AND installment_total IS NULL AND category_id IS NOT NULL;
DROP TABLE com_lancamento;

UPDATE meta SET value = '15' WHERE key = 'schema_version';
