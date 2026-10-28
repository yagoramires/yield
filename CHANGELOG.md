# Changelog

O que mudou em cada versão do yield. O app avisa e se atualiza sozinho quando sai uma versão nova.

## Próxima versão

### Melhorias
- **Carteira nova**: classes à esquerda (Ações, FIIs, ETFs, BDRs, Renda fixa, Exterior, Cripto, Dólar) com o peso, o total e o resultado de cada uma; à direita, as posições da classe escolhida, todas no mesmo formato (quanto tem, valor de hoje, resultado e custo). Tudo num lugar só — renda fixa, cripto e exterior não ficam mais escondidos no fim da página.
- **Resumo de investimentos com tudo junto**: faixa "onde está seu dinheiro" (Bolsa, Renda fixa, Exterior, Cripto, Dólar) que abre a Carteira na classe; o gráfico de aportado soma a renda fixa aplicada mês a mês; a renda passiva separa proventos e juros da renda fixa; "Por classe" com as mesmas contas da Carteira.

- **ETF de renda fixa** (ex. IMAB11): as compras que a B3 lista no mercado "Renda Fixa" entram pela Negociação, aparecem na classe Renda fixa da Carteira e ficam fora da apuração mensal e do DARF (o imposto é retido na fonte). Reimportar uma Negociação mais nova completa os dias já importados com as operações que faltavam.

### Correções
- **Assinaturas**: a cobrança do mês ainda pendente no cartão conta como paga; a assinatura não aparece mais como "Atrasada".

## 0.4.0

### Novidades
- **Renda fixa da B3**: importe a **Posição** da Área do Investidor junto com a Movimentação e a Carteira mostra cada título (Tesouro, CDB, LCI/LCA…) com aplicado, valor de hoje e rendimento; os vencidos ficam em "ver encerrados". A renda fixa entra no patrimônio, no resultado e nas classes do Resumo.
- **Juros da renda fixa** aparecem em Proventos e no gráfico por mês como "Juros RF", e contam na renda passiva — sem entrar na declaração de IR nem no imposto.
- **Binance**: com uma chave só de leitura (Configurações › Binance), o Yield lê os saldos de cripto, inclusive do Simple Earn. O aportado de cada moeda você informa na Carteira.
- **Ações do exterior**: novo tipo de ativo manual "Exterior (US$)", por ticker, quantidade e aportado em dólar (opcional), convertido pelo dólar do dia, com o rendimento em US$. O ativo "Dólar" já vem com a cotação certa.
- **Olhinho nos resumos**: um botão esconde todos os valores em reais das duas telas de Resumo.

### Melhorias
- **Importação da Movimentação da B3** mais esperta:
  - **Leilão de Fração** vira venda automática (a fração sai da posição e entra na apuração do imposto).
  - **Resgate** vai para revisão com a explicação: pode ser liquidação do fundo (venda) ou a parte em dinheiro de uma incorporação (não é venda).
  - **Atualização** que bate com a sua posição é só conferida e não aparece mais para revisar; a que não bate diz por quê — "B3: X, Yield: Y" ou, logo depois de uma subscrição exercida, "provável crédito de subscrição: lance a compra em Notas com o preço pago".
  - **Fração em Ativos** e as linhas de direitos/recibos de subscrição deixam de aparecer como pendência.
- **Keychain pede menos**: as credenciais (Pluggy e Binance) ficam num item só, então cada versão nova pede a senha do Keychain uma vez, e não uma por credencial. Os itens antigos são migrados sozinhos na primeira abertura.
- **Cripto pelo par em dólar**: o Yahoo deixou de ter os pares em real (BTC-BRL); a cotação agora é o par em dólar × o dólar do dia.
- **Listas suspensas no visual do app** (no lugar do menu do sistema), com teclado (↑ ↓ Enter Esc), e campos de texto com o mesmo acabamento de borda e foco.
- **Campo de data novo** em todos os formulários: digita direto (as barras entram sozinhas) ou escolhe num calendário em português, com setas de mês e de ano, "Hoje" e "Limpar". O campo do sistema mostrava a data de hoje em cinza com o campo vazio e dava "informe uma data válida".

