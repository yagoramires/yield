# Análise funcional — `Controle de Investimentos.xlsm`

> Especificação funcional da planilha, feita para reconstruir tudo num app desktop local.
> A análise foi só de leitura (openpyxl + olevba + XML do zip); o arquivo não foi alterado.
> Valores pessoais, quantidades e IDs foram omitidos de propósito. Só aparecem contagens e nomes.
>
> Origem: template "Planilha de Controle para Ativos negociados em Bolsa" do curso *Excel para Estágio*
> (Diego Amorim, "Série de Controles para Bolsa de Valores"), que o usuário adaptou depois.

## 1. Resumo (10 linhas)

1. O usuário digita à mão as **notas de corretagem** (uma linha por ativo, C/V) nas abas `Notas` e `Notas Day Trade`.
2. A macro **Distribuir Taxas** rateia as taxas da nota (liquidação, emolumentos, corretagem, ISS, IRRF...) entre as linhas.
3. A macro **Incluir Notas** transforma cada linha num **lançamento contábil** na aba `Movimentações` (ledger único).
4. Nesse momento ela calcula o **preço médio** e grava, em cada venda, as linhas "Resultado <tipo>" e "I.R.R.F. <tipo>".
5. Outras macros mexem no ledger para eventos corporativos: bonificação, split/inplit, IPO, subscrição, troca de ticker, aporte/retirada/provento.
6. `Resumo` agrega o ledger por ativo e mostra quantidade, custo médio, custo total, cotação, valor atual e variação, além de 3 gráficos.
7. As 3 abas de IR calculam o imposto mensal: comum 15% (com isenção de 20 mil para ações), day trade 20% e FII 20%. Cada uma tem prejuízo acumulado e compensação de IRRF.
8. `DARF a Pagar` soma os 3 impostos, acumula valores abaixo de R$ 10 e calcula o vencimento (último dia útil do mês seguinte, usando `Feriados`).
9. Três abas montam os textos da **DIRPF**: `Bens e Direitos` (discriminação pronta com CNPJ e corretoras), `Operações Comuns - Day Trade` e `Operações FII`.
10. As cotações vêm de uma planilha **Google Sheets publicada (GOOGLEFINANCE)** via Power Query. Proventos, renda fixa e cripto ficam em abas manuais (`Rendimentos AAAA`, `Visão Geral`).

## 2. Fluxo de dados

```
ENTRADA MANUAL                    MACROS (VBA)                       CÁLCULO (fórmulas)                     SAÍDAS
───────────────                   ────────────                       ──────────────────                     ──────
Notas / Notas Day Trade ──► Distribuir Taxas (rateio) ──► Incluir Notas ──► Movimentações (ledger) ──┬─► Opções (lista ativos únicos) ──► Resumo ──► Visão Geral / PERCENTUAL FIIs / Rendimentos AAAA (col. posição)
                                                                                     ▲               │                                   ▲ Cotações (Power Query ← Google Sheets)
Eventos (bonif., split, IPO, subscrição, ticker, aporte) ──────── macros ───────────┘               ├─► Imposto de Renda (15%) ◄── Notas (alienações) + Ações Isentas
                                                                                                     ├─► Imposto de Renda Day Trade (20%)
                                                                                                     ├─► Imposto de Renda F.I.I. (20%)
                                                                                                     │        └──► DARF a Pagar ◄── Feriados (último dia útil)
                                                                                                     │        └──► Operações Comuns - Day Trade / Operações FII (DIRPF)
                                                                                                     └─► Bens e Direitos (DIRPF) ◄── Empresas Listadas (CNPJ/razão social)
Manual: Rendimentos 2022..2025 (proventos por mês), Visão Geral (ativos fora da bolsa), PERCENTUAL FIIs (% ideal), CALCULO DE PREÇO
```

