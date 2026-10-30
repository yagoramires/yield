-- Cada saída do orçamento num bloco: custo fixo, variável (teto da categoria) ou investimento/meta. Parcela é a saída com n/total.
ALTER TABLE budget_lines ADD COLUMN grupo TEXT CHECK (grupo IN ('fixo', 'variavel', 'meta'));

-- palpite para o que já existe: categoria fora do gasto é meta; assinatura é fixo; o resto com categoria vira teto
UPDATE budget_lines SET grupo = CASE
  WHEN category_id IN (SELECT id FROM categories WHERE counts_as_spending = 0) THEN 'meta'
  WHEN installment_total IS NULL AND category_id IS NOT NULL AND COALESCE(source_key, '') NOT LIKE 'sub:%' THEN 'variavel'
  ELSE 'fixo'
END WHERE kind = 'saida';

UPDATE meta SET value = '14' WHERE key = 'schema_version';
