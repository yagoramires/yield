# Changelog

O que mudou em cada versão do yield. O app avisa e se atualiza sozinho quando sai uma versão nova.

## 0.9.0

Assistente com IA que roda no seu computador, perfis com PIN, setup inicial e Configurações novas.

### Novidades
- **Assistente com IA local (opcional)**: chat em português que consulta os seus dados por ferramentas só de leitura (gastos, lançamentos, orçamento, carteira, rentabilidade, proventos). O `llama.cpp` vem no instalador e o modelo Qwen3 (8B ou 4B, escolhido pela memória do computador) é baixado no primeiro uso, com o download retomável e conferido por SHA-256. Nada sai da máquina.
- **Insights** nos Resumos de gastos e de investimentos, no Orçamento e em Proventos, gerados quando os números do mês mudam. Todo valor em R$ e % é conferido contra os dados do app: insight com número inventado é descartado, e no chat o valor fora das ferramentas aparece como "não conferido".
- **Tema claro**: botão no menu (sistema, claro, escuro) e Configurações › Aparência.
- **Saldo nas contas** e fatura do cartão vindos da Pluggy, no Resumo de gastos.
- **Investimentos do banco pela Pluggy** (RDB, caixinhas, fundos, CDB…) na Carteira, só leitura, sem repetir o que a Posição da B3 já mostra.
- **Reserva** no Orçamento com o saldo no banco: ligação pelo nome do investimento ou à mão.
- **Proventos reinvestidos**: opção em Configurações; com ela o Patrimônio mostra o que saiu do seu bolso e o Resultado soma os proventos.
- **Olhinho** no menu esconde os valores em todas as telas.
- **Status de sincronização** no menu (Open Finance, Binance, cotações) com "Sincronizar tudo"; com o app aberto, cotações e Binance a cada 15 min e Open Finance a cada 6 h.
- **Módulos** (Últimos gastos, Orçamento, Investimentos) ligados e desligados em Configurações, e menu recolhível só com ícones.
- **Orçamento**: "Entradas" soma o que entrou de terceiros (sem as suas próprias contas nem o salário duas vezes), trazer o plano do mês anterior para um mês vazio e excluir mês.
- **Perfis**: múltiplos perfis num computador, cada um com seus dados e credenciais.
- **Foto do perfil**: avatar com iniciais, cor ou imagem.
- **Troca de perfil**: menu no topo da sidebar e tela "Quem está usando?" ao abrir o app com 2+ perfis.
- **Apagar perfil**: com diálogo de confirmação, em Configurações › Perfil e PIN.
- **PIN por perfil**: opcional, 4 dígitos; com ele os dados e as credenciais do perfil ficam criptografados no disco.
- **Limite de tentativas do PIN**: esperas de 1 min, 5 min, 15 min e 1 h; nunca apaga dados.
- **Esqueci o PIN**: explica que os dados não voltam e permite apagar o perfil.
- **Restaurar backup como perfil novo**: "Novo perfil" › "Restaurar de um backup".
- **Backup de perfil com PIN em formato novo**: versões anteriores do app não abrem esse arquivo.
- **Setup inicial**: na primeira abertura e em cada perfil novo, 5 passos (perfil e PIN, quais abas, contas, Assistente, resumo) e um tour curto pelo app. Quem atualiza não vê; dá para refazer em Configurações › Perfil e PIN.
- **Configurações em seções**: menu lateral com busca (Perfil, Aparência, Contas conectadas, Importar arquivos, Backup…), lembra a última seção aberta e os links das outras telas abrem direto na seção certa.
- **Contas conectadas**: uma lista por banco com a situação, reconectar e as credenciais atrás de um link.

### Melhorias
- O app abre na última tela usada.
- Paleta em torno do verde, validada para daltonismo; seletor de mês com a grade do ano; botões, campos e espaçamentos padronizados.

### Segurança
- As credenciais da Pluggy e da Binance ficam só no Rust: ele faz o `POST /auth` da Pluggy e as leituras assinadas da Binance, e o JavaScript não vê a chave.
- Comandos de arquivo só aceitam os arquivos da pasta do app; o banco sem senha de uma importação de backup não fica no disco.
- CSP ligada e actions do GitHub fixadas por SHA.

## 0.8.0

Orçamento novo, no jeito de uma planilha de controle: o que você ganha, custos fixos e custos variáveis.