Pontos-chave:
- **O ledger `Movimentações` é a fonte da verdade.** Todas as fórmulas de posição e de IR leem dele (Resumo ~2,2 mil refs, Bens ~2,7 mil, Opções ~4 mil). A única exceção é "Alienações", que vem de `Notas`.
- O vínculo entre notas e ledger é a coluna **ID**: a nota recebe `x` (incluída) e o ID do lançamento. O ID é `MAX(IDs de Movimentações, Notas, Notas DT) + 1`.
- O tipo do lançamento (`Tipo`) funciona como **categoria contábil**: `Ação`, `FII`, `ETF`, `BDR`, `Opção`, `Futuro`, `Termo`, `Resultado X`, `Resultado X Day Trade`, `I.R.R.F. X`, `I.R.R.F. X Day Trade`, `Provento`, `Aporte`, `Retirada`, `Subscrição`. Todo o IR é filtrado por essas strings.
- Convenção de sinais: compra tem **Quantidade +** e **Valor −** (saída de caixa); venda tem Quantidade − e Valor + (principal ao custo médio). O resultado da venda vai numa linha à parte.

## 3. Por aba

Legenda: **[E]** coluna de entrada (digitada) · **[C]** calculada · **[M]** escrita por macro.

### Instruções (visível)
Texto de ajuda do template, com links para o curso, para a planilha Google de cotações e para uma busca "lista de ações isentas de IR". Não tem lógica.

### Macros (visível)
Painel com 10 botões de macro e 3 botões de navegação (Notas, Notas Day Trade, Movimentações). Detalhes na seção 4.

### Notas — `TabelaNotas` (visível)
- [M] `Incluída` (x), `ID`. **Não digitar nessas colunas.**
- [E] `Nota` (nº da nota), `Corretora`, `Data Pregão`, `Data Liquidação`, `C/V` (validação C/V), `Tipo` (Ação/ETF/FII/BDR/Opção/Futuro/Termo), `Ticker`, `Quantidade`, `Preço`.
- [C] `Valor Operação` = Preço × Qtd. `Taxas` = soma das colunas de taxa. `Valor Líquido` = Operação + Taxas na compra e Operação − Taxas na venda.
- [M/E] `I.R.R.F.` (dedo-duro, só em vendas), `Taxa Liquidação`, `Taxa Registro`, `Taxa Termo/Opções`, `Taxa A.N.A.`, `Emolumentos`, `Taxa Operacional` (corretagem), `Taxa Execução`, `Taxa Custódia`, `Impostos` (ISS sobre corretagem), `Outros`. A macro Distribuir Taxas preenche essas colunas.
- Dados: notas de mais de uma corretora, com FII, Ação, ETF e BDR. Todas as linhas já foram incluídas.

### Notas Day Trade — `TabelaNotasDayTrade` (oculta)
Mesmo layout de `Notas`. Na venda, o IRRF day trade (1%) vai na coluna `I.R.R.F.`. **Está vazia** (só cabeçalho e uma linha de fórmula).

### Movimentações — `TabelaMovimentacoes` (oculta, 275 lançamentos)
- Colunas: `ID`, `Conta` (corretora), `Data Pregão`, `Data Liquidação`, `Descrição` (ticker ou texto), `Tipo` (categoria), `Quantidade`, `Valor`, `OBS` (histórico dos ajustes feitos por macro).
- Cabeçalho B1/D1: o usuário digita a corretora em B1 e D1 mostra `SUMIFS(Valor; Conta=B1)`, que é o **saldo de caixa da corretora**. Serve para conferir contra o extrato.
- Tipos presentes: Ação, FII, ETF, BDR, Resultado Ação/FII/ETF/BDR, I.R.R.F. Ação/FII/ETF/BDR. **Não há** Aporte, Retirada, Provento, Day Trade nem eventos (OBS vazio). Na prática, o saldo de caixa e os eventos corporativos nunca foram usados.
- Pode ser editada à mão, mas depois é preciso rodar "Organizar Movimentações" (ordena por data pregão e preenche IDs).

