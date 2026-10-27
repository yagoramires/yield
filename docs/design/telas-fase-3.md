# Telas aprovadas da fase 3 (Últimos gastos + Resumo de Investimentos)

Aprovadas pelo Yago em 26/10/2026. O mockup é `telas-fase-3.html` (abrir no navegador; números e lojas fictícios). A primeira versão de Lançamentos foi achada confusa; ela foi refeita com gráficos e depois dividida em Resumo + Lançamentos. O Resumo de Investimentos foi pedido na mesma rodada.

## Comum

- Navegação: Últimos gastos ganha **Resumo** (abre primeiro), Lançamentos, Assinaturas, Categorias. Investimentos ganha **Resumo** antes de Carteira.
- Gráficos em SVG desenhado à mão (sem biblioteca), tema Grafite. Cores de série: `#3987e5` (série 1), `#d95926` (série 2), `#199e70` (série 3), validadas para daltonismo sobre `#121315`. Texto nunca na cor da série. Linhas 2px, barras com ponta arredondada de 4px, grade discreta, um eixo só. Toda marca tem dica ao passar o mouse com o valor; série única não tem legenda, duas ou mais têm.
- "Sem categoria" e o mês corrente (incompleto) aparecem listrados.

## Últimos gastos › Resumo

- Cabeçalho: título, mês com setas (vale também para Lançamentos), "sincronizado hoje 09:12", "Sincronizar", "Importar extrato…".
- Avisos numa linha só ("2 avisos: … Ver"): erro de sincronização por item e conta possivelmente em dobro.
- Cartões: Gasto no mês (com a diferença para o mês anterior até o mesmo dia), Entradas, Sobrou (entradas − gasto).
- Gráficos: **gasto acumulado no mês** (linha do mês × linha tracejada do mês anterior, por dia, marcador no dia de hoje); **por categoria** (barras horizontais, "Outras (n)" e "Sem categoria" no fim, clicar abre Lançamentos filtrado); **gasto por mês** (6 meses, barras, mês atual listrado); **maiores gastos do mês** (5, clicar abre Lançamentos).
- Rodapé: pagamento de fatura, transferências e investimentos não entram.

## Últimos gastos › Lançamentos

- Mesmo cabeçalho; uma linha com gasto e entradas do mês.
- Filtros numa linha: busca por descrição, Tudo/Contas/Cartões, Categoria ▾, "n sem categoria".
- Lista por dia (mais recente primeiro) com total do dia; cada lançamento em duas linhas: nome; embaixo conta · parcela · pendente · regra que categorizou. Categoria editável à direita, valor na ponta.
- Pagamento de fatura em cinza, "não conta como gasto".
- Trocar a categoria abre uma linha embaixo do lançamento: categoria ▾, "fazer isso sempre com '<padrão>' (também nas n compras antigas)", Cancelar/Salvar.

## Assinaturas

- Cartões: por mês, por ano, paradas. Tabela: assinatura, conta, período, valor, por mês, próxima, situação (ativa/parada desde; "subiu de X"), "não é assinatura" com confirmação na tela.

## Categorias

- Tabela com gasto do mês e se conta como gasto; renomear; apagar só as criadas pelo usuário, com confirmação que diz quantas regras e escolhas manuais vão junto. Ao lado, as regras ("quando a descrição tem … → categoria"), apagar e adicionar.

## Configurações › Open Finance

- "O Yield só lê seus dados: não move dinheiro nem inicia pagamentos." Passo a passo (meu.pluggy.ai, dashboard.pluggy.ai + conector MeuPluggy, itemId, Client ID/Secret), aviso dos 15 dias, credenciais mostradas só como "salvo no cofre do sistema" (Trocar/Apagar), lista de bancos (nome, itemId abreviado, situação), adicionar, Testar conexão, Sincronizar agora. Nota: sincroniza ao abrir se passaram 6 h.

## Investimentos › Resumo

- Cabeçalho com a hora da cotação e "Atualizar cotações". Aviso de DARF a vencer/em aberto e de mês incompleto, com link para Imposto.
- Cartões: Patrimônio (aportado embaixo), Resultado (R$ e % sobre o aportado), Proventos 12 meses (média), Imposto (DARF a vencer/em aberto).
- Gráficos: **aportado × valor de hoje** (linha do custo acumulado em 24 meses + ponto do valor de hoje; texto explica que não há cotação antiga); **patrimônio por classe** (barras com R$ e %; clicar abre Carteira); **proventos por mês** (12 meses, empilhado Rendimento/Dividendo/JCP, com legenda); **maiores posições** (5, com % do patrimônio e variação).
