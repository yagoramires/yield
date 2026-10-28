-- Aportado dos ativos manuais, na moeda do ativo (US$ no exterior).
ALTER TABLE manual_assets ADD COLUMN cost_cents INTEGER;

UPDATE meta SET value = '10' WHERE key = 'schema_version';