### Imposto de Renda — `TabelaIR` (oculta, swing trade "operações comuns")
Uma linha por mês (`Mês` = EDATE do mês anterior).
- `Alienações` = soma das **vendas de Ação** no mês, lida de `TabelaNotas` (valor bruto), menos as vendas de ações isentas (lista `Ações Isentas`, só até 31/12/2023).
- `Resultado Ação` = Σ ledger "Resultado Ação" no mês (por data pregão), menos o resultado das ações isentas.
- `Resultado ETF/BDR/Futuro/Termo/Opção` = Σ "Resultado <tipo>" no mês.
- `Lucro Isento` = (Resultado Ação, se Alienações < 20.000 e resultado > 0) + max(resultado das isentas Lei 13.043; 0).
- `Resultado Total` = Σ resultados − Lucro Isento.
- `Prejuízo a Compensar` = acumulado: se (prejuízo anterior + resultado anterior) < 0, carrega esse valor. Senão, zera.
- `Base de Cálculo` = max(Resultado Total + Prejuízo; 0). `Imposto Devido` = ARRED.BAIXO(Base × **15%**; 2).
- `I.R.R.F. no mês` = Σ "I.R.R.F. Ação/ETF/BDR/Futuro/Termo/Opção" (por **data de liquidação**).
- `I.R.R.F. Compensado` = abate o IRRF acumulado **dentro do ano-calendário** (menos o que já foi compensado), limitado ao imposto devido.
- `Imposto a pagar` = max(Devido + Compensado (negativo); 0). `Imposto Pago` [E].
- **Cobre só jan/2020 a dez/2021** (24 linhas).

### Imposto de Renda Day Trade — `TabelaIRDT` (oculta)
Mesma estrutura sem isenção: "Resultado <tipo> Day Trade", alíquota **20%**, prejuízo próprio, IRRF day trade. Também vai só de 2020 a 2021 e não tem nenhum valor.

### Imposto de Renda F.I.I. — `TabelaIRFII` (oculta)
`Resultado FII` = Σ ("Resultado FII" + "Resultado FII Day Trade") → prejuízo acumulado próprio → **20%** → compensação de IRRF ("I.R.R.F. FII" e "FII Day Trade") → a pagar. Vai de 2020-01 a 2041-11 (263 meses), por isso é a única tabela de IR que cobre 2022+.

### DARF a Pagar — `TabelaDARF` (oculta)
- `Imposto a pagar` = IR + IRDT + IRFII **da mesma linha** (junta as tabelas pela posição da linha, não pelo mês).
- `DARF a pagar`: se o acumulado ainda não pago (Σ imposto até o mês − Σ DARFs anteriores) for **> R$ 10**, gera DARF desse total. Senão, o valor rola para o mês seguinte.
- `Data de pagamento` = último dia útil do mês seguinte (VLOOKUP em `Feriados`). `Imposto pago` = soma dos pagos.
- Formatação condicional destaca os meses com DARF. Cobre só 2020–2021.

### Resumo (visível, 8.690 fórmulas)
- Colunas auxiliares A–C/J–K extraem os tickers únicos do ledger cujo Tipo ∈ {Ação, FII, ETF, BDR}, removendo o sufixo `.N`. A leitura é feita com `INDIRECT` linha a linha, com limite de **2.000 lançamentos**.
- E–H: ativo, tipo (via `Opções`), quantidade = Σ Qtd e valor investido = −Σ Valor (somando `TICKER` e `TICKER.N`).
- **M–T (tabela principal, só posições > 0, até 99 ativos):** Ativo, Quantidade, **Custo Médio = Valor Investido / Qtd**, Valor Investido, Preço Atual (`Cotações`), Valor Atual = Qtd × Preço, Variação R$, Variação %.
- U–AG: listas filtradas de ativos com prejuízo e com lucro para o gráfico de barras. O filtro por tipo fica em AM2 (validação `IntervaloTipos`; vazio = todos).
- AH–AK: valor atual por classe (Ação, FII, BDR, ETF) para o gráfico de pizza.
- AU/BD: resultado da carteira = Σ variação e % sobre o custo.
- Gráficos: (1) distribuição por ativo (`Ativos`/`ValorAtual`), (2) barras de lucro/prejuízo por ativo, (3) pizza 3D por classe. Os ranges são nomes dinâmicos `OFFSET`.
- Hoje tem 17 posições abertas.

