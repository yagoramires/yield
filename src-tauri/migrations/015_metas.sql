-- Metas do orçamento: cada linha vale do mês dela em diante, até a próxima mudança da mesma chave (mudar não reescreve o passado).
CREATE TABLE budget_goals (
  month TEXT NOT NULL,
  key TEXT NOT NULL CHECK (key = 'investir' OR key = 'variaveis' OR key LIKE 'cat:%'),
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents > 0), -- NULL: sem meta deste mês em diante
  PRIMARY KEY (month, key)
);

-- o que era teto ou meta em linha vira meta do mês dela; o gasto e o investido agora vêm dos lançamentos
INSERT INTO budget_goals (month, key, amount_cents)
  SELECT month, 'cat:' || category_id, SUM(amount_cents) FROM budget_lines
  WHERE kind = 'saida' AND grupo = 'variavel' AND installment_total IS NULL AND category_id IS NOT NULL
  GROUP BY month, category_id HAVING SUM(amount_cents) > 0;
INSERT INTO budget_goals (month, key, amount_cents)
  SELECT month, 'investir', SUM(amount_cents) FROM budget_lines
  WHERE kind = 'saida' AND grupo = 'meta' AND installment_total IS NULL
  GROUP BY month HAVING SUM(amount_cents) > 0;
DELETE FROM budget_lines WHERE kind = 'saida' AND installment_total IS NULL
  AND ((grupo = 'variavel' AND category_id IS NOT NULL) OR grupo = 'meta');

UPDATE meta SET value = '15' WHERE key = 'schema_version';