### Novidades
- **Orçamento em blocos**: O que eu ganho, Custos, Investimentos e Parcelas, com os números do mês no topo (o que entra, fixos + parcelas, variáveis, investido e a sobra do que já saiu).
- **Custos com abas Fixos e Variáveis**: o total do mês, a proporção entre os dois e, em cada aba, as categorias com ícone, barra e a lista de gastos. Nos fixos, o que está no plano (com "pago ✓" quando o lançamento aparece) e o que saiu fora dele. Em Metas você escolhe se cada categoria é fixa ou variável.
- **Salário entra sozinho**: as fontes de renda cadastradas entram em todo mês novo pelo líquido; num mês que já existia, a fonte que falta aparece com o botão "incluir".
- **Gastos puxados dos lançamentos**, por categoria, sem precisar digitar. Clique na categoria para ver os gastos dela. Parcelas e assinaturas aceitas e contas fixas pagas pelo banco não contam duas vezes.
- **Investido puxado dos lançamentos**: o que saiu para a categoria Investimento (ou uma categoria sua que não conta como gasto, como uma reserva).
- **Metas**: botão no topo do orçamento para definir quanto investir, um limite total dos variáveis e uma meta por categoria, com a média dos últimos 3 meses ao lado. Valem do mês em diante, sem mudar os meses anteriores; sem meta, a barra compara com a média.
- **Parcelas** mostram quantas faltam e quando acabam, e somem depois da última.
- Nomes que vêm do extrato aparecem legíveis ("MP*LOJA" vira "Loja").

### Melhorias
- O Resumo de gastos e Categorias usam as metas por categoria como orçamento, só nos meses com plano.
- O CSV do orçamento transforma as linhas `variavel` e `meta` no limite dos variáveis e na meta de investir do mês.
- Apagar uma categoria leva a meta dela junto para a categoria de destino.

## 0.7.0

### Novidades
- **Compras e vendas pela Pluggy**: a sincronização do Open Finance traz as operações de ações, FIIs, ETFs e BDRs das corretoras conectadas. A importação da B3 continua; o que já existe não duplica (a comparação é pela quantidade do dia), as operações da B3 ganham as taxas e o IR retido que a Pluggy informa, e a nota em PDF ou à mão continua mandando. Configurações › Open Finance mostra o resumo por corretora.
- **Busca do aportado na Binance** mostra o progresso enquanto lê e, no fim, quantas compras achou em cada fonte e o que ficou sem histórico.

### Correções
- Banco sem investimentos na Pluggy não derruba a sincronização dos outros.
- Editar uma nota em PDF não deixa nota duplicada se algo falhar no meio.

## 0.6.0

O app agora funciona do mesmo jeito para qualquer pessoa, não só para quem tem os mesmos bancos e corretoras.

### Novidades
- **Aportado da cripto pela Binance**: botão "Buscar aportado na Binance" lê o histórico de compras por PIX/cartão, Converter e negociações à vista, e calcula o custo médio em reais (compras em dólar ou stablecoin pelo dólar do mês). O valor informado à mão continua valendo; quando o histórico não fecha com o saldo, aparece "parcial".
- **Nota em PDF de qualquer corretora no padrão SINACOR** (XP, Rico, Clear…), com a corretora lida do cabeçalho; se não der, a tela pergunta.
- **Extrato CSV de qualquer banco**: você escolhe as colunas de data, descrição e valor (o separador, o formato da data e o sinal são detectados). Atalho para a fatura do cartão Nubank.
- **Orçamento por CSV simples** (`mes;tipo;nome;valor`), no lugar do importador da planilha antiga.
- **Cadastro do IR preenchido pela Posição da B3**: empresas e fundos com o CNPJ que a B3 informa.
- **Prejuízo a compensar** de antes do relatório da B3, informado uma vez (ações e FII separados).
- **MEI** nas fontes de renda, com DAS fixo; fonte nova abre como CLT.
- **Declaração de IR**: renda fixa da B3 em Bens e Direitos (04-02 tributáveis, 04-03 isentos), juros nos rendimentos, e aviso do que fica de fora.
- **Sua empresa** (nome ou CNPJ) em Configurações › Contas, no lugar da adivinhação por palavras: o que a empresa te paga vira Receita. Lançamentos avisa quando há Pix de empresa e nenhuma empresa configurada.

### Melhorias
- Importar da B3 já atualiza as cotações.
- Nome de corretora padronizado para todas (XP, Nu, Rico…), sem duplicar no cadastro.
- Parcelas lidas da descrição nos extratos (só com marcador na conta; "03/10" no fim no cartão).
- Cripto manual cotada em dólar × dólar do dia; as antigas em BTC-BRL são corrigidas sozinhas.
- Tabelas do CLT organizadas por ano; datas da Pluggy no fuso do computador.

### Correções
- Resgate de renda fixa vindo do Open Finance não conta mais como receita.

## 0.5.0

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
