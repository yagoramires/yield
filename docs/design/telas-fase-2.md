# Telas aprovadas da fase 2 (Orçamento mensal)

Aprovadas pelo Yago em 27/10/2026. O mockup é `telas-fase-2.html` (números e nomes fictícios). Na revisão, o "Salário PJ" fixo virou **Fontes de renda**.

## Orçamento › Mês atual

- Cabeçalho: título, mês com setas, botão "Criar <mês seguinte>" (só quando o mês seguinte ainda não existe).
- Cartões: Entradas (nº de linhas), Saídas (nº de linhas e quanto é investimento), Saldo do mês (entradas − saídas).
- "Planejado × gasto real até agora": gasto real do mês (mesma regra do Resumo de gastos) contra o gasto planejado, que exclui as saídas ligadas a categorias que não contam como gasto (investimento, transferência, fatura); barra com a marca de quanto do mês já passou.
- "Por categoria": planejado × real por categoria ligada; barra vermelha quando o real passa do planejado.
- "Sugestões dos seus gastos": assinaturas e parcelas, com Aceitar / Ajustar / Descartar e o aviso "nada entra no plano sem você aceitar".
- Entradas: cada uma usa uma **fonte de renda** (o valor acompanha a fonte; a fonte PJ mostra bruto → descontos → líquido) ou é um **valor avulso**.
- Saídas: nome, ↻ quando recorrente, categoria, valor, editar/apagar. Edição em linha: nome, valor, parcela "n/total", categoria, recorrente; a parcela avança sozinha no mês seguinte e some depois da última. Apagar pede confirmação na tela ("Os outros meses não mudam").

## Mês ainda sem plano

- "<Mês> ainda não tem plano", com "Copiar de <mês anterior>" (só linhas recorrentes; diz quantas) e "Começar vazio"; atalho para importar a planilha em Configurações.

## Configurações

- **Importar planilha de orçamento**: aba "Finanças" (.xlsx); reimportar pula o que já existe e não mexe no que foi mudado no app; resumo com meses, linhas, já existentes e a fonte PJ criada a partir da calculadora da planilha.
- **Fontes de renda**: lista (fonte, tipo, bruto, líquido/mês, editar, apagar) e "+ Fonte de renda". Tipo **PJ**: bruto, pró-labore % do bruto, IRPJ % do bruto, INSS % do pró-labore, contabilidade R$, outros descontos R$, com o líquido calculado na hora. Tipo **valor fixo**: só o líquido do mês. Mudar uma fonte recalcula este mês e os próximos; meses passados ficam como estão. Apagar uma fonte mantém as entradas que a usavam, com o último valor.
