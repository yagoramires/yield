# Pesquisa: puxar os próprios dados financeiros de graça para um app desktop local

Data da pesquisa: 26/10/2026. Uso: pessoal, um único CPF, app desktop (Windows/Mac), sem backend próprio e sem contas de usuário.
Instituições: Nubank, Bradesco, XP Investimentos, Clear Corretora, BTG Pactual, Mercado Pago.

Legenda: **[verificado]** = conferi na fonte ou testei a chamada nesta data; **[não verificado]** = indício razoável, mas não confirmado.

---

## TL;DR

1. **Open Finance direto: não dá.** Só instituição autorizada pelo Banco Central pode receber dados. Pessoa física é "cliente", nunca participante.
2. **Único caminho grátis via API: Pluggy + conector "MeuPluggy".** Você conecta seus bancos no app grátis Meu Pluggy (que usa Open Finance) e lê os dados pela API da Pluggy com um `client_id`/`client_secret` de "Development Application". Depois do trial de 15 dias isso continua grátis para uso pessoal. Cobre conta, cartão, transações **e investimentos**, inclusive XP, BTG e Clear.
3. Belvo, Klavi e Celcoin **não têm** plano grátis de produção para pessoa física. O sandbox da Belvo é só para teste.
4. **B3:** a API da Área do Investidor é paga e só para instituições/fintechs com licença. De graça, só baixando à mão os Excel da Área do Investidor (posição, movimentação, negociação, proventos).
5. **Notas de corretagem:** padrão SINACOR em PDF. Os parsers open source são `correpy` (Python), `parser-de-notas-de-corretagem` (JS/TS) e `sinacor-parser` (PHP).
6. **Cotações:** Yahoo `.SA` (não oficial, sem token, funcionou hoje) e brapi grátis (15 mil requisições/mês, 1 ticker por chamada, ~30 min de atraso, **sem dividendos** no plano grátis). CDI/Selic/IPCA saem de graça na API SGS do BCB.
7. **Plano B para gastos:** OFX/CSV de conta (Nubank, Bradesco, Mercado Pago). Fatura de cartão em geral só vem em PDF.

---

## Tabela: instituição × dado × caminho grátis

| Instituição | Gastos do cartão | Conta (transações/saldo) | Investimentos | Caminho grátis recomendado |
|---|---|---|---|---|
| **Nubank** | Open Finance via MeuPluggy [verificado na cobertura Pluggy]. Manual: fatura em PDF por e-mail. CSV da fatura **não confirmado** | MeuPluggy. Manual: extrato da conta em PDF/CSV/OFX pelo app (vai por e-mail) | MeuPluggy (cobertura Pluggy marca investimentos para Nubank). NuInvest: B3 Área do Investidor (Excel) | MeuPluggy. Fallback: OFX/CSV da conta + PDF da fatura |
| **Bradesco** | MeuPluggy. Manual: fatura em PDF | MeuPluggy. Manual: OFX ("Money 2000 em diante") no Internet Banking, até ~60 dias por vez | MeuPluggy (OF marca investimentos) | MeuPluggy. Fallback: exportar OFX todo mês |
| **XP Investimentos** | MeuPluggy (conector OF "XP Banking": cartão XP) | MeuPluggy (conta XP) | MeuPluggy: OF "XP Banking" cobre ações, FII, BDR, ETF, CDB, CRI/CRA, LCI/LCA, debêntures, Tesouro e fundos. Mais B3 Excel e notas SINACOR | MeuPluggy + B3 Excel + notas |
| **Clear Corretora** | Não se aplica (não tem cartão) | Saldo da conta de investimento | MeuPluggy: OF "Clear Corretora (623)" cobre ações, FII, BDR, ETF e Tesouro. **Não** cobre CDB/CRI/CRA/LCI/LCA. Mais B3 Excel e notas SINACOR | B3 Excel (fonte de verdade da custódia) + notas SINACOR; MeuPluggy como complemento |
| **BTG Pactual** | MeuPluggy (OF "BTGPactual") | MeuPluggy | MeuPluggy (OF "BTGPactual Investimentos") + B3 Excel + notas | MeuPluggy + B3 Excel |
| **Mercado Pago** | MeuPluggy (OF "Mercado Pago", cartão Meli) | MeuPluggy. Manual: extrato em PDF/XLSX/CSV pelo app | MeuPluggy marca investimentos (rendimento da conta, CDB do MP) [não verificado no detalhe] | MeuPluggy. Fallback: CSV do extrato |

