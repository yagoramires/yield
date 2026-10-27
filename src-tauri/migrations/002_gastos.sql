CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('pluggy', 'arquivo')),
  external_id TEXT NOT NULL UNIQUE,
  institution TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('conta', 'cartao')),
  number TEXT,
  item_id TEXT,
  last_sync_at TEXT
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  pending INTEGER NOT NULL,
  installment TEXT,
  operation_type TEXT,
  fingerprint TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE
);
CREATE INDEX transactions_account_date ON transactions (account_id, date);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  counts_as_spending INTEGER NOT NULL,
  builtin INTEGER NOT NULL
);
INSERT INTO categories (id, name, counts_as_spending, builtin) VALUES
  ('alimentacao', 'Alimentação', 1, 1), ('mercado', 'Mercado', 1, 1), ('transporte', 'Transporte', 1, 1),
  ('moradia', 'Moradia', 1, 1), ('contas', 'Contas', 1, 1), ('saude', 'Saúde', 1, 1),
  ('educacao', 'Educação', 1, 1), ('lazer', 'Lazer', 1, 1), ('compras', 'Compras', 1, 1),
  ('assinaturas', 'Assinaturas', 1, 1), ('viagem', 'Viagem', 1, 1), ('impostos-e-taxas', 'Impostos e taxas', 1, 1),
  ('outros', 'Outros', 1, 1),
  ('receita', 'Receita', 0, 1), ('transferencia', 'Transferência', 0, 1),
  ('pagamento-de-fatura', 'Pagamento de fatura', 0, 1), ('investimento', 'Investimento', 0, 1);

CREATE TABLE category_rules (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL REFERENCES categories (id) ON DELETE CASCADE
);

CREATE TABLE category_overrides (
  fingerprint TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories (id) ON DELETE CASCADE
);

CREATE TABLE subscription_dismissals (merchant_key TEXT PRIMARY KEY);

CREATE TABLE pluggy_items (item_id TEXT PRIMARY KEY, label TEXT NOT NULL);

UPDATE meta SET value = '2' WHERE key = 'schema_version';
