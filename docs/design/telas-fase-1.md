# Telas aprovadas da fase 1 (Investimentos)

Aprovadas pelo dono do projeto em 26/10/2026, sem ajustes. O mockup é `telas-fase-1.html` (abrir no navegador; números fictícios). As Tasks 14–18 constroem cada tela seguindo esse arquivo.

## Comum a todas

- Navegação A: barra lateral com Últimos gastos, Orçamento mensal (subseções com "em breve", desabilitadas), Investimentos (Carteira, Notas, Proventos, Imposto) e Sistema (Configurações).
- Tema Grafite (tokens em `src/theme.css`). Valores positivos em `--accent`, negativos em `--negative`, avisos em amarelo (`#ffcf5c` sobre `#241e0c`).

## Carteira

- Cabeçalho com a hora da cotação do Yahoo e o aviso de atraso de ~15 min; botões "Atualizar cotações" e "+ Ativo manual".
- Três cartões: Patrimônio (com o custo embaixo), Resultado (R$ e %), Proventos 12 meses (com a média mensal).
- Tabela por ativo, agrupável por classe (linha de subtotal por classe com % do patrimônio) ou lista única: Ativo, Qtd, Preço médio, Custo, Cotação, Valor atual, Var. R$, Var. %.
- Seção "Ativos manuais": Ativo, Classe, Qtd, Cotação, Valor, Atualizado (com etiqueta "à mão" ou "Yahoo"), editar.

## Notas

- Botões: "+ Nota", "Importar PDF da Clear", "Operação sem nota", "Evento corporativo".
- Lista à esquerda (alternando Notas/Eventos): Pregão, Nº, Corretora com etiqueta de origem (PDF, manual, sem nota, planilha), Líquido.
- Painel da direita: formulário da nota (Nº, Corretora, Pregão, Liquidação; itens C/V, Tipo, Ticker, Qtd, Preço, Total, Taxa rateada; taxas Liquidação, Registro, Emolumentos, Operacional, ISS, IRRF, Outros; líquido; Excluir com confirmação, Cancelar, Salvar).
- Rascunho do PDF: quantas notas o arquivo tem (paginado), aviso de especificações sem ticker, seletor de ticker com "lembrar" (apelido), taxas lidas e conferência com o líquido, aviso de nota duplicada pulada, Descartar / Salvar nota.
- Eventos: lista (Data, Evento, Ativo, Qtd, Origem; "informar custo" em bonificação sem custo) e formulário de novo evento. Operação sem nota usa o mesmo formulário da nota, sem nº e sem taxas.

## Proventos

- Botões "Importar extrato da B3" e "+ Provento".
- Cartões com o total por ano.
- Filtros: ticker, tipo (Todos, Dividendo, JCP, Rendimento) e ano.
- Lista agrupada por mês (com total do mês): data, ticker, tipo, origem (B3, planilha, manual), valor.
- Nota explicando que a planilha só traz o total do mês e que o extrato da B3 o substitui.

## Imposto

- Aviso fixo: "Cobre só renda variável na B3 (ações, FIIs, ETFs, BDRs). Day trade não é calculado: aparece como aviso."
- Cartões: DARF em aberto (meses vencidos, código 6015), prejuízo a compensar (comum e FII), vendas de ações isentas no ano.
- Tabela por mês: Mês, Vendas ações, Resultado comum, Isento, Resultado FII, IR devido, IRRF, DARF, Vence, Situação, ação.
- Situações: sem imposto, acumulado (< R$ 10), a vencer, em aberto (linha em destaque vermelho), pago (com data, "desfazer"), pago a menor (com o que falta, "Complementar"), e a etiqueta "incompleto" com a explicação embaixo da tabela.
- "Marcar como pago" pede data e valor pago.

## Configurações

- Texto: tudo fica neste computador; só as cotações vêm do Yahoo.
- Quatro cartões: Importar planilha antiga (com o resumo da última importação e avisos), Importar extrato da B3 (resumo, eventos aplicados e o que revisar à mão), Backup (Exportar / Importar com confirmação e cópia de segurança), Cotações (intervalo, atualizar agora, última atualização com ok/falhas).