Observação: a tabela de cobertura da Pluggy marca 🟢 em todas as colunas para todas as instituições OF, inclusive "Credit Cards" para a Clear, que não emite cartão. Leia como "o produto é suportado se a instituição publicar o dado", não como garantia.

---

## 1. Open Finance Brasil

### 1.1 Uma pessoa física consegue acessar direto? **Não.**
- A Resolução Conjunta nº 1/2020 se aplica a "instituições financeiras, instituições de pagamento e demais instituições autorizadas a funcionar pelo Banco Central". A "instituição receptora de dados" tem que ser participante. Pessoa natural aparece só como **cliente**. Fonte: https://normativos.bcb.gov.br/Lists/Normativos/Attachments/51028/Res_Conj_0001_v6_P.pdf
- Na prática, também exige certificados ICP-Brasil, cadastro no Diretório do Open Finance e FAPI/mTLS. Para uma pessoa física isso é inviável.

### 1.2 Consentimento: 90/365 dias?
- O limite antigo de 12 meses acabou. Desde 15/04/2024 o compartilhamento pode valer por **prazo indeterminado**, e o cliente revoga quando quiser. Fontes: https://bpmoney.com.br/inovacao/tecnologia/compartilhamento-de-dados-passa-a-ser-por-tempo-indeterminado/ e https://agenciagov.ebc.com.br/noticias/202310/bc-simplifica-renovacao-de-consentimentos-no-open-finance-e-amplia-prazo-de-validade-do-compartilhamento
- Na Pluggy, "By default, Open Finance Consents have no expiration" (`expiresAt: null`) [verificado]. Fonte: https://docs.pluggy.ai/docs/consents
- **Limites operacionais da rede OF**, contados por CPF × instituição × produto e por mês [verificado]. Fonte: https://docs.pluggy.ai/en/docs/open-finance/rate-limits.md
  - Transações de cartão recentes (1 a 6 dias): 240/mês. Faturas: 30/mês. Transações antigas (7 a 365 dias): 4/mês.
  - Saldo de investimentos: 120/mês. Histórico de transações de investimento: 4/mês.
  - Na prática: no máximo ~4 atualizações por dia por item. **Não crie vários items** para o mesmo CPF e banco, porque o limite estoura mais rápido.
  - O histórico via OF vai até ~12 meses (365 dias). Para dados mais antigos, use OFX/CSV ou a B3.

### 1.3 Agregadores

| Agregador | Grátis para pessoa física? | Preço | Cartão | Conta | Investimentos | Instituições (das 6) |
|---|---|---|---|---|---|---|
| **Pluggy + MeuPluggy** | **Sim, uso pessoal.** Trial de 15 dias e, depois, o conector MeuPluggy segue grátis | Plano "Dados" a partir de R$ 2.500/mês (até 500 conexões). Desnecessário para uso pessoal | Sim | Sim | Sim (+ transações de investimento) | As 6 (via Open Finance) |
| **Belvo** | Só sandbox ("free and intended for testing and evaluation purposes only") | Launch a partir de US$ 1.000/mês | Sim | Sim | Sim (API "investments-brazil") | Rede OF |
| **Klavi** | Não. Só B2B, "Fale conosco" | Sob consulta | Sim | Sim | Sim (Open Investments) | Rede OF |
| **Celcoin** | Não. BaaS B2B com contrato | Sob consulta | — | — | — | — |

