-- Bens (imóvel, veículo…): o que custou, quanto vale hoje (a pessoa atualiza), o financiamento e os vencimentos do ano.
CREATE TABLE possessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('apartamento', 'casa', 'terreno', 'imovel', 'veiculo', 'outro')),
  name TEXT NOT NULL,
  details TEXT,                     -- endereço, placa, Renavam: vai na discriminação do IR
  bought_at TEXT NOT NULL,          -- data da compra
  cost_cents INTEGER NOT NULL,      -- valor da compra
  value_cents INTEGER,              -- quanto vale hoje, estimado pela pessoa
  value_at TEXT,
  down_payment_cents INTEGER,       -- entrada; financiamento só quando as três colunas abaixo existem
  installment_cents INTEGER,
  installments_total INTEGER,
  first_installment TEXT,           -- mês da primeira parcela (AAAA-MM)
  debt_cents INTEGER,               -- saldo devedor informado (opcional; sem ele, parcela × restantes)
  category_ids TEXT NOT NULL DEFAULT '[]',  -- categorias dos lançamentos que são custo do bem
  reminders TEXT NOT NULL DEFAULT '[]'      -- vencimentos do ano: [{ name, day, month, amountCents }]
);

UPDATE meta SET value = '19' WHERE key = 'schema_version';
