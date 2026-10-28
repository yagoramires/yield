# Declaração de IR (investimentos)

## Por quê

A planilha antiga tinha uma aba ("Bens e Direitos") que montava, para o ano escolhido, a ficha de cada ativo e a discriminação pronta para colar no programa da Receita. Junto com as abas de rendimentos e de imposto mensal, era o que o usuário usava para declarar. O Yield já tem os dados (notas/negociações da B3, proventos, cálculo mensal de imposto e DARFs), mas não monta a declaração. Mockup aprovado: `.superpowers/brainstorm/…/declaracao-v3.html` (não versionado).

## Objetivo

Uma tela que, para um ano-calendário, entrega tudo o que vai na declaração sobre investimentos em bolsa, pronto para copiar campo a campo: Bens e Direitos, Rendimentos (isentos e tributação exclusiva) e Renda variável mês a mês.

**Fora de escopo:** gerar o arquivo .DEC ou preencher o programa da Receita; renda fixa, cripto e ativos manuais (não têm custo histórico no app); day trade (o app não separa); tributação de dividendos acima de R$ 50 mil/mês (Lei 15.270, vale para o ano-calendário 2026 em diante); JCP declarado e não pago (grupo 99/07); opções.

**Seria um fracasso se:** a situação em 31/12 divergir do custo que a Carteira/Imposto usam; um ativo que estava na carteira em 31/12 de um dos dois anos ficar de fora; algum dado real do usuário for parar no repositório (é público).

## Tela

Rota nova **"Declaração IR"** na seção Investimentos do menu. Visual igual ao das telas novas (Lançamentos, Categorias, Resumos).

- **Cabeçalho:** "Declaração de IR", setas para trocar o **ano-calendário** (padrão: ano atual − 1; vai do ano da primeira negociação até o ano atual), "declaração entregue em {ano+1}", e o botão **Copiar todas as discriminações**.
- **4 números:** Bens em 31/12/{ano} (soma da situação, com a do ano anterior embaixo e a quantidade de ativos); Rendimentos isentos (09 + 26 + 20); Tributação exclusiva (JCP); DARF pago no ano (principal dos pagamentos dos meses do ano).
- **Aviso amarelo** quando algum ativo do ano não tem CNPJ, ou alguma corretora usada não tem cadastro: "Falta o CNPJ de N ativos (AAAA3, …)" + link "Completar cadastro" (abre a aba Cadastro).
- **Abas** no botão segmentado (mesmo do Tudo/Contas/Cartões): Bens e Direitos · Rendimentos · Renda variável · Cadastro (com o número de pendências).

### Bens e Direitos

Duas colunas (empilham em ≤ 900px, painel em cima quando há seleção).

- **Esquerda:** cartões por classe (Ações, FIIs, ETFs, BDRs), cabeçalho "Ações · Grupo 03 · Código 01" e o total de 31/12. Uma linha por ativo que tinha posição em 31/12/{ano−1} **ou** 31/12/{ano}: quadradinho com o ticker (cor da classe, como no Resumo), ticker, razão social (ou "CNPJ não cadastrado" em amarelo) · quantidade em 31/12/{ano}, e à direita a situação em 31/12/{ano} com "era X" de {ano−1}. Ordem: valor desc. Clicar seleciona (borda/realce como o bloco escolhido em Categorias).
- **Direita (painel do ativo selecionado; o primeiro vem selecionado):** um campo por linha, cada um com botão de copiar (o ícone vira ✓ por 1,5 s): Grupo / Código (texto da Receita, ex. "03 – Participações societárias / 01 – Ações"), Localização ("105 – Brasil"), CNPJ, Código de negociação, Situação 31/12/{ano−1}, Situação 31/12/{ano}. Embaixo, a discriminação num bloco monoespaçado e o botão **Copiar discriminação**; rodapé "custo médio, não valor de mercado".