### Bens e Direitos (visível, 7 mil fórmulas)
- [E] B1 = ano-base (está em 2025). [E] Tabela A3:C de corretoras: apelido → razão social + CNPJ (as corretoras usadas).
- G–M descobrem em **até 3 corretoras** onde cada ativo foi negociado (primeiras 3 contas distintas no ledger).
- N–Q: quantidade e custo em 31/12 do ano anterior e do ano-base, filtrados por **data de liquidação**. R indica se o ativo terminou algum dos dois anos posicionado.
- V–AN: lista final de ativos a declarar com **código de bem** (Ação=31, BDR=49, FII=73, ETF=74, outros=47 — numeração antiga da DIRPF), CNPJ e razão social (`Empresas Listadas`). Monta a **Discriminação** pronta, no formato "N Ações/Cotas de <razão> ao custo de R$ x cada – Ticker – Custodiadas na(s) corretora(s) <razão> – CNPJ", além da situação nos dois anos.

### Operações Comuns - Day Trade (oculta)
Modelo da ficha "Renda Variável" da DIRPF. Para o ano em C1 (= **2021**), puxa mês a mês das tabelas de IR: mercado à vista ações (ação+ETF+BDR − isento), opções, futuro, termo, prejuízo anterior, IRRF, IRRF DT e imposto pago. Também mostra o total de lucro isento (ficha "Rendimentos Isentos", tipo 20) e o imposto retido (ficha "Imposto Pago/Retido", item 3). Linhas de ouro e fora de bolsa ficam em branco.

### Operações Fundos Invest. Imob. (oculta)
Ficha FII da DIRPF para o ano em B1 (= 2021): resultado líquido do mês, prejuízo até o mês anterior, IR retido e imposto pago (de `TabelaIRFII`).

### Rendimentos Totais / Rendimentos Ano / Rendimentos b3 2022 (ocultas)
Cópia bruta do **extrato de movimentação da B3** (Entrada/Saída, Data, Movimentação, Produto, Instituição, Qtd, Preço unit., Valor). Movimentações: Rendimento, Dividendo, JCP. Instituições: "CLEAR CORRETORA – GRUPO XP" e "INTER DTVM". `Rendimentos Ano` está vazia (só cabeçalho). **Nenhuma fórmula lê essas abas.**

### Rendimentos 2022 / 2023 / 2024 / 2025 (2025 visível)
Grade manual **ativo × mês (jan–dez)** de proventos, separada em blocos (Dividendos Ações, JCP Ações, FIIs), com totais por mês, por ativo e geral (R1). Os valores são digitados ou somados à mão (`=a+b`). A coluna "Posição Atual" vem da quantidade em `Resumo`. `Visão Geral` lê o total de cada ano.

### Opções (oculta)
- A: lista de tipos (`TabelaOpcoes`: Ação, ETF, FII, BDR, Opção, Futuro, Termo), usada na validação e na macro de taxas.
- C–I: outra extração de ativos únicos + tipo a partir do ledger (com INDIRECT, 2.000 linhas). Alimenta `Resumo` (tipo) e `Bens e Direitos` (lista).

### Feriados (oculta)
- A–C: lista de feriados nacionais/B3 de 2001 em diante.
- E–N: para cada mês de 2001 a 2040, calcula o último dia útil: último dia → recua fim de semana → recua até 3 feriados seguidos. Usado no vencimento do DARF.

### Empresas Listadas (oculta)
720 tickers com CNPJ e razão social (ações, FIIs, BDRs). Base estática para a DIRPF.

### Ações Isentas — `AcoesIsentas` (oculta)
8 tickers (Lei 13.043/2014, art. 16, small caps de oferta pública) com a coluna "Limite" (data). Regra do comentário: compra até a data limite usa o ticker puro (isento); compra depois disso usa `TICKER.N`, que é tributável. As fórmulas só olham o ticker e o corte fixo de 31/12/2023. **A coluna "Limite" não é usada em nenhum cálculo.**

### CALCULO DE PREÇO (oculta)
Calculadora isolada de **preço-teto de FII (modelo de Gordon)**: P = D / (K − G). D = dividendo mensal × 12, K = taxa do Tesouro + prêmio de risco do FII (2–5%), G = crescimento real. Os valores são digitados e nada aponta para essa aba.

