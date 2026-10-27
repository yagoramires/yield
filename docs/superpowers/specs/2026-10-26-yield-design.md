# Yield — design

Data: 2026-10-26 · Dono: Yago · Status: aprovado em 2026-10-26

Documentos de apoio (leitura obrigatória para quem for planejar):
- `docs/analise-planilha-investimentos.md`: o que a planilha de investimentos faz, aba por aba, regras fiscais, bugs e lista priorizada de features (seção 8).
- `docs/pesquisa-open-finance.md`: caminhos grátis para dados bancários, cotações, proventos e notas, com fontes.
- `planilhas/`: cópias das duas planilhas originais (`Controle de Investimentos.xlsm` e `_Controle Financeiro Yago.xlsx`). Contêm dados pessoais reais e nunca vão para o git.

## 1. Intenção

O Yago controla investimentos e o orçamento do mês em duas planilhas Excel. A de investimentos é um template de terceiro ("Controle para Bolsa"), pesado, cheio de macros, e quebrado: o IR de ações, day trade e DARF só cobre 2020–2021, as cotações dependem de uma planilha Google do autor do template, e tudo é digitado à mão. A de orçamento é uma grade manual de 12 meses. Nenhuma das duas sabe o que ele realmente gastou.

O Yield é um app de desktop local que substitui as duas planilhas e acrescenta o que elas não têm: gastos reais vindos do Open Finance, assinaturas detectadas, cotação automática e IR sem limite de anos. Nas palavras dele: "nada me faria voltar pra essa planilha".

## 2. Objetivos

1. Substituir a planilha de investimentos por inteiro, com o histórico importado e o IR correto de 2020 até hoje, incluindo os anos que a planilha deixou de calcular.
2. Substituir a planilha de orçamento mensal.
3. Mostrar os gastos reais de cartão e conta dos 6 bancos dele, de graça, e detectar assinaturas.
4. Usar o planejado e o real juntos: o real alimenta sugestões no plano do mês.

## 3. Não objetivos

- Conta de usuário, login, sincronização em nuvem ou backend próprio. Trocar de PC = exportar e importar um arquivo.
- App de celular.
- Multiusuário ou família (a divisão 50/50 com a Nath fica como linha do planejamento, não como usuário).
- Ser um produto para terceiros. É pessoal; outras pessoas podem usar, mas nada é desenhado para isso.
- Fazer parte do catálogo do NeyHub (que é Swift e só Mac). O Yield só herda o visual.
- Recomendação de investimento.
- **Day trade** (decisão 14).

## 4. Anti-objetivos (falha mesmo que funcione)

- **IR errado.** Número de imposto que não bate com as regras da Receita é pior que não ter número. Todo cálculo fiscal precisa de teste.
- **Perder dados.** Qualquer operação destrutiva (reimportar, excluir nota, importar backup) precisa ser reversível ou confirmada.
- **Mandar dado pessoal para onde não precisa.** Só sai da máquina o que a integração exige (Pluggy, provedores de cotação).
- **Ficar mais trabalhoso que a planilha.** Se lançar uma nota der mais trabalho que no Excel, ele volta (mesmo dizendo que não).

## 5. Restrições

- Roda em **Windows e macOS**, local, offline para tudo que não depende de rede.
- **Custo zero**: nenhuma API paga. Open Finance só via Pluggy + conector MeuPluggy (grátis para uso pessoal; ver pesquisa).
- Bancos/corretoras dele: Nubank, Bradesco, XP, Clear, BTG Pactual, Mercado Pago. Nos dados da planilha aparece também o **Inter** como corretora.
- Interface em **pt-BR**.
- Credenciais da Pluggy (`client_id`/`client_secret`) **coladas pelo usuário** nas configurações e guardadas no cofre do sistema (Keychain no Mac, Credential Manager no Windows). Nunca embutidas no binário, nunca no arquivo de exportação.
- **Janela de 15 dias da Pluggy**: os conectores precisam ser configurados nos 15 dias depois de criar a conta. O Yago não deve criar a conta até a fase do Open Finance estar pronta. O app deve trazer, nessa tela, um passo a passo que deixe isso claro.