**Discriminação** (mesmo texto da planilha):
- com posição em 31/12/{ano}: `{qtd} {Ações|Cotas} de {RAZÃO SOCIAL} ao custo de R$ {preço médio com 4 casas} cada - Ticker: {TICKER} - Custodiadas na corretora: {RAZÃO} - CNPJ: {CNPJ}`; com mais de uma corretora: `Custodiadas nas corretoras: {A} - CNPJ: {x} e {B} - CNPJ: {y}`. "Ações" só para a classe Ação; o resto é "Cotas".
- zerada em 31/12/{ano} (vendida no ano): `Posição zerada em 31/12/{ano}. Em 31/12/{ano−1}: {qtd} {Ações|Cotas} de {RAZÃO} - Ticker: {TICKER}`.
- sem cadastro, o pedaço que falta vira `[CNPJ não cadastrado]` / `[razão social não cadastrada]`, para ficar óbvio ao colar.

**Copiar todas:** blocos separados por linha em branco, cada um `{TICKER} ({grupo}/{código})` + a discriminação.

**Números:** quantidade e custo em 31/12 de cada ano vêm do mesmo replay usado pela Carteira (`replay(trades até a data, eventos até a data)`, `totalCostCents`). Preço médio = custo/quantidade. **Corretoras do ativo:** as que têm saldo positivo do ticker em 31/12/{ano} (compras − vendas daquela corretora até a data); se nenhuma (posição zerada), as que negociaram o ticker até 31/12/{ano−1}.

### Rendimentos

Duas colunas: isentos à esquerda, tributação exclusiva à direita. Cartões por linha da Receita, com o total no cabeçalho; uma linha por fonte pagadora (agrupa por CNPJ; sem CNPJ, por ticker) com ícone, razão social, "CNPJ · tickers", valor e botão de copiar (copia o valor). Proventos com data de pagamento dentro do ano.

| Tipo do provento | Ficha | Linha |
| --- | --- | --- |
| Dividendo | Isentos | 09 – Lucros e dividendos recebidos |
| Rendimento (FII) | Isentos | 26 – Outros (rendimentos de FII) |
| lucro de vendas de ações até R$ 20 mil no mês (`exemptProfitCents` do imposto mensal) | Isentos | 20 – Ganhos líquidos em operações no mercado à vista de ações… (um total do ano, sem pagadora) |
| JCP | Tributação exclusiva | 10 – Juros sobre capital próprio |

### Renda variável

Cartão "Operações comuns" e cartão "Fundos imobiliários", uma linha por mês **com operação** no ano (meses sem venda não aparecem; se nenhum, "Nenhuma venda de … em {ano}"). Colunas: Mês, Resultado, Prejuízo a compensar (do mês anterior), IR na fonte (dedo-duro), Imposto a pagar, DARF pago. Tudo de `computeTax` (`TaxMonth.comum`/`.fii`) e dos `darfPayments`, os mesmos da tela Imposto.

### Cadastro

Duas listas editáveis (linha vira formulário inline ao clicar no lápis, como as regras de Categorias):
- **Empresas e fundos:** ticker, razão social, CNPJ. Mostra primeiro os tickers usados no ano sem cadastro (pendências), depois os demais usados pelo usuário. Botão **Importar da planilha**: escolhe um .xlsx/.xlsm; lê a aba "Empresas Listadas" (colunas Ticker, CNPJ, Razão social) e, se existir, o bloco de corretoras da aba "Bens e Direitos" (colunas Corretora, Razão Social, CNPJ a partir do cabeçalho "Corretora"). Só **acrescenta** quem ainda não está cadastrado (o que o usuário editou à mão não é sobrescrito); mostra "N empresas e M corretoras importadas · K já existiam".
- **Corretoras:** cada valor distinto de `trade.broker` (e `dividend.broker`), com razão social e CNPJ.

CNPJ validado (14 dígitos + dígitos verificadores) e salvo formatado `00.000.000/0000-00`; razão social não vazia. Erros em pt-BR na própria linha.

## Dados

