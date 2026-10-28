# Carteira por classes e Resumo com tudo junto

## Por quê

Com a 0.4.0 o Yield passou a ter renda fixa da B3, exterior (Nomad), cripto (Binance) e dólar, mas eles ficaram "pendurados": na Carteira, em seções soltas abaixo da tabela de renda variável (o dono não achou a cripto); no Resumo, só dentro de "Por classe". O dono acha a Carteira "horrível" e quer ver tudo junto. Mockups aprovados (não versionados): `.superpowers/brainstorm/52643-1793156683/content/carteira.html` (direção **C**) e `resumo.html` (itens **1, 2 e 3**).

## Objetivo

1. **Carteira, direção C:** classes à esquerda, posições da classe escolhida à direita, todas as classes no mesmo lugar e cada posição no mesmo formato.
2. **Resumo de investimentos:** faixa "onde está seu dinheiro" com 5 blocos; aportado × valor de hoje empilhando bolsa e renda fixa; juros da renda fixa visíveis em proventos e na renda passiva.

**Fora de escopo:** rentabilidade × CDI/Ibovespa para renda fixa, exterior e cripto (o app não tem histórico de preço deles; o gráfico continua só bolsa); câmbio histórico do exterior; mudanças no modelo de dados (nenhuma migração nova); telas Notas, Proventos, Imposto, Declaração.

**Seria um fracasso se:** algum valor mudar em relação ao que a 0.4.0 calcula (é só apresentação; `buildPortfolio`/`rfHoldings` continuam a fonte); alguma ação existente da Carteira sumir (preço manual, remover preço manual, ativo manual criar/editar/excluir, ver encerrados da renda fixa, atualizar Binance, informar aportado da cripto, avisos de duplicidade, aviso do câmbio no exterior, estado vazio que manda importar da B3); dado real entrar no repositório.

## Restrições

- Repositório público: testes com dados inventados (AAAA3, Banco Laranja, ZZZZ…). Commits sem Co-Authored-By.
- Visual das telas novas (Lançamentos, Categorias, Resumos): `card`, `sum-row`, `kpis`, `Select`, lucide-react, cores de `classColor`, tabular-nums. Sem `window.confirm`; destrutivo com confirmação na tela.
- O olhinho (`useHideValues`) vale no Resumo de investimentos, inclusive nos blocos novos.
- Larguras estreitas (≤ 900px): as duas colunas da Carteira empilham (classes em cima).

## 1. Carteira (direção C)

- **Cabeçalho:** "Carteira", hora das cotações, botões ↻ Atualizar cotações e + Ativo (abre o formulário de ativo manual que já existe).
- **4 números:** Patrimônio (aportado embaixo), Resultado (R$ e %; mesmas contas do Resumo: renda variável cotada + `otherGainCents`/`otherCostCents`), Proventos + juros 12 meses (média/mês), Sem aportado (`noCostCount` itens, "fora do resultado"; se 0, mostra "todos com aportado").
- **Coluna esquerda, uma linha por classe com valor:** Ações, FIIs, ETFs, BDRs, Renda fixa, Exterior, Cripto, Dólar, Outros (só as que existem), na ordem de valor. Cada linha: quadradinho da cor, nome, % do patrimônio, total, resultado % (verde/vermelho) ou "sem aportado", e uma barra fina proporcional à maior classe. Clicar seleciona (realce igual ao bloco escolhido em Categorias); começa na maior. Renda variável sem cotação: aparece na classe dela com "sem cotação".
- **Coluna direita, a classe escolhida:** título com nº de itens, total e resultado R$ · %; depois as posições, uma por linha, todas no mesmo grid: avatar (2–4 letras na cor da classe), nome + linha de detalhe, valor de hoje + % da classe, resultado R$ + %, custo/aplicado/aportado. Detalhe por tipo:
  - renda variável: "qtd × cotação · médio R$ x"; ações por linha: preço manual / remover preço manual (como hoje);
  - renda fixa: "emissor · indexador · vence dd/mm/aaaa", "valor de dd/mm", tag "importe uma Posição mais recente"; no fim, "ver encerrados (N)";
  - exterior: "qtd × US$ x", valor em R$ com "US$ y" embaixo, resultado em US$; aviso do câmbio (o texto atual) no rodapé da classe; editar/excluir;
  - cripto: "qtd BTC", cabeçalho da classe com "Binance · saldo de dd/mm hh:mm · ↻", erro/aviso do Earn, aportado clicável para informar (como hoje);
  - dólar, outros e manuais de renda fixa/cripto: valor informado ou qtd × cotação; editar/excluir.