## 6. Decisões do Yago

1. Nome: **Yield**.
2. Três páginas: **Últimos gastos**, **Orçamento mensal**, **Investimentos**, cada uma com subseções.
3. Navegação **A**: barra lateral com as três páginas e todas as subseções sempre visíveis (mockup em `.superpowers/brainstorm/*/content/navegacao.html`).
4. Visual no padrão NeyHub (tema **Grafite**: escuro, denso, um acento verde-lima `#c6ff3d`, barra lateral). Referência: `~/Documents/personal-projects/neyhub/docs/design/mockup-direcao-visual.html` (mockup A).
5. Ordem: **investimentos primeiro**, depois orçamento, por último Open Finance.
6. **Importar o histórico** da planilha de investimentos na primeira abertura (notas, movimentações e proventos).
7. **Mostrar IR e DARF em aberto dos anos passados** (2020→hoje), inclusive o que a planilha não calculou.
8. Planejado e real ficam em páginas separadas, mas **o real alimenta o planejamento**: o app sugere no plano do mês as despesas que se repetem nos gastos reais. Detalhe fino ele ajusta depois.
9. Dados só locais, com exportar/importar para trocar de PC.
10. Funções pedidas em investimentos: import de nota de corretagem, cotação "em tempo real", controle de dividendos, adição manual de ativos.
11. **A planilha não está em dia.** Não precisa de importador extra para cobrir a lacuna: depois que o app estiver pronto, o Yago lança o que falta (notas em PDF ou manuais) e usa isso como teste real. Ele quase não vende ações.
12. **Nenhum DARF foi pago.** Todo DARF calculado começa como "em aberto"; não há pagamentos para importar.
13. **Leitor de PDF de nota: só Clear na v1**, porque são os únicos PDFs que ele tem. O Yago coloca as notas em `yield/notas/` (fora do git) para construir e testar o leitor. XP, BTG e Inter ficam para quando houver amostras; até lá, essas notas entram pelo lançamento manual, que precisa ser rápido.
14. **Sem day trade.** Não é a intenção dele operar assim; o app não apura day trade nem tem tela para isso.
15. **Open Finance somente leitura.** A conexão (Pluggy/MeuPluggy) pede só escopos de leitura (contas, cartões, transações, investimentos); nada de iniciação de pagamento ou qualquer permissão que movimente dinheiro. A tela de conexão deixa isso explícito.

## 7. Escolhas minhas (podem ser vetadas)