### Visão Geral (visível)
Painel consolidado por classe com custo, valor atual, resultado e variação:
- Ações e FIIs vêm de `Resumo`. Na linha Ações, o custo soma **só o tipo Ação**, mas o valor atual soma Ação + a 3ª classe da lista compacta (hoje BDR). É uma inconsistência: o resultado mostrado fica inflado.
- **Tesouro Selic** e **Pré-fixado** são valores digitados.
- **Dólar** e **BTC** usam quantidades fixas dentro da fórmula × `Cotações` (BTCUSD × DÓLAR).
- Abaixo: rendimentos por ano (2022 digitado, 2023–2025 lidos das abas), total de rendimentos, resultado de vendas acumulado (digitado), BTC (digitado) e "Resultado + Rendimentos".

### Cotações — `pub_output_csv__2` (visível)
Tabela TICKER/PREÇO carregada pela Power Query. Tem os tickers B3 da carteira, mais cripto e dólar. Só aparecem cotações dos ativos cadastrados na planilha Google; quem mantém essa lista é o autor do template.

### PERCENTUAL FIIs (visível)
Tabela de alocação de FIIs: fundo, qtd e preço (de `Resumo`), total, % da carteira, rendimento por cota (digitado), rendimento total, **setor** (digitado), % atual por setor e **% ideal** (digitado) para rebalanceamento.

## 4. Macros VBA

Dois módulos (`AbaNotas`, `AbaMovimentações`). Os módulos de planilha/workbook estão vazios. Não há eventos ativos, chamada HTTP, leitura de arquivo ou PDF: **toda entrada é por InputBox**.

| Botão (aba Macros) | Sub | O que faz |
|---|---|---|
| Incluir Notas | `incluir_nota` | Percorre `Notas` e `Notas DT` e processa as linhas sem `x`. **Swing:** se a operação abre ou reforça a posição (C com saldo ≥ 0, ou V com saldo ≤ 0, ou seja, venda a descoberto), grava 1 lançamento (Qtd ±, Valor = ∓ Valor Líquido) e, se for venda, a linha `I.R.R.F. <tipo>`. Se fecha a posição, calcula o **custo médio = −ΣValor / ΣQtd** do ativo+tipo (**todas as corretoras**) e grava 3 linhas: principal (custo médio × qtd), `Resultado <tipo>` (valor líquido − principal) e `I.R.R.F. <tipo>`. **Day trade:** a compra vira lançamento normal. A venda casa com a compra da **mesma nota, ticker e quantidade** e gera principal, `Resultado <tipo> Day Trade` e `I.R.R.F. <tipo> Day Trade`. No fim marca `x`, grava o ID e chama `organiza_movimentacoes`. |
| Excluir Nota/ID | `excluir_nota_id` | Pergunta "Nota" ou "ID". Apaga as linhas da nota (ou do ID) em Notas, Notas DT e os lançamentos com os mesmos IDs no ledger. |
| Distribuir Taxas | `preenchendo_taxas` | Pede o nº da nota e pergunta se a corretagem varia por tipo de ativo (se sim, pede a corretagem por tipo). Depois pede 12 valores: IRRF, liquidação, registro, termo/opções, ANA, emolumentos, operacional, execução, custódia, impostos (ISS), outros e IRRF DT. Rateio: **IRRF** só entre as vendas, proporcional ao valor. **Corretagem** fixa por tipo ou dividida igualmente. **ISS** proporcional à corretagem da linha. **Demais taxas** proporcionais ao Valor Operação. A última linha da nota (e a última venda) recebe o **resíduo de arredondamento**. |
| IPO | `ipo` | Lança a entrada do ativo (Qtd +, Valor = −qtd × custo unitário, OBS "IPO"). |
| Subscrição | `subscricao` | Tem 2 etapas. (1) Liquidação: lançamento "Subscrição" com o débito em dinheiro. (2) Integralização: troca o tipo do lançamento anterior para o tipo real e lança a quantidade recebida com valor 0, reusando o mesmo ID. |
| Bonificação | `bonificacao` | Pede proporção, custo atribuído, data-ex, data de disponibilidade e corretora. Qtd bonificada = ARRED.BAIXO(qtd do tipo Ação antes da data-ex × proporção). Lança a entrada (Qtd +, Valor = −custo atribuído × qtd) e uma linha `Provento` (+ mesmo valor). O caixa líquido fica zero e o custo médio sobe, como manda a RFB. |
| Split/Inplit | `split_inplit_v2` | Pede de/para e a data de corte. Lança uma linha de ajuste com Qtd = (qtd × para/de arredondado para baixo) − qtd e Valor 0, e OBS com a proporção. O custo total se mantém, então o custo médio se ajusta sozinho. |
| Mudança de Ticker | `mudanca_ticker` | Troca o ticker antigo pelo novo em Notas e no ledger e grava a OBS "De/Para/Data". |
| Organizar Movimentações | `organiza_movimentacoes` | Ordena o ledger por Data Pregão, preenche IDs vazios, formata moeda e faz autofit. |
| Aporte, Retirada e Provento | `aporte_retirada_provento` | Lançamento de caixa (Tipo = Aporte/Retirada/Provento, Descrição = ticker ou corretora, Valor). Depois chama `organiza_movimentacoes`. |
| *(sem botão)* | `split_inplit` (v1) | Versão antiga que **reescreve** quantidade e preço das notas e do ledger anteriores à data de corte. Código morto. |
| *(comentado)* | `Planilha4.Worksheet_Activate` | Preenchia `Cotações` com `HISTÓRICODEAÇÕES` (STOCKHISTORY do Excel 365), tentando hoje e os 4 dias anteriores. Está desativado. |