- **Avisos de duplicidade** (manual × B3/Binance) aparecem no topo da classe correspondente.
- **Estado vazio** (nada em nenhuma classe): o cartão atual que manda importar da B3 / Ir para Configurações.
- A tabela antiga (agrupar por classe / lista única) sai.

## 2. Resumo de investimentos

1. **Faixa "onde está seu dinheiro"** logo abaixo dos 4 números: blocos Bolsa (Ação+FII+ETF+BDR), Renda fixa (B3 + manuais de renda fixa), Exterior, Cripto (Binance + manuais de cripto), Dólar — só os que têm valor. Cada bloco: total, resultado (R$ · %; exterior em US$; "sem aportado" quando não houver), barra com o % do patrimônio e uma linha curta de contexto (Bolsa: "ações, FIIs, ETFs, BDRs"; Renda fixa: "N títulos"; Exterior: "US$ x"; Cripto: "Binance, hh:mm"; Dólar: "dólar R$ x"). Clicar abre a Carteira já com aquela classe selecionada (Bolsa → Ações).
2. **Aportado × valor de hoje:** duas áreas empilhadas por mês, bolsa (o `investedByMonth` atual) e renda fixa (aplicado em aberto no fim de cada mês, a partir das movimentações de renda fixa), e o ponto de hoje com o patrimônio inteiro (inclui exterior, cripto, dólar). Legenda dizendo isso. Sem cotação em algum ativo: o ponto de hoje some, como hoje.
3. **Juros da renda fixa:** o gráfico de proventos por mês já tem a série "Juros RF" — manter e garantir a legenda; o card **Renda passiva** mostra a barra dividida em proventos e juros e o texto "proventos R$ x/mês · juros da renda fixa R$ y/mês · gasto R$ z/mês · faltam …".

## Decisões tomadas na revisão do documento (minhas)

- **Resultado igual nas duas telas:** um cálculo só, no `Portfolio` (renda variável cotada + `otherGainCents`; base = custo cotado + `otherCostCents`), usado pela Carteira e pelo Resumo. Os números da 0.4.0 não mudam; só deixam de ser calculados em dois lugares.
- **Renda fixa por mês (item 2):** função nova no domínio que, para o fim de cada mês, aplica as mesmas regras de `rfHoldings` só às movimentações até aquela data e soma o **aplicado em aberto** (custo médio: aplicação soma, venda/resgate/vencimento tira a parte proporcional; juros não entram). Não usa a Posição (não há histórico dela).
- **Faixa do Resumo:** valores em R$. Exterior mostra o resultado em US$ (soma do ganho em US$ ÷ aportado em US$ dos que têm aportado); a % do patrimônio é em R$. Dólar usa o mesmo valor da Carteira (cotação × quantidade ou valor informado).
- **Clique no bloco:** a Carteira recebe a classe inicial por prop e remonta com `key` (como Proventos com o mês). Bolsa abre a maior das quatro classes da bolsa. Classe sem itens cai na maior classe.
- **Larguras estreitas:** CSS (media query), sem JS.
- **Atualizar:** o ↻ do cabeçalho continua só para cotações; a Binance mantém o próprio ↻ no painel de Cripto.

## Deixado para o builder

- Divisão em componentes/arquivos (sugestão: `src/pages/carteira/` com a coluna de classes e um painel por tipo).
- Como a Carteira recebe a classe inicial vinda do Resumo (padrão do `initialMonth` de Proventos).
- Ordem de entrega: Carteira, depois Resumo.
