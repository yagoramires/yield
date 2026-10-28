# Renda fixa, exterior e cripto (Binance)

## Por quê

O usuário pode ter dinheiro fora da renda variável da B3 e sentir falta disso no Yield: Tesouro Direto e CDBs custodiados na B3, ações americanas e saldo em dólar numa conta no exterior, e criptomoedas numa corretora de cripto. Hoje isso só entra pelos "Ativos manuais" da Carteira: um valor digitado ou quantidade × cotação, sem aportado, sem rendimento e sem histórico. Para a renda fixa ele quer ver **quanto tem hoje e quanto aplicou/rendeu**; para a Nomad basta o valor de hoje; para a Binance, o saldo automático (e o aportado, se a API permitir).

A Pluggy está fora: a conta grátis do MeuPluggy já usa as 5 conexões.

## Objetivo

1. **Renda fixa pela B3:** importar o relatório **Posição** (valor de hoje de cada título) e passar a ler as linhas de renda fixa da **Movimentação** que hoje são ignoradas (aplicações, vendas/resgates, juros, vencimentos). Cruzando os dois: aplicado, valor de hoje e rendimento por título.
2. **Exterior:** o usuário informa ticker e quantidade de cada ação/ETF americano (e o saldo em US$). Valor = quantidade × cotação do Yahoo em US$ × dólar do dia.
3. **Cripto (Binance):** chave de API **só de leitura** da Binance, guardada no Keychain; o Yield lê os saldos e mostra quantidade × cotação em R$.

**Fora de escopo:** IR de renda fixa (retido na fonte pelo banco); renda fixa, exterior e cripto na tela Declaração IR; marcação a mercado (a B3 manda MTM vazio nos CDBs); rentabilidade × CDI por título; incluir esses ativos no gráfico "Rentabilidade em 12 meses" e no "Aportado × valor de hoje" (continuam só renda variável); renda fixa fora da B3 (poupança, caixinhas); usar as abas de Ações/ETF/Fundos/Empréstimos da Posição; qualquer integração com a Pluggy para isso.

**Seria um fracasso se:** um dado real (nome de título, emissor, ticker, quantidade, valor, chave da Binance) for parar no repositório (é público); o Yield fizer qualquer chamada à Binance que não seja leitura; juros de renda fixa entrarem nos rendimentos da Declaração IR ou no cálculo de imposto; reimportar a mesma Posição/Movimentação duplicar algo; o total do patrimônio contar o mesmo título duas vezes (B3 + ativo manual antigo).

## Restrições

- Repositório público: arquivos reais só em `planilhas/` (gitignored). Testes e fixtures com dados inventados (ex. "CDB - CDB0000AA00 - BANCO LARANJA S/A", "Tesouro Prefixado 2099", ticker americano "ZZZZ"). Nunca copiar nomes, códigos, tickers ou valores reais para código, testes, commits ou docs.
- Migrações 001–008 estão congeladas: mudanças de banco vão numa **009** nova. Antes de rodar no banco real, backup em `~/Library/Application Support/com.yagoramires.yield/antes-009-yield.db` (mesmo padrão das anteriores).
- Valores em centavos inteiros; datas ISO; meses 'YYYY-MM' (padrão do app).
- Segredos só no Keychain, via `secret_get`/`secret_set`/`secret_delete` (como `src/openfinance/secrets.ts`, com cache por sessão). Nunca pedir para o usuário colar a chave no chat.
- Rede: liberar só `https://api.binance.com/*` nas capabilities do Tauri, ao lado das que já existem.
- Ações destrutivas com confirmação na tela; nada de `window.confirm/alert/prompt`.
- UI em pt-BR, no visual das telas novas (componentes `Select`, `DateField`, `icon-btn`, `card`, `sum-row`, lucide-react).

## 1. Renda fixa pela B3

### O que os arquivos trazem (lido do arquivo real, só estrutura)

**Posição** (Área do Investidor › Extratos › Posição, Excel). Uma aba por produto; em cada aba, linhas de dados, depois linhas de total/rodapé (primeira coluna preenchida e o resto vazio, um cabeçalho repetido, e uma última linha com o total) que devem ser ignoradas. Duas abas interessam:

- **Tesouro Direto:** `Produto, Instituição, Código ISIN, Indexador, Vencimento (dd/mm/aaaa), Quantidade, Quantidade Disponível, Quantidade Indisponível, Motivo, Valor Aplicado, Valor bruto, Valor líquido, Valor Atualizado` (números como número).
- **Renda Fixa:** `Produto, Instituição, Emissor, Código, Indexador, Tipo de regime, Data de Emissão, Vencimento, Quantidade, Quantidade Disponível, Quantidade Indisponível, Motivo, Contraparte, Preço/Valor Atualizado MTM, Preço/Valor Atualizado CURVA, Preço/Valor Atualizado FECHAMENTO`. Colunas sem valor vêm como `"-"`. No arquivo real só a CURVA está preenchida.
- Outras abas (`Acoes`, `ETF`, `Fundo de Investimento`, `Empréstimos`) são ignoradas.