Fontes:
- Pluggy preços/FAQ [verificado em 26/10/2026]: https://www.pluggy.ai/precos. Trecho do FAQ: *"Se quiser continuar acessando apenas seus próprios dados bancários via API (uso pessoal), é possível fazer isso gratuitamente via conector MeuPluggy, que usa os dados que você já tem no Meu Pluggy."*
- MeuPluggy (passo a passo oficial): https://github.com/pluggyai/meu-pluggy. Diz *"you will begin a 15 days trial (Don't worry you will be able to pull information after expires anyway)"* e que a conexão é um proxy da conexão do Meu Pluggy, **atualizada 1 vez por dia**. Também avisa: autorizar **uma vez por banco** no Meu Pluggy.
- Actual Budget usando esse fluxo: https://actualbudget.org/docs/advanced/bank-sync/pluggyai. Aviso importante: *"you will only be able to connect your account to meu.pluggy.ai while your pluggy.ai trial period is active... Once the trial period lapses, the account will remain connected but the connector list configuration will not be editable."* **Configure todos os bancos dentro dos 15 dias de trial.**
- Cobertura do conector MeuPluggy (Identity, Accounts, Credit Cards, Transactions, Payment Data, Investments e Investment Transactions = sim; Loans = não; Auto Updates = sim) [verificado]: https://docs.pluggy.ai/en/docs/connections/connectors-coverage.md
- Cobertura OF por instituição: https://docs.pluggy.ai/en/docs/open-finance/institutions-coverage.md e subtipos de investimento: https://docs.pluggy.ai/en/docs/open-finance/investments.md
- Belvo: https://belvo.com/plans-and-pricing/
- Klavi: https://www.klavi.ai/. Celcoin: https://developers.celcoin.com.br/docs/open-finance

### 1.4 A chave da Pluggy pode ficar no app desktop?
- A Pluggy manda guardar o `CLIENT_ID`/`CLIENT_SECRET` "in your secured server only". A API Key gerada via `POST /auth` **expira em 2 horas** e dá acesso total. O Connect Token (30 min) não lê dados detalhados (devolve 403) [verificado]. Fonte: https://docs.pluggy.ai/docs/authentication
- **No nosso caso** (app pessoal, credencial do próprio usuário, sem distribuir com segredo embutido), é aceitável se:
  - o usuário cola o próprio `client_id`/`client_secret` no primeiro uso;
  - o app guarda isso no cofre do sistema (Keychain no macOS, Credential Manager/DPAPI no Windows), **nunca** em arquivo de config em texto puro nem no binário;
  - o app gera uma API Key nova a cada sessão (ela dura 2h) e chama `GET /accounts`, `/transactions`, `/investments` e `/investments/{id}/transactions` com os `itemId`s do MeuPluggy.
- É o mesmo modelo do Actual Budget. A diferença é que o Actual guarda no servidor self-hosted dele.
- Risco: quem tiver o secret lê **todos** os seus dados financeiros. Não publique builds com credenciais.

### 1.5 O que NÃO é garantido (honestidade)
- O MeuPluggy grátis é **cortesia da Pluggy**, não está em contrato. Pode mudar sem aviso, e não há SLA.
- Os dados ficam armazenados na Pluggy (terceiro), não só na sua máquina.
- A atualização é diária, não em tempo real.
- A qualidade do dado OF varia por instituição: descrições de cartão truncadas, parcelas, categoria. A Pluggy tem uma página "Item resources" para separar "o banco não compartilhou" de "não coletamos".
- Não verifiquei se a "Development Application" tem limite de items ou chamadas.

---

## 2. Investimentos

### 2.1 Open Finance fase 4 (Open Investments)
- A fase 4 está ativa. Ela cobre renda fixa (CDB, debêntures, CRA, CRI), renda variável (ações, ETFs, BDRs) e fundos. **Grandes bancos são obrigados; corretoras e bancos digitais participam voluntariamente.** Fonte: https://www.infomoney.com.br/minhas-financas/open-investments-nova-etapa-do-open-finance-agora-abarca-os-investidores-veja-o-que-muda-na-pratica/
- Pela documentação da Pluggy (atualizada em 23/10/2026), **XP ("XP Banking"), BTG ("BTGPactual Investimentos") e Clear ("Clear Corretora")** estão na rede OF com investimentos. Na Clear há só renda variável e Tesouro. Na XP há o leque completo.
- Limitações: o OF traz **posição e movimentações dos últimos 12 meses**. Preço médio e custo de aquisição para IR não são confiáveis via OF. Para isso use notas de corretagem ou o extrato de negociação da B3.