## 0.3.0

### Novidades
- **Declaração de IR** (Investimentos › Declaração IR): tudo o que vai na declaração sobre a bolsa, pronto para copiar campo a campo.
  - **Bens e Direitos**: um cartão por ativo com grupo/código da Receita, CNPJ, situação em 31/12 dos dois anos e a discriminação pronta ("500 Ações de … ao custo de R$ … cada - Ticker … - Custodiadas na corretora …"). Botão para copiar todas de uma vez.
  - **Rendimentos**: dividendos (09), rendimentos de FII (26), lucro isento de vendas até R$ 20 mil (20) e JCP (10), somados por fonte pagadora. Dividendo de BDR fica à parte, como renda do exterior.
  - **Renda variável**: a ficha mês a mês (operações comuns e FII), com os mesmos números da tela Imposto.
  - **Cadastro** de empresas e corretoras (razão social e CNPJ), editável e importável da aba "Empresas Listadas" da planilha antiga.
- **Salário CLT** nas fontes de renda: INSS e IRRF de 2026 calculados pelo app (com a isenção até R$ 5 mil da Lei 15.270), dependentes e outros descontos. O líquido vira a entrada do orçamento.
- **Categorias** de cara nova: grade com o gasto do mês, a variação contra o mês anterior e a barra do orçamento; ícone e cor escolhidos por você; prévia do que uma regra pega antes de criar; sugestões de regra a partir do que você categoriza à mão; apagar uma categoria move as compras, regras e linhas do orçamento para outra.
- **Resumo de gastos**: orçamento do mês com a projeção "no ritmo atual fecha em…", o que mais mudou contra o mês anterior, categorias com ícone e barra do orçamento, traço do orçamento no gasto por mês e as próximas assinaturas.
- **Resumo de investimentos**: rentabilidade da carteira em 12 meses contra o **CDI** e o **Ibovespa** (com proventos, sem contar aportes como ganho); quanto da sua renda passiva já cobre o gasto médio, rendimento sobre o custo, classes com o ganho de cada uma e clique no mês dos proventos abrindo Proventos filtrado.

### Melhorias
- Ícones de verdade em todo o app (categorias, botões, avisos).
- Menu do macOS em português, com **Procurar atualizações…**.
- Proventos: filtro por mês na lista de lançamentos; dica dos gráficos de barras sem as linhas zeradas.

### Atenção
- Esta versão atualiza o banco (esquemas 6, 7 e 8). Backups feitos em versões anteriores não podem ser importados nela — exporte um backup novo depois de atualizar.

## 0.2.1

### Novidades
- **Lançamentos** de cara nova: um cartão por dia, nome do lugar limpo (sem o "Transferência enviada pelo Pix|"), conta curta, faixa de categorias para filtrar, total do que está filtrado e grade de categorias com ícones no lugar do select.
- **Assinaturas** de cara nova: próximas cobranças, o peso de cada assinatura no total do mês e **excluir** com confirmação.
- **Proventos** de cara nova: 12 meses, ano contra ano, rendimento sobre o custo, gráfico de 24 meses que filtra a lista, ranking por ativo e totais por ano.
- Clicar num mês do "Gasto por mês" troca o Resumo de gastos para aquele mês.

### Correções
- O macOS parava de pedir a senha do Keychain toda hora: o app agora é assinado com um certificado fixo e lê as credenciais da Pluggy uma vez por sessão. Na primeira abertura, clique em "Permitir Sempre".
- Pix da sua própria empresa conta como Receita, não como transferência.
- Gráficos desenhados no tamanho real (o texto não fica gigante em tela larga) e barras de rolagem escondidas.