**Movimentação** (o mesmo relatório que o app já importa: `Entrada/Saída, Data, Movimentação, Produto, Instituição, Quantidade, Preço unitário, Valor da Operação`). Tipos de linha de renda fixa no arquivo real:

| Produto | Entrada/Saída | Movimentação |
|---|---|---|
| Tesouro … | Credito | Compra |
| Tesouro … | Debito | Venda |
| Tesouro … | Credito | Juros |
| CDB … | Credito | COMPRA / VENDA |
| CDB … | Credito | PAGAMENTO DE JUROS |
| CDB … | Debito | VENCIMENTO |
| CDB … | Debito | VENCIMENTO/RESGATE SALDO EM CONTA |

**Como casar título da Posição com o da Movimentação** (verificado no arquivo real):
- Tesouro: o `Produto` é idêntico nos dois (ex. "Tesouro Prefixado 2099"). A Posição pode ter duas linhas com o mesmo Produto (instituições diferentes); a chave é `Produto + Instituição`.
- Renda Fixa: na Movimentação o Produto vem como `"<TIPO> - <CÓDIGO> - <EMISSOR>"` (às vezes sem o emissor: `"<TIPO> - <CÓDIGO>"`); na Posição vem `Produto = "<TIPO> - <EMISSOR>"` e o código numa coluna à parte. A chave é o **código** (segundo pedaço do Produto da Movimentação, coluna `Código` da Posição).
- Reconhecer linha de renda fixa na Movimentação pelo prefixo do Produto: `Tesouro`, `CDB`, `LCI`, `LCA`, `CRI`, `CRA`, `DEB`, `LIG`, `LF`, `RDB`, sem diferenciar maiúsculas. Hoje essas linhas caem em `ignored`.

### Regras

- **Aplicado** de um título = soma das entradas de compra/aplicação − custo proporcional do que saiu (venda, resgate, vencimento). Custo médio, como na renda variável: ao vender metade da quantidade, sai metade do aplicado.
- **Recebido** = juros pagos + valor de vendas/resgates/vencimentos.
- **Valor de hoje** = da Posição mais recente importada: Tesouro → `Valor Atualizado`; Renda Fixa → primeiro preenchido entre `Valor Atualizado CURVA`, `MTM`, `FECHAMENTO`. Título que tem quantidade na Movimentação mas não aparece na Posição mais recente: valor de hoje 0 se a quantidade líquida for 0 (vencido/vendido); senão "sem valor" e aviso "importe uma Posição mais recente".
- **Rendimento** = valor de hoje + recebido − total aplicado (R$) e ÷ total aplicado (%). Vale também para títulos encerrados.
- Título que aparece na Posição mas não tem compras na Movimentação (Movimentação não cobre o início): mostra o valor de hoje; aplicado = `Valor Aplicado` da Posição quando for Tesouro, senão "aplicado desconhecido" e sem rendimento.
- **Data da Posição:** a data no nome do arquivo (`posicao-AAAA-MM-DD-…`) se existir; senão o dia do import. Guardar só o último snapshot de cada título (o histórico de snapshots não é necessário agora). Uma Posição mais antiga que a guardada não sobrescreve o valor do título (decisão minha).
- **Dedupe:** linhas de Movimentação com `sourceKey` no mesmo padrão das demais (`b3:${date}:${mov}:${produto}:${inst}:${qty}:${valor}` com `uniqueKey` para repetidas). Reimportar não duplica.
- **A verificar no arquivo real (builder):** se as duas linhas `VENCIMENTO` e `VENCIMENTO/RESGATE SALDO EM CONTA` do mesmo CDB representam o mesmo dinheiro (uma tira a quantidade, a outra credita o valor) ou dois eventos. A regra deve contar o dinheiro uma vez só. Conferir olhando os valores localmente, sem imprimir nem copiar nada para o repositório, e fixar o comportamento num teste com dados inventados. Mesma verificação para os `Juros` do Tesouro: confirmar que o cupom pago sai do `Valor Atualizado` (senão o rendimento conta o juro duas vezes).

### Onde aparece

