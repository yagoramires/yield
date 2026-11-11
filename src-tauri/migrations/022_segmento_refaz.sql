-- O Yahoo chamava quase todo FII de "Híbrido" (REIT—Diversified) ou "Financeiro" (Asset Management): apaga o que veio dele
-- para buscar de novo com o mapeamento novo, que deixa esses em branco para a pessoa escolher. O digitado à mão fica.
DELETE FROM asset_segments WHERE source = 'yahoo';

UPDATE meta SET value = '22' WHERE key = 'schema_version';