## 5. Fontes externas

- **Power Query** (customXml/DataMashup, 3 consultas):
  - `pub?output=csv (2)` → `Csv.Document(Web.Contents("https://docs.google.com/spreadsheets/d/e/<ID>/pub?output=csv"))` com colunas TICKER e PREÇO. Carrega a tabela `Cotações` (queryTable1, conexão 2). **É a única fonte de cotação em uso.**
  - `pub?output=csv` (conexão 1) é a mesma URL com cabeçalho quebrado (promove "ITSA4"/"10,85" como cabeçalho). Está órfã.
  - `Table 0` (conexão 3) usa `Web.Page(.../pubhtml)` e as colunas Ativo/Cotação. Está órfã.
  - A planilha Google é do autor do template e usa `GOOGLEFINANCE`. Ativo novo exige pedir a inclusão a ele por comentário. Ou seja, **dependência de terceiro**.
- **Links informativos:** normas da RFB (IN sobre renda variável, na aba IR), Lei 13.043/2014 (Ações Isentas), busca no Google por "ações isentas", curso Excel para Estágio.
- Não há chamadas de rede no VBA. O PDF da nota e o extrato B3 não são importados: tudo é digitado ou colado.

## 6. Regras fiscais implementadas

| Regra | Como está na planilha | Observação para o app |
|---|---|---|
| Preço médio | Custo médio ponderado por ativo+tipo, **consolidando todas as corretoras**. As taxas de compra entram no custo. Calculado no momento da inclusão. | Recalcular sempre em ordem cronológica, não na ordem de digitação. |
| Resultado da venda | Valor líquido da venda (já sem taxas) − custo médio × qtd. | — |
| Venda a descoberto | Suportada: saldo negativo vira "abertura" e a recompra é o fechamento. | — |
| Swing trade ações/ETF/BDR/opções/futuro/termo | 15%, base mensal, um único "pote" de prejuízo para operações comuns. | — |
| Isenção de R$ 20 mil | Se a soma das vendas de **Ação** no mês (valor bruto, sem isentas) < 20.000 e o resultado de ações > 0, esse lucro fica isento. ETF, BDR e opções não entram. | A regra está correta. O limite fixo de 20k é o da lei atual. |
| Ações isentas (Lei 13.043) | Lucro de tickers na lista, até 31/12/2023, é isento. O prejuízo delas é descartado. `.N` = lote tributável. | Coluna "Limite" ignorada. A isenção acabou em 2023. |
| Day trade | 20%, pote de prejuízo separado, IRRF 1%. | Casamento de compra e venda é frágil (mesma nota e mesma qtd). |
| FII | 20% (swing + DT juntos), pote de prejuízo próprio. | — |
| Prejuízo acumulado | Carrega indefinidamente e zera quando é absorvido. Cada categoria tem o seu (comum / DT / FII). | — |
| IRRF dedo-duro | Somado por **data de liquidação**. Compensa o imposto devido só **dentro do mesmo ano-calendário**. | A RFB permite compensar nos meses seguintes, e o saldo vai para a declaração. |
| DARF mínimo | Abaixo de R$ 10, acumula para o mês seguinte. | — |
| Vencimento DARF | Último dia útil do mês seguinte (feriados + fins de semana). | — |
| Bonificação | Custo atribuído × qtd entra no custo de aquisição. | — |
| Split/inplit | Ajusta a quantidade e mantém o custo total. | — |
| Proventos | Só controle informativo (grades manuais). Dividendos isentos e JCP (tributado na fonte) não são separados para a DIRPF. | O app deve gerar as fichas "Isentos – 09" e "Exclusiva – 10". |
| DIRPF Bens e Direitos | Posição em 31/12 por **data de liquidação**, com custo, CNPJ e discriminação automática. | Os códigos (31/47/49/73/74) são da numeração **antiga**. A DIRPF atual usa grupo+código (ex.: 03-01 ações, 07-03 FII, 07-09 ETF, 04-04 BDR). |