- **Stack: Tauri 2 + React + TypeScript + SQLite.** Um código para Windows e Mac, app leve, React é o dia a dia do Yago, SQLite é um arquivo só (facilita exportar/importar).
- **"Tempo real" vira "atraso de minutos".** Não existe fonte grátis de tempo real para B3. A tela sempre mostra a hora da última cotação. Fonte principal: Yahoo Finance (`.SA`, sem token, não oficial); reserva: brapi (token grátis colado pelo usuário, opcional); último recurso: preço manual. Cotação fica em cache para funcionar offline.
- **Indicadores** (CDI, Selic, IPCA) pela API SGS do Banco Central, para renda fixa.
- **Proventos** vêm da importação do extrato de movimentação da Área do Investidor da B3 (xlsx), mais lançamento manual. Nada de scraping (StatusInvest etc.).
- **Exportação** = um arquivo único com todo o banco (formato à escolha do builder), sem credenciais. Importação substitui os dados atuais só depois de confirmação e de guardar um backup automático do estado anterior.
- **Sem criptografia própria do banco local** na v1; confia na criptografia de disco do sistema (FileVault/BitLocker). Registrar como atalho conhecido.
- **Planejamento (simulação tipo aba Aluguel) e Milhas** entram por último, depois do Open Finance. São as partes menos usadas e mais simples de refazer.
- Corretoras são cadastro livre (nome, CNPJ); não há código específico por corretora, exceto o leitor de nota em PDF.
- **Eventos corporativos**: o ledger da planilha não tem nenhum. O extrato de Movimentação da B3 vira a fonte desses eventos (bonificação, desdobramento, grupamento, mudança de ticker) e eles são aplicados retroativamente, mesmo que mudem preço médio e IR antigos. Quando a planilha e a B3 discordarem, vale a B3; a diferença aparece no resumo da importação.
- **DARF atrasado**: o app mostra o imposto original, o vencimento e os dados para emitir o DARF (código 6015, período de apuração); multa e juros ficam com o SicalcWeb, que calcula na hora de pagar. Atalho: o app não calcula acréscimos.
- **Cripto e dólar ficam fora do IR na v1**: entram só como ativos manuais com valor atual. A tela de Imposto diz claramente que só cobre B3.
- **Pluggy no desenvolvimento**: a fase 3 é construída contra respostas simuladas da API da Pluggy, com o plano B (OFX/CSV) pronto antes. O primeiro contato real é um roteiro curto que o Yago segue dentro da janela de 15 dias, depois que a fase 3 estiver pronta.
- **Sem a isenção da Lei 13.043** (ações isentas e lotes `.N`): nenhuma operação dele usa esses tickers e a regra acabou em 2023-12-31. Feriados são calculados, não importados; `Empresas Listadas` fica para a DIRPF.
- **Vencimento do DARF em dezembro** cai no penúltimo dia útil, porque não há expediente bancário ao público no último dia útil do ano (Res. CMN 4.880/2020).
- **Day trade fora do app** (decisão 14). Se aparecer compra e venda do mesmo ativo no mesmo dia e corretora, o app avisa que não trata day trade em vez de calcular errado em silêncio.

## 8. O que o app faz

### 8.1 Investimentos (fase 1)

Subseções: **Carteira**, **Notas**, **Proventos**, **Imposto**.

- **Importação inicial da planilha**: na primeira abertura (e depois por menu), o usuário escolhe o `.xlsm`; o app lê as tabelas `TabelaNotas`, `TabelaMovimentacoes`, as grades `Rendimentos 20xx`, os ativos manuais da `Visão Geral` (renda fixa, dólar, cripto). Detalhes de colunas na análise. Ao final, um resumo do que entrou e do que foi ignorado. Os dados importados são recalculados pelo motor do app; os valores calculados pela planilha servem só para conferência.
- **Notas**: cadastrar nota de corretagem (cabeçalho com nº, corretora, data de pregão/liquidação, taxas; itens com C/V, tipo, ticker, qtd, preço), editar, excluir. **Importar PDF de nota da Clear** (padrão SINACOR; outras corretoras depois, ver decisão 13); a nota lida vira um rascunho que o usuário confere antes de salvar. Rateio de taxas com as regras da planilha (análise, §8 item 2).
- **Motor**: o histórico de movimentações é a fonte única e é **recalculado em ordem cronológica** sempre que algo muda (não depende da ordem de inclusão). Preço médio consolidado entre corretoras com taxas no custo; resultado por venda. Eventos corporativos: bonificação, split/inplit, mudança de ticker, subscrição, IPO (análise, §8 item 10).
- **Carteira**: posição por ativo e por classe (Ação, FII, ETF, BDR, renda fixa, dólar, cripto) com qtd, preço médio, custo, cotação, valor atual, variação R$/%; patrimônio total; proventos dos últimos 12 meses. Corrige o bug da Visão Geral (custo e valor atual da mesma classe). **Adição manual de ativos** para o que não vem de nota (renda fixa, cripto, dólar, previdência…), com valor atualizado à mão ou por indicador.
- **Proventos**: lista por ativo e mês (dividendo, JCP, rendimento de FII), importação do extrato B3, lançamento manual, totais por ano.
- **Imposto**: apuração mensal desde 2020 sem limite de anos — comum 15% com isenção de R$ 20 mil só para ações, FII 20%, dois potes de prejuízo (comum e FII), IRRF compensável. DARF por mês real, acumulando valores abaixo de R$ 10, vencimento no último dia útil do mês seguinte, e marcação de **pago** (inclusive pago em atraso). Meses com DARF em aberto aparecem em destaque. A geração de Bens e Direitos/fichas DIRPF com os códigos atuais é P1 desta fase e pode vir depois do resto (análise, §8 itens 8–9; os códigos DIRPF da análise são de memória e precisam ser conferidos).