- **Migração 008** (`008_cadastro_ir.sql`): `CREATE TABLE issuers (ticker TEXT PRIMARY KEY, name TEXT NOT NULL, cnpj TEXT NOT NULL)` e `CREATE TABLE brokers (code TEXT PRIMARY KEY, name TEXT NOT NULL, cnpj TEXT NOT NULL)`; `schema_version` 8. Registrar em `lib.rs`, `client.ts`, `testDb.ts`; asserções de versão nos testes. Migrações anteriores não podem ser editadas.
- Repositório (`src/db/irRepo.ts`): `loadCadastro(db)`, `saveIssuer`, `saveBroker`, `importCadastro(db, { issuers, brokers })` (só insere os que faltam; devolve contagens).
- Leitura da planilha em `src/import/cadastroPlanilha.ts` (usa o `xlsx` que o projeto já tem). Nada da planilha vai para o repositório: testes com fixture sintética.
- Os códigos e textos da Receita ficam numa tabela só (`src/domain/declaracao.ts`), comentada com a fonte e o ano, para trocar fácil.

## Testes

Lógica pura em `src/domain/declaracao.ts`, com fixtures inventadas: lista de bens do ano (entra quem tinha posição em qualquer dos dois 31/12; vendido no ano aparece zerado), situação e preço médio batendo com o replay, corretoras por saldo, texto da discriminação (uma/duas corretoras, ação × cota, zerada, sem cadastro), rendimentos agrupados por pagadora e mapeados para 09/26/10, linha 20 somando o lucro isento do ano, meses de renda variável só com operação, validação de CNPJ. Repositório: importar não sobrescreve edição manual. Leitura da planilha com um workbook gerado no teste. Sem testes de UI.

## Decisões da revisão (do autor, não do usuário do app)

- **Códigos dos bens:** Ação 03/01 ("03 – Participações societárias / 01 – Ações"); FII 07/03 ("07 – Fundos / 03 – Fundos de Investimento Imobiliário"); ETF 07/09 ("07 – Fundos / 09 – Demais fundos de índice de mercado (ETF)"); BDR 04/04 ("04 – Aplicações e investimentos / 04 – Ativos negociados em bolsa no Brasil (BDR…)"). Tudo que não é ação usa "Cotas", como a planilha. Tabela única e comentada, para trocar se o programa da Receita mudar.
- **Mudança de ticker:** um ativo é a cadeia de tickers ligada pelos eventos `mudanca_ticker` até o fim do ano; aparece com o ticker de 31/12/{ano} e "era X" soma a posição do ticker antigo em 31/12/{ano−1}. O cadastro procura o CNPJ pelo ticker atual e, se não achar, pelos antigos.
- **Corretoras:** pelo saldo de compras − vendas por corretora até a data, olhando todos os tickers da cadeia; quantidade que veio de bonificação/desdobramento (sem corretora) não muda quem custodia. Se nenhuma tiver saldo positivo, as que negociaram a cadeia.
- **Lucro isento (linha 20):** `comum.exemptProfitCents` já é só de ações (o cálculo filtra `assetType === 'Ação'`); ETF e BDR não têm isenção.
- **DARF pago:** por mês de competência (o mês da operação, `DarfPayment.month`) dentro do ano, somando o principal — é o que a ficha mensal pede, mesmo que o DARF de dezembro seja pago em janeiro.
- **JCP:** o valor guardado é o recebido (relatório de proventos da B3 traz o líquido); vai na linha 10 como está.
- **Pendências do cadastro:** todo ticker que aparece no ano (em Bens ou em Rendimentos) sem razão social/CNPJ, e toda corretora usada pelos bens do ano sem cadastro. Rendimentos de pagadora sem CNPJ agrupam pelo ticker e aparecem com "CNPJ não cadastrado".
- **Chave da corretora:** o texto de `trade.broker` como está (`brokers.code`); na importação da planilha, a coluna "Corretora" casa sem diferenciar maiúsculas e acentos com algum `trade.broker` existente; as que não casam são ignoradas e entram na contagem "não reconhecidas". Proventos sem corretora não precisam de cadastro.

## Decidido pelo construtor

Nomes de componentes, divisão em arquivos, CSS (reaproveitando `kpis`, `sem-alert`, `seg`, `day-card`/`side-card`, `tk-av`, `icon-btn` etc.), ícones, o texto exato dos rótulos "Grupo/Código" da Receita.