## 7. Abandonado / quebrado

- **IR comum, IR day trade e DARF só vão até dez/2021** (24 linhas). Há vendas de ações de 2022 a 2025 no ledger que **não passam por nenhum cálculo de IR**. Só a tabela de FII cobre 2022+. As abas DIRPF de renda variável (ano 2021) também pararam.
- `DARF a Pagar` junta IR/IRDT/IRFII pela **posição da linha**. Se uma tabela crescer e a outra não, os meses se desalinham.
- `Notas Day Trade` nunca foi usada (vazia). IR Day Trade está toda zerada.
- Abas de proventos importadas (`Rendimentos Totais`, `Rendimentos Ano` (vazia), `Rendimentos b3 2022`) não são lidas por nenhuma fórmula. `Rendimentos 2022` é lida, mas `Visão Geral` usa o total de 2022 **digitado**.
- `Rendimentos 2025`: os totais de setembro a dezembro somam um intervalo uma linha menor que os de jan–ago, então o último ativo do bloco fica fora. **Bug provável.**
- `Notas!C207` tem uma fórmula órfã com `#REF!` (resto de um copy-paste da aba Bens). Hoje ela retorna vazio, então não aparece.
- `Resumo!H` usa `ANCHORARRAY` (operador de spill `#`) em célula que não faz spill. Funciona no 365 por acaso e é frágil em outras versões.
- Duas consultas Power Query órfãs (`pub?output=csv`, `Table 0`). O macro de cotação via STOCKHISTORY está comentado.
- `split_inplit` (v1) é código morto. Na v2, a quantidade-base filtra sempre por tipo **"Ação"**, mesmo quando o usuário escolhe FII, e soma todas as corretoras mas lança em uma só. Bonificação também só considera "Ação".
- `Aporte/Retirada/Provento` e o saldo de caixa (Movimentações!D1) nunca foram usados (não há lançamentos desses tipos).
- Limites rígidos: 2.000 lançamentos (INDIRECT), 99 ativos (Resumo/Bens), 3 corretoras por ativo (Bens). Feriados vão até 2040 e cobrem no máximo 3 feriados seguidos. Se o recuo por feriado cair num domingo, não há novo ajuste de fim de semana.
- `Ações Isentas` está congelada (atualizada em 07/2021, mais as entradas de 2023). `Empresas Listadas` é estática.
- `Visão Geral` mistura fórmulas com números digitados dentro de fórmulas (quantidade de dólar/BTC, Tesouro, resultado de vendas) e precisa de atualização manual.
- `CALCULO DE PREÇO` é calculadora solta, sem vínculo.

## 8. Features que o app precisa replicar (priorizadas)

