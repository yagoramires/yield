-- Ícone (nome Lucide, ex. "paw-print") e cor (#rrggbb) escolhidos na tela de Categorias; NULL = o padrão do app.
ALTER TABLE categories ADD COLUMN icon TEXT;
ALTER TABLE categories ADD COLUMN color TEXT;

UPDATE meta SET value = '6' WHERE key = 'schema_version';