### 2.2 B3 Área do Investidor
- **API:** existe ("Integrações da Área do Investidor"), mas é licenciada: *"startups do sistema financeiro (Fintechs), instituições financeiras e não financeiras que contratarem referida API ('Licença')"*. Há tarifa nova desde 02/01/2025 (Ofício Circular 177/2024-PRE). **Não há API grátis para pessoa física consultar o próprio CPF.**
  - https://b3.com.br/pt_br/produtos-e-servicos/central-depositaria/canal-com-investidores/integracoes-da-area-do-investidor-apis/
  - https://b3.com.br/data/files/D8/E6/92/49/4BAB39107A1B8539AC094EA8/OC%20177-2024%20PRE%20Nova%20tarifacao%20-%20APIs%20Area%20do%20Investidor%20da%20B3%20(PT).pdf
  - https://www.b3.com.br/pt_br/noticias/apis.htm (18/05/2022)
- O CEI foi descontinuado. O substituto é https://www.investidor.b3.com.br (login com CPF e senha).
- **Caminho grátis: exportar à mão** em Extratos > "baixar extrato". Há posição, movimentação (inclui proventos, bonificações, desdobramentos) e negociação (compras/vendas por corretora), em **Excel ou PDF**, com histórico desde **novembro de 2019**. Fontes: https://b3.com.br/pt_br/noticias/b3-lanca-nova-area-logada-do-investidor.htm e https://www.infomoney.com.br/onde-investir/b3-descontinua-cei-a-partir-desta-sexta-investidor-devera-acessar-nova-area-do-site-para-consultar-investimentos/amp/
- Sugestão para o app: importador de `.xlsx` para as 3 abas (Posição, Movimentação, Negociação), deduplicando por (data, ticker, tipo, qtd, valor). Automatizar o login da B3 (scraping) vai contra o espírito do canal, quebra fácil e tem captcha/MFA. Não recomendo.

---

## 3. Notas de corretagem

- **Padrão:** SINACOR (sistema da B3 usado pelas corretoras), em PDF. É o único formato que a calculadora do programa do IR lê. Nubank/NuInvest emite por padrão um modelo **próprio, não SINACOR**, e o SINACOR só sai sob pedido ao atendimento. Fonte: https://blog.nubank.com.br/nota-de-corretagem-nubank-nuinvest/
- **XP, Clear e BTG:** usam SINACOR. XP e Clear são do mesmo grupo e têm layout praticamente igual. Os parsers abaixo tratam XP/Rico/Clear/BTG como SINACOR.
- **Parsers open source:**

