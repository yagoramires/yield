-- Cada saída do orçamento num bloco: custo fixo, variável (teto da categoria) ou investimento/meta. Parcela é a saída com n/total.
ALTER TABLE budget_lines ADD COLUMN grupo TEXT CHECK (grupo IN ('fixo', 'variavel', 'meta'));

-- palpite para o que já existe: investimento (e categoria criada fora do gasto) é meta; nas categorias de gasto do dia a dia,
-- a maior saída do mês vira o teto (um por categoria); o resto, inclusive fatura, transferência e assinatura, é custo fixo
UPDATE budget_lines SET grupo = CASE
  WHEN category_id = 'investimento' OR category_id IN (SELECT id FROM categories WHERE counts_as_spending = 0 AND builtin = 0) THEN 'meta'
  WHEN category_id IN ('alimentacao', 'mercado', 'transporte', 'lazer', 'compras', 'viagem', 'outros') AND id = (
    SELECT b.id FROM budget_lines b
    WHERE b.month = budget_lines.month AND b.category_id = budget_lines.category_id AND b.kind = 'saida'
      AND b.installment_total IS NULL AND COALESCE(b.source_key, '') NOT LIKE 'sub:%'
    ORDER BY b.amount_cents DESC, b.position LIMIT 1
  ) THEN 'variavel'
  ELSE 'fixo'
END WHERE kind = 'saida';

UPDATE meta SET value = '14' WHERE key = 'schema_version';