**P0 — núcleo (sem isso o app não substitui a planilha)**
1. Cadastro de **notas de corretagem** (cabeçalho: nº, corretora, data pregão/liquidação, taxas; itens: C/V, tipo, ticker, qtd, preço), com flag day trade.
2. **Rateio de taxas** por nota com as mesmas regras (IRRF só nas vendas, corretagem fixa por tipo ou igual, ISS proporcional à corretagem, demais pro-rata pelo valor, resíduo de arredondamento na última linha).
3. **Ledger de movimentações** (conta, datas, ativo, categoria, qtd, valor, obs) como fonte única, gerado a partir das notas e **recalculável**: deve reprocessar em ordem cronológica ao editar ou excluir uma nota, em vez de depender da ordem de inclusão.
4. **Preço médio** consolidado entre corretoras, resultado por venda, suporte a venda a descoberto e day trade com casamento correto (FIFO intradiário por ticker e dia, não "mesma qtd").
5. **Carteira atual** (Resumo): qtd, custo médio, custo total, cotação, valor atual, variação R$/% por ativo e por classe, filtro por tipo.
6. **Apuração mensal de IR**: comum 15% com isenção de 20k para ações e lista de isentas com data-limite; DT 20%; FII 20%; três potes de prejuízo; IRRF por liquidação compensável nos meses seguintes. **Sem limite de anos.**
7. **DARF**: consolidação mensal por mês real (não pela linha), regra do mínimo de R$ 10, vencimento no último dia útil do mês seguinte (calendário de feriados B3/nacionais), registro de pagamento.

**P1 — declaração anual e eventos**

8. **Bens e Direitos**: posição em 31/12 (por data de liquidação) do ano-base e do anterior, com o código DIRPF **atual** (grupo+código), CNPJ, razão social e discriminação gerada automaticamente com as corretoras de custódia (sem limite de 3).
9. Fichas DIRPF de **Renda Variável** (operações comuns/DT mês a mês por mercado) e **FII**, além do total de lucro isento e do IRRF retido.
10. Eventos corporativos: **bonificação** (custo atribuído), **split/inplit** (qualquer tipo, por corretora), **mudança de ticker**, **IPO**, **subscrição** (liquidação e integralização), com trilha de auditoria (OBS).
11. Cadastros de referência: corretoras (razão social/CNPJ), empresas listadas (ticker→CNPJ/razão, atualizável), ações isentas (com data-limite usada de fato), feriados.

**P2 — proventos e cotação**

12. **Proventos** por ativo e mês (dividendo, JCP, rendimento FII), com **importação do extrato de movimentação da B3** (CSV/XLSX nas colunas Entrada/Saída, Data, Movimentação, Produto, Instituição, Qtd, Preço, Valor). Fichas DIRPF de isentos (dividendos e rendimentos de FII) e de tributação exclusiva (JCP).
13. **Cotações automáticas** sem depender da planilha Google de terceiros (fonte própria para B3, dólar e cripto, com cache offline e preço manual como fallback).
14. Lançamentos de caixa (aporte/retirada/provento) e **saldo por corretora** para conciliação.

**P3 — painéis e utilidades**

15. **Visão Geral** multi-classe: ações, FIIs, ETFs, BDRs e também Tesouro/pré-fixado, dólar e cripto como ativos de verdade, não números digitados. Somatório de rendimentos por ano.
16. Gráficos: distribuição por ativo, lucro/prejuízo por ativo, pizza por classe.
17. **Alocação de FIIs por setor** com % atual × % ideal (rebalanceamento).
18. Calculadora de **preço-teto** (Gordon: D/(K−G)) por FII.
19. (Opcional, nova) Importação de **nota de corretagem em PDF** (SINACOR: Clear/XP, Inter, BTG). Hoje tudo é digitado.

Tipos de ativo em uso: **Ação, FII, ETF, BDR** (Opção, Futuro e Termo existem nas regras, mas não há operações). Renda fixa (Tesouro Selic, pré), dólar e cripto (BTC, ETH) aparecem só como valores manuais. Corretoras nos dados: **CLEAR (Grupo XP), INTER, BTG**.