| Projeto | Linguagem | Observações |
|---|---|---|
| [correpy](https://github.com/thiagosalvatore/correpy) | Python ≥3.8, `pip install correpy` | Notas "padrão B3 (Sinacor)". Retorna `BrokerageNote` com taxas (liquidação, emolumentos etc.) e transações (compra/venda, qtd, preço, IRRF) |
| [parser-de-notas-de-corretagem](https://github.com/planetsLightningArrester/parser-de-notas-de-corretagem) | JS/TS (npm), roda em Node e no browser | Suporte bom: Rico, Clear, Inter; Nubank em teste. Já calcula preço médio com taxas. Tem app pronto "leitor-de-notas-de-corretagem" |
| [sinacor-parser](https://github.com/samhk222/sinacor-parser) | PHP 8.2+ | Tem `XPParser extends AbstractSinacorParser`, extrai notas e movimentações |
| [SINACOR-PARSER](https://github.com/vcolella/SINACOR-PARSER) | Python | Em desenvolvimento. XP/Rico/Clear na v0.2 e BTG na v0.3 ainda "em breve". Imaturo |

- Para app desktop em JS/TS (Electron/Tauri), `parser-de-notas-de-corretagem` é o encaixe natural. PDFs protegidos por senha (CPF) precisam ser destravados antes.

---

## 4. Cotações, proventos e indicadores

| Fonte | Custo/limite | Token | Observações |
|---|---|---|---|
| **Yahoo Finance** (`query1.finance.yahoo.com/v8/finance/chart/PETR4.SA`) | Grátis, sem limite documentado | Não | **Não oficial**, sem termos de API. Funcionou hoje com User-Agent de navegador [testado 26/10/2026]. Aceita `events=div` para dividendos. Pode quebrar ou bloquear a qualquer hora. Atraso de ~15 min |
| **brapi.dev** grátis | 15.000 req/mês, 1 req simultânea, **1 ticker por requisição**, histórico de 3 meses, atraso de ~30 min, **sem dividendos**, fundamentos básicos | Sim (Bearer). PETR4, MGLU3, VALE3 e ITUB4 funcionam sem token [testado: PETR4 ok, BBAS3 → `MISSING_TOKEN`] | A brapi pede para não expor a chave no front. No desktop, guarde no cofre do SO. Dividendos começam no plano Startup. Fontes: https://brapi.dev/faq/o-plano-gratuito-tem-limitacoes-importantes, https://brapi.dev/docs/authentication |
| **BCB SGS** (`api.bcb.gov.br/dados/serie/bcdata.sgs.{código}/dados`) | Grátis, oficial | Não | Códigos: **12** = CDI diário (% a.d.), **11** = Selic diária, **433** = IPCA mensal, 4389 = CDI anualizado, 1178 = Selic anualizada. **Séries diárias exigem `dataInicial`/`dataFinal`** (janela máx. de 10 anos). Sem intervalo a API respondeu **406** [testado]. `.../ultimos/N` funciona |

**Proventos (dividendos/JCP/rendimentos de FII):**
- A melhor fonte para os **seus** proventos é a B3 Área do Investidor (Excel de Movimentação/Proventos). Ela traz o que foi efetivamente pago, por ativo.
- Para proventos anunciados/futuros, de graça, há Yahoo (`events=div`). Ele é impreciso para JCP (bruto vs. líquido) e para FIIs.
- brapi `/api/v2/stocks/dividends` é a opção boa, mas é paga.
- **StatusInvest:** não tem API pública. O site fica atrás do Cloudflare (o fetch caiu em "Just a moment..."), então não consegui ler os termos de uso. Scraping sistemático provavelmente viola os termos e quebra fácil. **Não recomendo** usar em código.

---

## 5. Plano B para gastos (sem agregador)

| Instituição | Conta | Cartão | Fonte |
|---|---|---|---|
| Nubank | App > Conta > "Pedir extrato" > mês > "Exportar extrato". Chega por e-mail em **PDF, CSV e OFX** (dados até D-1) | Fatura mensal em **PDF** por e-mail. Exportação nativa em CSV/OFX **não confirmada** em 2026 | https://tecnoblog.net/responde/como-tirar-o-extrato-da-conta-nubank-no-aplicativo/, https://tecnoblog.net/responde/como-obter-uma-versao-impressa-da-fatura-do-cartao-nubank/ |
| Bradesco | Internet Banking > Saldos e Extratos > Extrato Mensal/Por Período > "Salvar como arquivo" > **OFX (Money 2000 em diante)**. Janela de ~60 dias | Fatura em PDF [não verificado se há OFX] | https://www.meucontadoronline.com.br/blog/como-exportar-o-extrato-do-bradesco-em-arquivo-ofx/ |
| Mercado Pago | App > Extrato > ⋮ > "Gerar extrato da conta" > período > **PDF, XLSX ou CSV** (use CSV em UTF-8) | Fatura do cartão em PDF [não verificado] | https://www.mercadopago.com.br/blog/como-obter-extrato-mercado-pago |
| XP / BTG / Clear | Extrato da conta em PDF/Excel pelo site/app [não verificado] | Cartão XP/BTG: fatura em PDF [não verificado] | — |

- Para a importação no app: OFX (SGML, padrão 1.x, fácil de parsear) e CSV por banco, com mapeamento de colunas.
- PDF de fatura exige um parser por banco, e o layout muda sem aviso. Use só como último recurso. Para cartão, o Open Finance via MeuPluggy é bem melhor.

---

## Arquitetura sugerida (mínimo que funciona)

1. **Gastos e saldos:** MeuPluggy, com o usuário colando o próprio `client_id`/`client_secret` (guardados no cofre do SO). Sync 1x/dia. Fallback: importar OFX/CSV.
2. **Investimentos:** MeuPluggy (posição atual) + importar Excel da B3 (histórico, proventos, negociação) + notas SINACOR (preço médio/IR).
3. **Preços:** Yahoo `.SA` como principal (sem token) e brapi grátis como reserva. Cache local, 1 consulta por ticker a cada 15 a 30 min.
4. **Indicadores:** BCB SGS com intervalo de datas, guardados localmente.

**Ações para o usuário:** criar conta em meu.pluggy.ai, conectar os 6 bancos **e** criar a Development Application no dashboard.pluggy.ai **dentro dos 15 dias de trial**. Depois disso a lista de conectores não pode mais ser editada.