### 8.2 Orçamento mensal (fase 2)

Subseção principal: **Mês atual** (e navegação entre meses).

- O plano do mês tem entradas e saídas em linhas, como a aba `Finanças` hoje: salários (inclusive o cálculo do salário PJ líquido: pró-labore 28%, IRPJ 6%, INSS 11% do pró-labore, contabilidade — percentuais editáveis), contas, assinaturas, investimentos, reservas, ajudas. Saldo do mês no fim.
- Criar o mês seguinte copia as linhas recorrentes do mês anterior.
- Importar a planilha `_Controle Financeiro Yago.xlsx` (aba `Finanças`) para começar com o plano atual.
- Quando a fase 3 existir: topo do mês mostra "planejado × gasto real até agora", e ao abrir um mês o app **sugere** as despesas recorrentes vistas nos gastos reais (assinaturas, contas fixas, parcelas restantes); o usuário aceita, ajusta ou descarta. Nada entra no plano sem confirmação. Gasto avulso não entra no plano.

### 8.3 Últimos gastos (fase 3)

Subseções: **Lançamentos**, **Assinaturas**, **Categorias**.

- Conexão via Pluggy/MeuPluggy com as 6 instituições: transações de conta e cartão (até 12 meses de histórico), atualizadas ao abrir o app e sob demanda, respeitando a cota da rede.
- **Plano B sem Pluggy**: importar extrato OFX/CSV (Nubank, Bradesco, Mercado Pago). Fatura de cartão em PDF fica fora da v1.
- Lançamentos com filtro por conta/cartão, mês e categoria; categoria editável, com regra "sempre categorizar X como Y".
- **Assinaturas**: detectadas por cobrança que se repete com valor e estabelecimento parecidos; lista com valor mensal, próxima cobrança e total por ano.
- Os investimentos vindos do Open Finance **não** substituem o motor de notas (preço médio via Open Finance não é confiável); no máximo servem para conferir posição.

### 8.4 Depois (fase 4)

- **Planejamento**: simulações tipo a aba `Aluguel` (cenário de mudança, divisão de contas).
- **Milhas**: saldo de pontos por programa e calculadora de custo do milheiro.
- Painéis extras da análise (§8 P3): gráficos, alocação de FIIs por setor, preço-teto.

## 9. Dados e privacidade

- Banco SQLite na pasta de dados do app do sistema operacional.
- As planilhas originais, as notas em PDF e qualquer dado real nunca entram no repositório (`planilhas/`, `notas/` e `.superpowers/` no `.gitignore`). Fixtures de teste usam dados fictícios ou anonimizados.
- Credenciais só no cofre do sistema.

## 10. Como saber que está certo

- O motor fiscal tem testes com casos conhecidos das regras (isenção de 20 mil, compensação de prejuízo, DARF < R$ 10).
- **Conferência com a planilha**: para 2020–2021 (antes de aplicar os eventos da B3) (os anos que a planilha calcula), o IR, o DARF e o preço médio do Yield precisam bater com os valores da planilha, ou a diferença precisa ser explicada por um bug conhecido da planilha (análise, §7).
- A carteira atual do Yield bate com a posição da planilha (17 posições abertas) e, idealmente, com o extrato de posição da B3.

## 11. Fica a critério de quem constrói

Estrutura do código, esquema do banco, bibliotecas (leitura de xlsx, PDF, OFX), formato do arquivo de exportação, como empacotar e assinar os instaladores (Gatekeeper/SmartScreen), atualização automática ou não, layout fino de cada tela dentro do tema Grafite (com mockup aprovado pelo Yago antes de construir cada página), intervalo de atualização das cotações, heurística exata de detecção de assinaturas.
