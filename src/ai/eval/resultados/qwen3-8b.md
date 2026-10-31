# Bateria de avaliação — qwen3-8b

- Valores certos: 37/40 (93%)
- Valores não conferidos: 2
- Ferramenta certa: 30/31
- Em português: 40/40
- Tempo médio: 5.2 s

| perfil | pergunta | valores | não conferidos | ferramenta | pt | tempo | resposta |
|---|---|---|---|---|---|---|---|
| gastador | Quanto gastei em outubro de 2026? | 1/1 | — | ok | sim | 7.4 s | Você gastou R$ 1.620,00 em outubro de 2026, distribuído da seguinte forma: - Mercado: R$ 910,00 - Delivery: R$ 520,00 - Transporte: R$ 190,00 |
| gastador | Quanto gastei com delivery em outubro? | 1/1 | — | ok | sim | 3.3 s | Você gastou R$ 520,00 com delivery em outubro. |
| gastador | Quanto gastei com mercado este ano? | 1/1 | — | ok | sim | 3.2 s | Você gastou R$ 2.690,00 com mercado este ano. |
| gastador | Quanto gastei em setembro? | 1/1 | — | ok | sim | 5.4 s | Você gastou R$ 1.390,00 em setembro, distribuído da seguinte forma: - Mercado: R$ 880,00 - Delivery: R$ 300,00 - Transporte: R$ 210,00 |
| gastador | Qual foi meu gasto total de agosto a outubro de 2026? | 1/1 | — | ok | sim | 6.0 s | Seu gasto total de agosto a outubro de 2026 foi de R$ 4.360,00. O maior gasto foi em Mercado, com R$ 2.690,00, seguido por Delivery (R$ 1.070,00) e Transporte (R$ 600,00). |
| gastador | Quanto gastei com transporte em agosto? | 1/1 | — | ok | sim | 3.1 s | Você gastou R$ 200,00 com transporte em agosto. |
| gastador | Como está meu orçamento de outubro? | 2/2 | — | ok | sim | 11.3 s | O orçamento de outubro foi de R$ 1.450,00, mas você gastou R$ 1.620,00. A previsão do mês era de R$ 1.674,00. - **Bloco variável**: planejado R$ 0,00, realizado R$ 1.620,00. - **Metas**: - Mercado: meta R$ 900,00, gasto  |
| gastador | Quais foram meus pedidos de delivery em outubro? | 1/2 | — | ok | sim | 5.0 s | Você fez 3 pedidos de delivery em outubro, totalizando R$ 520,00. O maior pedido foi no dia 24/10, no valor de R$ 180,00. |
| gastador | Quanto gastei com delivery em setembro? | 1/1 | — | ok | sim | 3.1 s | Você gastou R$ 300,00 com delivery em setembro. |
| gastador | Quanto gastei com mercado em agosto? | 1/1 | — | ok | sim | 3.1 s | Você gastou R$ 900,00 com mercado em agosto. |
| gastador | Quanto gastei com delivery de agosto a outubro? | 1/1 | — | ok | sim | 3.6 s | Você gastou R$ 1.070,00 com delivery de agosto a outubro. |
| investidor | Quanto tenho investido? | 1/1 | — | ok | sim | 5.9 s | Você tem investido R$ 7.050,00, com uma valorização de +R$ 50,00 (+0,7%) sobre o aportado. O patrimônio está dividido em: - FIIs: R$ 4.900,00 (69,5% do patrimônio) - Ações: R$ 2.150,00 (30,5% do patrimônio) |
| investidor | Minha carteira está rendendo mais que o CDI nos últimos 12 meses? | 2/2 | — | ok | sim | 3.4 s | A carteira rendeu +4,2% nos últimos 12 meses, enquanto o CDI rendeu +11,8%. Portanto, a carteira rendeu menos que o CDI nesse período. |
| investidor | Quanto recebi de proventos em 2026? | 1/1 | — | ok | sim | 6.5 s | Você recebeu um total de R$ 520,00 de proventos em 2026. O maior valor foi em agosto, com R$ 160,00, e os proventos foram recebidos principalmente nos ativos FIIA11 (R$ 400,00) e AAAA3 (R$ 120,00). |
| investidor | Quanto o FIIA11 pagou de proventos este ano? | 1/1 | — | ok | sim | 3.8 s | O FIIA11 pagou um total de R$ 400,00 de proventos este ano. |
| investidor | Quanto recebi de proventos em agosto de 2026? | 1/1 | — | ok | sim | 3.5 s | Você recebeu R$ 160,00 de proventos em agosto de 2026. |
| investidor | Quanto minha carteira valorizou? | 1/1 | — | ok | sim | 4.6 s | Sua carteira valorizou R$ 50,00, que é um aumento de 0,7% sobre o valor aportado. O patrimônio total é de R$ 7.050,00, com 69,5% em FIIs e 30,5% em ações. |
| investidor | Quanto tenho em FIIs? | 0/1 | — | **nenhuma** | sim | 0.4 s | Não tenho esse dado. |
| investidor | Quanto gastei com mercado em outubro? | 1/1 | — | ok | sim | 3.8 s | Você gastou R$ 1.000,00 com mercado em outubro. |
| investidor | Quanto recebi de proventos em setembro de 2026? | 1/1 | — | ok | sim | 3.5 s | Você recebeu R$ 40,00 de proventos em setembro de 2026. |
| investidor | Quanto tenho em ações? | 1/1 | — | ok | sim | 2.7 s | Você tem R$ 2.150,00 em ações. |
| semOrcamento | Quanto gastei na padaria em outubro? | 1/1 | — | ok | sim | 3.6 s | Você gastou R$ 75,00 na padaria em outubro. |
| semOrcamento | Quanto gastei em outubro? | 1/1 | — | ok | sim | 4.9 s | Você gastou R$ 645,00 em outubro, distribuído da seguinte forma: R$ 450,00 em Mercado, R$ 120,00 em Transporte e R$ 75,00 em Padaria. |
| semOrcamento | Como está meu orçamento de outubro? | 0/0 | — | ok | sim | 4.7 s | O orçamento de outubro está com R$ 645,00 gastos, enquanto o planejado era de R$ 666,50. O bloco variável está com R$ 645,00 gastos, e não há metas definidas. |
| semOrcamento | Quanto gastei com transporte em outubro? | 1/1 | — | ok | sim | 3.3 s | Você gastou R$ 120,00 com transporte em outubro. |
| semOrcamento | Qual foi minha maior compra no mercado em outubro? | 1/1 | — | ok | sim | 4.8 s | Sua maior compra no mercado em outubro foi no dia 06/10/2026, no valor de R$ 300,00, no estabelecimento "Mercado Azul". |
| semOrcamento | Quantas vezes comprei na padaria em outubro? | 0/0 | — | ok | sim | 3.4 s | Você comprou na padaria 3 vezes em outubro. |
| dinheiroParado | Quanto gastei em outubro? | 1/1 | — | ok | sim | 3.0 s | Você gastou R$ 800,00 em outubro, tudo na categoria Mercado. |
| dinheiroParado | Quanto gastei em setembro? | 1/1 | — | ok | sim | 3.0 s | Você gastou R$ 800,00 em setembro, tudo na categoria Mercado. |
| dinheiroParado | Tenho investimentos? | 0/0 | — | ok | sim | 2.8 s | Você não tem investimentos no momento. Considere montar uma reserva de emergência ou explorar opções de renda fixa atrelada ao CDI para começar a investir. |
| dinheiroParado | Quanto gastei com mercado entre setembro e outubro? | 1/1 | — | ok | sim | 3.4 s | Você gastou R$ 1.600,00 com mercado entre setembro e outubro. |
| dinheiroParado | Qual o meu saldo no Banco Roxo? | 0/0 | — | — | sim | 0.5 s | Não tenho esse dado. |
| gastador | insights 2026-10 | 1/1 | — | — | sim | 16.6 s | 4 aceitos de 4 · Gasto acima do orçamento: Gastou R$ 1.620,00, 111,7% do planejado. No ritmo atual, fechará em R$ 1.674,00, R$ 224,00 acima do planejado. Reveja o orçamento e evite gastos extras no mês. / Delivery subiu: Delivery foi a R |
| gastador | insights 2026-09 | 1/1 | — | — | sim | 12.0 s | 3 aceitos de 3 · Gasto baixo: Gasto foi de R$ 1.390,00, ou 23,2% das entradas de R$ 6.000,00. Reveja o orçamento e defina limites para cada categoria. / Delivery subiu: Delivery foi a R$ 300,00, +20,0% em relação a agosto. Defina um limi |
| gastador | insights 2026-08 | 1/1 | — | — | sim | 6.0 s | 2 aceitos de 2 · Gasto dentro do orçamento: Gasto foi de R$ 1.350,00, que é 22,5% das entradas de R$ 6.000,00. / Mercado foi o maior gasto: Mercado Verde foi o maior gasto, com R$ 900,00 em 10/08.  |
| investidor | insights 2026-10 | 0/1 | 1 insight(s) descartado(s) | — | sim | 12.4 s | 2 aceitos de 3 · Gasto controlado: Gasto foi de R$ 1.000,00, 12,5% das entradas de R$ 8.000,00. Mantenha o gasto dentro do orçamento e revise as despesas fixas. / Renda passiva insuficiente: Renda passiva dá em média R$ 43,33 por mês, fa |
| investidor | insights 2026-09 | 1/1 | — | — | sim | 5.6 s | 2 aceitos de 2 · Gasto baixo: Gasto foi de R$ 1.000,00, 12,5% das entradas de R$ 8.000,00. / Mercado Verde foi o maior gasto: Mercado Verde foi o maior gasto, R$ 1.000,00 em 09/09.  |
| semOrcamento | insights 2026-10 | 1/1 | 1 insight(s) descartado(s) | — | sim | 6.1 s | 1 aceitos de 2 · Gasto dentro do orçamento: Gasto foi de R$ 645,00, que é 21,5% das entradas de R$ 3.000,00.  |
| dinheiroParado | insights 2026-10 | 2/2 | — | — | sim | 12.1 s | 3 aceitos de 3 · Gasto baixo: Gasto foi de R$ 800,00, ou 16,0% das entradas de R$ 5.000,00. Reveja o orçamento para ver se há espaço para mais gastos ou economia. / Dinheiro parado na conta: Há R$ 20.000,00 na conta corrente; a 100% do C |
| dinheiroParado | insights 2026-09 | 1/1 | — | — | sim | 6.5 s | 2 aceitos de 2 · Gasto dentro do orçamento: Gasto foi de R$ 800,00, 16,0% das entradas de R$ 5.000,00. / Mercado Verde foi o maior gasto: Mercado Verde consumiu R$ 800,00, igual ao total gasto no mês.  |