- **Configurações › B3:** o mesmo botão de importar relatórios da B3 passa a reconhecer a Posição (pelo cabeçalho/nomes das abas, como já faz com Negociação/Proventos/Movimentação). O resumo do import ganha "N títulos de renda fixa atualizados" e, na Movimentação, "N movimentações de renda fixa".
- **Carteira:** seção **Renda fixa** com uma linha por título ativo: nome (Produto limpo), emissor (ou "Tesouro Nacional"), indexador · vencimento, aplicado, valor de hoje, rendimento em R$ e %, e a data da Posição ("valor de 26/10"). Um link "ver encerrados" mostra os vencidos/vendidos com o rendimento final.
- **Resumo de investimentos:** a renda fixa entra no Patrimônio, no aportado e no Resultado; na barra "Por classe" a classe Renda fixa passa a ter variação real (não mais "valor informado"). Maiores posições incluem títulos.
- **Proventos:** juros de Tesouro e CDB ficam nas movimentações de renda fixa (tabela própria, não na de proventos, para não vazar para o IR; decisão minha) e aparecem como um tipo próprio, **"Juros RF"**, na lista e no gráfico por mês, separado de Rendimento/Dividendo/JCP. Ficam **fora** da tela Declaração IR e de qualquer cálculo de imposto. Entram na "Renda passiva" do Resumo (decisão minha: são renda recorrente).
- **Ativos manuais antigos de renda fixa:** não são apagados nem mesclados automaticamente. Se houver ativo manual da classe Renda fixa depois de importar uma Posição, a Carteira mostra um aviso "você tem N ativos manuais de renda fixa; se já vieram da B3, exclua para não contar duas vezes" com o link para cada um.

## 2. Exterior

- Novo tipo de ativo manual **"Exterior"** (ações/ETFs/REITs americanos): ticker (como no Yahoo, ex. "ZZZZ") e quantidade (aceita fração). Valor = quantidade × cotação Yahoo em US$ × `BRL=X`. Mostrar também o valor em US$.
- Saldo em dólar continua no tipo **"Dólar"** que já existe (quantidade × `BRL=X`); o formulário passa a preencher `BRL=X` sozinho quando a classe é Dólar.
- Sem aportado nem rendimento (o usuário aceitou só o valor de hoje). Na barra por classe aparece "valor de hoje" no lugar da variação.
- Cotações: os símbolos entram no refresh do Yahoo que já existe (`DataProvider`, junto com os `quoteSymbol` dos manuais). Sem cotação: "sem cotação" e fica fora do total, como os demais.
- Banco: a migração 009 refaz `manual_assets` (o CHECK de `asset_class` não aceita classe nova) acrescentando a classe `exterior` e uma coluna `currency` ('BRL' padrão, 'USD' para exterior), preservando ids e `source_key`.

## 3. Cripto (Binance)

- **Configurações › Binance:** guia curta de como criar a chave no site da Binance com **só "Enable Reading"** ligado (sem trade, sem saque; restrição de IP opcional) e campos para API Key e Secret Key. Salvar grava no Keychain; há "Remover chave". Mesmo comportamento de `secrets.ts` (lê uma vez por sessão, falha não fica em cache).
- **Só leitura, por construção:** um cliente com lista fechada de chamadas `GET` permitidas, no mesmo padrão do `ALLOWED` de `src/openfinance/pluggy.ts`; qualquer outra coisa lança erro antes de sair da máquina. Assinatura HMAC-SHA256 com WebCrypto, `timestamp` + `recvWindow`, header `X-MBX-APIKEY`.
- **Saldos:** conta spot (`GET /api/v3/account`) e, se a chave permitir, Simple Earn flexível/travado. Cada moeda com saldo > 0 vira uma linha de cripto com quantidade e cotação Yahoo `<MOEDA>-BRL` (BTC-BRL já é usada); sem cotação: mostra a quantidade e "sem cotação". Stablecoins e BRL parados contam pelo `<MOEDA>-BRL` também.
- **Aportado (se der):** o builder investiga quais endpoints de histórico refletem como o usuário compra (compra com PIX/cartão, Convert, ordem no spot) e, se houver um caminho confiável, calcula o aportado em R$ por moeda; senão a linha mostra "aportado desconhecido" e o usuário pode informar o aportado à mão. Não é bloqueante para entregar os saldos.
- **Quando atualiza:** ao abrir o app e num botão "Atualizar" (mesma ideia do Sincronizar da Pluggy). Erro de rede ou chave inválida vira aviso na tela, nunca some calado; os últimos saldos ficam guardados no banco e mostram "saldo de dd/mm hh:mm".
- **Onde aparece:** na Carteira, seção Cripto com origem "Binance"; entra no Patrimônio e na classe Cripto do Resumo. Ativos manuais de cripto antigos recebem o mesmo aviso de possível duplicidade da renda fixa.

## Totais com itens sem aportado

Exterior, cripto sem aportado e títulos com "aportado desconhecido" somam no **Patrimônio**, mas ficam fora do **aportado** e do **Resultado** (senão o resultado subiria pelo valor inteiro deles). O card de Patrimônio mostra "N itens sem aportado" quando houver (decisão minha).

A Pluggy só traz contas e transações para o Yield (não investimentos), então não há risco de duplicidade por ela.

## Deixado para o builder

- Esquema exato das tabelas novas (snapshot da Posição, movimentações de renda fixa, saldos da Binance) dentro da 009.
- Layout fino das seções novas da Carteira, dentro do visual existente.
- Ordem de entrega: renda fixa primeiro (já tem os arquivos), depois exterior, depois Binance.
