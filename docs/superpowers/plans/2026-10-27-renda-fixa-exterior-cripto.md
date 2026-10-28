# Renda fixa, exterior e cripto — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renda fixa da B3 (Posição + Movimentação) com aplicado/valor/rendimento, ações americanas e dólar de conta no exterior por quantidade × cotação, e saldos da Binance por chave só de leitura — tudo no patrimônio do Yield.

**Architecture:** Migração 009 cria `rf_moves`, `rf_positions`, `crypto_balances` e refaz `manual_assets` (classe `exterior` + `currency`). O parser da B3 passa a extrair renda fixa da Movimentação e a ler a Posição; um módulo de domínio puro (`rendaFixa.ts`) cruza os dois; `buildPortfolio` soma renda fixa, exterior e cripto. A Binance tem um cliente com lista fechada de GETs assinados (HMAC via WebCrypto), chave no Keychain.

**Tech Stack:** Tauri 2, React 19 + TS, Vite, Vitest, SQLite (tauri-plugin-sql; testes com `createTestDb` em node:sqlite), SheetJS (`xlsx`), lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-27-renda-fixa-exterior-cripto-design.md`

## Global Constraints

- Repositório **público**: nada de dado real em código, testes, fixtures, commits ou docs. Arquivos reais só em `planilhas/` (gitignored) — **não abrir para copiar valores**. Fixtures inventadas: "Tesouro Prefixado 2099", "Tesouro IPCA+ com Juros Semestrais 2098", "CDB - CDB0000AA00 - BANCO LARANJA S/A", "LCA - LCA00000BB1 - BANCO LIMAO S/A", ticker americano "ZZZZ", instituição "CORRETORA TESTE S/A".
- Commits sem `Co-Authored-By` e sem rodapé "Generated with Claude Code".
- Migrações 001–008 congeladas; tudo novo na `009_renda_fixa_cripto.sql`; `SCHEMA_VERSION = 9` em `src/db/client.ts`; acrescentar o arquivo em `MIGRATIONS` de `src/db/testDb.ts` e o `Migration { version: 9, description: "renda fixa, exterior e cripto", … }` em `src-tauri/src/lib.rs`.
- Centavos inteiros, datas ISO, meses 'YYYY-MM'.
- Segredos só no Keychain (`secret_get`/`secret_set`/`secret_delete`), cache por sessão como `src/openfinance/secrets.ts`.
- Capabilities: acrescentar só `https://api.binance.com/*` em `src-tauri/capabilities/*.json` (bloco `http:default`).
- Juros de renda fixa **nunca** na tabela `dividends` (a Declaração IR e o imposto leem dela).
- Confirmação destrutiva na tela; nunca `window.confirm/alert/prompt`. UI pt-BR com `Select`, `DateField`, `icon-btn`, `card`, `sum-row`, lucide-react.
- Comandos: `npx vitest run <arquivo>` e `npx tsc --noEmit -p .`.

## Fatos verificados no arquivo real (só estrutura)

- Posição: abas `Tesouro Direto` e `Renda Fixa` (cabeçalhos no spec). Fim de cada aba: uma linha só com a 1ª coluna, um cabeçalho repetido e uma linha de total — descartar toda linha sem `Instituição` ou cujo `Produto` seja igual ao nome do cabeçalho.
- Movimentação, tipos de renda fixa: `Compra`, `Venda`, `Juros` (Tesouro); `COMPRA / VENDA`, `PAGAMENTO DE JUROS`, `VENCIMENTO`, `VENCIMENTO/RESGATE SALDO EM CONTA` (CDB). Todos com quantidade, preço e valor > 0, **exceto `VENCIMENTO`, que vem com preço e valor 0** (a B3 não informa o resgate).
- `VENCIMENTO` e `VENCIMENTO/RESGATE SALDO EM CONTA` nunca aparecem juntos para o mesmo produto: são o mesmo evento em formatos diferentes.
- Juros do Tesouro são cupons de título com juros semestrais: saem do `Valor Atualizado` (sem dupla contagem).
- Tesouro: o `Produto` é idêntico nos dois arquivos; a `Instituição` **nem sempre** (escrita diferente). Chave do Tesouro = produto. Renda Fixa: Movimentação `"<TIPO> - <CÓDIGO>[ - <EMISSOR>]"`, Posição `Código` em coluna própria. Chave = código.

## Review Focus

1. Reimportar a mesma Movimentação/Posição → nada duplica, contadores dizem "já existiam". (Task 2)
2. Posição mais antiga importada depois de uma mais nova → valores guardados não mudam. (Task 1)
3. CDB com `VENCIMENTO` de valor 0 → título encerrado, rendimento "desconhecido", não negativo. (Task 3)
4. Título na Posição sem nenhuma compra na Movimentação (CDB) → aparece com valor de hoje, aplicado desconhecido, fora do aportado/Resultado. (Tasks 3 e 4)
5. Chamada à Binance fora da lista (outro path, método POST, outro host) → erro antes de qualquer `fetch`. (Task 6)

---

### Task 1: Migração 009 e repositórios

**Files:**
- Create: `src-tauri/migrations/009_renda_fixa_cripto.sql`, `src/db/rendaFixaRepo.ts`, `src/db/rendaFixaRepo.test.ts`
- Modify: `src/db/client.ts` (SCHEMA_VERSION 9), `src/db/testDb.ts` (MIGRATIONS), `src-tauri/src/lib.rs` (migration 9), `src/db/repo.ts` (`ManualAsset`, `Dataset`, `loadAll`, `saveManualAsset`)

**Interfaces:**
- Produces (em `src/db/rendaFixaRepo.ts`):
  - `type RfMoveKind = 'aplicacao' | 'saida' | 'juros'`
  - `interface RfMove { id: string; key: string; product: string; date: ISODate; kind: RfMoveKind; qty: number; valueCents: Cents | null /* null = B3 não informou */; sourceKey: string }`
  - `interface RfPosition { key: string; family: 'tesouro' | 'rf'; product: string; issuer: string | null; indexer: string; maturity: ISODate | null; qty: number; appliedCents: Cents | null; valueCents: Cents; asOf: ISODate }`
  - `interface CryptoBalance { asset: string; qty: number; costCents: Cents | null; fetchedAt: string }`
  - `upsertRfMoves(db, moves: Omit<RfMove, 'id'>[]): Promise<{ inserted: number; skipped: number }>` — ignora `sourceKey` existente.
  - `upsertRfPositions(db, list: RfPosition[]): Promise<{ updated: number; older: number }>` — só grava se `asOf >= asOf` guardado do mesmo `key`.
  - `saveCryptoBalances(db, list: { asset: string; qty: number }[], fetchedAt: string): Promise<void>` — atualiza qty/fetched_at preservando `cost_cents`; assets ausentes da lista ficam com qty 0.
  - `setCryptoCost(db, asset: string, costCents: Cents | null): Promise<void>`
- Produces (em `src/db/repo.ts`): `ManualAsset` ganha `assetClass: 'renda_fixa' | 'cripto' | 'dolar' | 'exterior' | 'outro'` e `currency: 'BRL' | 'USD'`; `Dataset` ganha `rfMoves: RfMove[]; rfPositions: RfPosition[]; cryptoBalances: CryptoBalance[]`.

- [ ] **Step 1: Testes que falham** em `rendaFixaRepo.test.ts` (com `createTestDb()`):
  - `upsertRfMoves` duas vezes com a mesma lista → segunda chamada `{ inserted: 0, skipped: 2 }`; `loadAll(db).rfMoves.length === 2`.
  - `upsertRfPositions` com `asOf '2026-10-20'` valor 1000, depois `'2026-10-10'` valor 900 → `{ updated: 0, older: 1 }` e valor guardado continua 1000; depois `'2026-10-27'` valor 1100 → `updated: 1`.
  - `saveCryptoBalances([{BTC,0.5},{ETH,2}])`, `setCryptoCost('BTC', 10000)`, `saveCryptoBalances([{BTC,0.6}])` → BTC qty 0.6 cost 10000; ETH qty 0.
  - `saveManualAsset` com `assetClass: 'exterior', currency: 'USD'` volta igual em `loadAll`; um ativo salvo antes (sem currency) vem `'BRL'`.
- [ ] **Step 2:** `npx vitest run src/db/rendaFixaRepo.test.ts` → FAIL (tabela não existe).
- [ ] **Step 3: Migração** `009_renda_fixa_cripto.sql`:
  - `rf_moves(id TEXT PK, key TEXT NOT NULL, product TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('aplicacao','saida','juros')), qty REAL NOT NULL, value_cents INTEGER, source_key TEXT NOT NULL UNIQUE)` + índice em `key`.
  - `rf_positions(key TEXT PK, family TEXT NOT NULL CHECK (family IN ('tesouro','rf')), product TEXT NOT NULL, issuer TEXT, indexer TEXT NOT NULL, maturity TEXT, qty REAL NOT NULL, applied_cents INTEGER, value_cents INTEGER NOT NULL, as_of TEXT NOT NULL)`.
  - `crypto_balances(asset TEXT PK, qty REAL NOT NULL, cost_cents INTEGER, fetched_at TEXT NOT NULL)`.
  - Refazer `manual_assets` (CREATE `manual_assets_new` com `asset_class … CHECK IN ('renda_fixa','cripto','dolar','exterior','outro')` e `currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency IN ('BRL','USD'))`, `INSERT … SELECT`, DROP, RENAME), preservando ids e `source_key UNIQUE`.
- [ ] **Step 4:** Implementar repo, `loadAll` (3 SELECTs novos com aliases camelCase) e `saveManualAsset` com `currency`. Ajustar quem constrói `ManualAsset` (Carteira) para passar `currency`.
- [ ] **Step 5:** `npx vitest run` e `npx tsc --noEmit -p .` → tudo PASS.
- [ ] **Step 6:** Commit `feat: migração 009 com renda fixa, exterior e saldos de cripto`.

### Task 2: Parser da B3 (Movimentação de renda fixa + Posição) e import

**Files:**
- Create: `src/import/b3RendaFixa.ts`, `src/import/b3RendaFixa.test.ts`
- Modify: `src/import/b3.ts` (`B3Import`, `parseMovimentacao`, `parseB3`, `importB3`), `src/pages/configuracoes/build.ts` (`mergeB3`, `b3Summary`), `src/pages/configuracoes/useB3Import.tsx` (nome do arquivo para a data, condição de "Nada encontrado", contagens no aviso), `src/pages/configuracoes/build.test.ts`

**Interfaces:**
- Consumes: `RfMove`, `RfPosition`, `upsertRfMoves`, `upsertRfPositions` (Task 1).
- Produces:
  - `isRendaFixa(produto: string): boolean` — `/^(tesouro|cdb|lci|lca|cri|cra|deb|lig|lf|rdb)\b/i`.
  - `rfKey(produto: string, codigo?: string): string` — Tesouro → `td:` + produto em minúsculas sem espaços duplicados; demais → `rf:` + `codigo` (Posição) ou o 2º pedaço de `produto.split(' - ')` (Movimentação), em maiúsculas.
  - `rfMoveKind(mov: string, entrada: boolean): RfMoveKind | null` — `/juros/i` → `'juros'`; `Compra`/`COMPRA / VENDA` com entrada → `'aplicacao'`; `Venda`/`/VENCIMENTO|RESGATE/i` com saída → `'saida'`; resto → `null`.
  - `parsePosicao(wb: WorkBook, asOf: ISODate): RfPosition[]`; Renda Fixa: valor = 1º preenchido (número) entre `Valor Atualizado CURVA`, `Valor Atualizado MTM`, `Valor Atualizado FECHAMENTO`; `appliedCents` = `Valor Aplicado` no Tesouro, `null` na Renda Fixa; `issuer` = `Emissor` (null no Tesouro); `indexer` = `Indexador`.
  - `posicaoDate(fileName: string): ISODate | null` — `posicao-AAAA-MM-DD`.
  - `B3Import` ganha `rfMoves: Omit<RfMove, 'id'>[]` e `rfPositions: RfPosition[]`.
  - `parseB3(data: ArrayBuffer, fileName = '', today = todayISO()): B3Import` — se `SheetNames` contém `Tesouro Direto` ou `Renda Fixa`, é Posição (`asOf = posicaoDate(fileName) ?? today`).
  - `importB3` devolve também `rfMoves: { inserted, skipped }` e `rfPositions: { updated, older }`.

- [ ] **Step 1: Testes que falham** em `b3RendaFixa.test.ts`, montando planilhas inventadas com `utils.aoa_to_sheet`/`book_new` (padrão dos testes de `b3.ts`):
  - Movimentação com as 7 linhas-tipo do quadro de Fatos (produtos de fixture) + uma ação comum → 7 `rfMoves` com kinds `aplicacao, saida, juros, aplicacao, juros, saida, saida`; a linha `VENCIMENTO` com valor 0 sai com `valueCents: null`; a ação continua indo para onde ia; `ignored` não conta as linhas de renda fixa.
  - Tipo de renda fixa desconhecido (ex. `Amortização` num CDB) → `toReview` com nota contendo "renda fixa".
  - `rfKey('CDB - CDB0000AA00 - BANCO LARANJA S/A') === rfKey('CDB - BANCO LARANJA S/A', 'CDB0000AA00')` e `rfKey('Tesouro Prefixado 2099') === rfKey('TESOURO  PREFIXADO 2099')`.
  - Posição com 2 linhas de Tesouro, 1 de Renda Fixa com MTM `"-"` e CURVA numérica, mais as 3 linhas de rodapé e a aba `Acoes` → 3 posições; valor da Renda Fixa = CURVA; rodapé descartado.
  - `posicaoDate('posicao-2026-10-27-22-28-51.xlsx') === '2026-10-27'`; nome sem data → `parseB3` usa `today`.
  - `importB3` duas vezes com a mesma Movimentação → 2ª vez `rfMoves.inserted === 0`.
  - Em `build.test.ts`: `b3Summary` mostra "N movimentações de renda fixa" e "N títulos de renda fixa atualizados" (e "N já existiam"/"N mais antigos ignorados" quando > 0).
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar. `sourceKey` das linhas = `b3rf:${date}:${mov}:${produto}:${inst}:${qty}:${valor}` via `uniqueKey`. `parseMovimentacao` desvia para renda fixa **antes** dos ramos atuais quando `isRendaFixa(produto)`. `useB3Import` passa `file.name`.
- [ ] **Step 4:** `npx vitest run` + tsc → PASS.
- [ ] **Step 5:** Commit `feat: importa renda fixa da Movimentação e da Posição da B3`.

### Task 3: Domínio de renda fixa

**Files:**
- Create: `src/domain/rendaFixa.ts`, `src/domain/rendaFixa.test.ts`

**Interfaces:**
- Consumes: `RfMove`, `RfPosition` (Task 1).
- Produces:
  - `interface RfHolding { key: string; name: string; issuer: string | null; indexer: string | null; maturity: ISODate | null; qty: number; appliedCents: Cents | null /* aplicado ainda no título */; investedCents: Cents | null /* total já aplicado */; receivedCents: Cents; valueCents: Cents | null; gainCents: Cents | null; gainPct: number | null; closed: boolean; asOf: ISODate | null; needsNewerPosicao: boolean }`
  - `rfHoldings(moves: RfMove[], positions: RfPosition[]): RfHolding[]` — ativos primeiro (por valor desc), depois encerrados.
  - `rfJuros(moves: RfMove[]): { date: ISODate; product: string; valueCents: Cents }[]`
  - `rfJurosByMonth(moves: RfMove[], end: Month, n: number): { month: Month; cents: Cents }[]`

Regras (do spec): aplicado por custo médio (saída de x% da quantidade tira x% do aplicado); `received` = juros + saídas com valor; `valueCents` da Posição do mesmo `key`; se não há Posição: qty líquida ≈ 0 → valor 0 e `closed`; senão `valueCents null` e `needsNewerPosicao`. Sem compras na Movimentação: `appliedCents/investedCents` = `appliedCents` da Posição (Tesouro) ou `null`. `gainCents = value + received − invested` só quando nenhum termo é desconhecido (uma saída com `valueCents null` torna o ganho `null`). `name`: Tesouro = produto; RF = `"<TIPO> <EMISSOR>"` da Posição ou o produto da Movimentação.

- [ ] **Step 1: Testes que falham:**
  - Compra 10 × R$100 (1000,00), venda de 4 por 450,00, juros 30,00, Posição valor 700,00 → `appliedCents 60000`, `investedCents 100000`, `receivedCents 48000`, `gainCents 18000`, `gainPct 0.18`, `closed false`.
  - CDB com aplicação 500,00 e `VENCIMENTO` qty total valor `null`, sem Posição → `closed true`, `valueCents 0`, `gainCents null`.
  - CDB com aplicação e `VENCIMENTO/RESGATE SALDO EM CONTA` de 560,00 → `closed`, `gainCents 6000`.
  - Só Posição (CDB, sem moves) → `investedCents null`, `gainCents null`, valor da Posição; Tesouro só Posição com `appliedCents` → ganho calculado.
  - Moves com qty > 0 e sem Posição → `needsNewerPosicao true`, `valueCents null`.
  - `rfJurosByMonth` agrupa por mês e preenche meses vazios com 0.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat: aplicado, valor e rendimento por título de renda fixa`.

### Task 4: Patrimônio (portfolio) com renda fixa, exterior e cripto

**Files:**
- Modify: `src/domain/portfolio.ts`, `src/domain/portfolio.test.ts`, `src/state/DataProvider.tsx` (passa `rfHoldings(...)` e `cryptoBalances`; símbolos de cotação novos: `BRL=X` sempre que houver exterior, `<ASSET>-BRL` de cada saldo de cripto > 0 exceto `BRL`)

**Interfaces:**
- Consumes: `RfHolding`, `rfHoldings` (Task 3), `CryptoBalance`, `ManualAsset.currency` (Task 1).
- Produces:
  - `buildPortfolio(positions, quotes, manual, dividends, today, extra: { rf: RfHolding[]; crypto: CryptoBalance[] } = { rf: [], crypto: [] }): Portfolio`
  - `ManualRow` ganha `usdCents: Cents | null` (valor em US$ quando `currency === 'USD'`).
  - `Portfolio` ganha `rf: RfHolding[]`, `crypto: { asset: string; qty: number; valueCents: Cents | null; costCents: Cents | null }[]`, `rfGainCents: Cents` (soma dos ganhos dos títulos **abertos** com ganho conhecido), `noCostCount: number` (itens com valor e sem aportado: manuais, exterior, cripto sem custo, títulos com `investedCents null`).

Regras: exterior = qty × cotação(quoteSymbol, US$) × cotação(`BRL=X`); sem uma das duas → `valueCents null`. Cripto: `BRL` vale a própria qty; demais qty × `<ASSET>-BRL`. `totalValueCents` soma tudo com valor; `totalCostCents` soma renda variável + `appliedCents` dos títulos abertos conhecidos + `costCents` de cripto conhecidos. `byClass`: `renda_fixa` com custo = aplicado dos títulos abertos com aplicado conhecido (se todos desconhecidos, `costCents null`) somado aos manuais RF (valor só); classe `exterior` e `cripto` (cripto com custo quando todos os saldos tiverem custo).

- [ ] **Step 1: Testes que falham:** exterior 2 × US$ 50,00 com `BRL=X` 5,00 → 50000 centavos e `usdCents 10000`; sem `BRL=X` → null e fora do total; título aberto entra no total e no aportado; título com `investedCents null` entra no total, não no aportado, e soma em `noCostCount`; cripto 0,5 BTC × 300000,00 → 15000000; BRL 100 → 10000.
- [ ] **Step 2–4:** FAIL → implementar → PASS (ajustar testes antigos de `buildPortfolio` só se a assinatura exigir).
- [ ] **Step 5:** Commit `feat: patrimônio com renda fixa, exterior e cripto`.

### Task 5: Telas — Carteira, Proventos e Resumo

**Files:**
- Modify: `src/pages/Carteira.tsx`, `src/pages/Proventos.tsx`, `src/pages/ResumoInvestimentos.tsx`, `src/pages/resumoInvestimentos/build.ts` (`classLabel`/`classColor` com `exterior`, `topPositions` incluindo títulos e cripto), `src/pages/resumoInvestimentos/build.test.ts`, `src/App.css` se precisar

**Interfaces:**
- Consumes: `Portfolio.rf/crypto/rfGainCents/noCostCount`, `ManualRow.usdCents` (Task 4), `rfJuros`, `rfJurosByMonth` (Task 3).

Comportamento:
- **Carteira › Renda fixa** (card próprio, acima dos ativos manuais): por título aberto — nome, emissor (ou "Tesouro Nacional"), indexador · vence dd/mm/aaaa, aplicado, valor de hoje, rendimento R$ e % (cor up/dn), "valor de dd/mm" (`asOf`). Desconhecidos mostram "aplicado desconhecido"/"—". `needsNewerPosicao` → tag "importe uma Posição mais recente". Link "ver encerrados (N)" expande os encerrados com rendimento final ou "sem valor de resgate na B3". Vazio: texto apontando para Configurações › B3 (Posição + Movimentação).
- **Aviso de duplicidade:** se há título da B3 **e** ativo manual `renda_fixa` (ou saldo Binance **e** manual `cripto`), aviso no topo do card de ativos manuais: "Você tem N ativos manuais de renda fixa; se já vieram da B3, exclua para não contar duas vezes." com os nomes.
- **Ativo manual:** opção "Exterior (US$)" no Select de classe → campos ticker (vai para `quoteSymbol`, maiúsculo) e quantidade, `currency 'USD'`; classe "Dólar" preenche `quoteSymbol 'BRL=X'` se vazio. Linha de exterior mostra o valor em R$ e "US$ x" embaixo.
- **Proventos:** série nova "Juros RF" no gráfico por mês (somando `rfJurosByMonth`) e, na lista do mês, as linhas de juros como somente leitura (tag "renda fixa", sem editar/excluir). Totais por tipo ganham "Juros RF". Filtro de ticker não se aplica a elas (some quando há ticker filtrado).
- **Resumo de investimentos:** Resultado = `varTotal + p.rfGainCents`; card Patrimônio acrescenta "· N itens sem aportado" quando `noCostCount > 0`; "Proventos por mês" ganha a série "Juros RF"; Renda passiva usa `dividends12m + juros RF 12m`; "Por classe" mostra variação real da renda fixa (custo não nulo) e "valor de hoje" para exterior/cripto sem custo.

- [ ] **Step 1: Testes que falham** em `resumoInvestimentos/build.test.ts`: `topPositions` inclui um título de renda fixa e um saldo de cripto com rótulos "Renda fixa"/"Cripto"; `classLabel('exterior') === 'Exterior'`.
- [ ] **Step 2–4:** FAIL → implementar → PASS; tsc limpo.
- [ ] **Step 5: Ver na tela** com dados inventados (harness Vite com banco fake, como nas screenshots anteriores; não usar o banco real nem capturar a tela do usuário): Carteira com 2 títulos abertos + 1 encerrado, 1 exterior, aviso de duplicidade; Resumo com Juros RF.
- [ ] **Step 6:** Commit `feat: renda fixa, exterior e juros nas telas de carteira, proventos e resumo`.

### Task 6: Cliente da Binance (só leitura)

**Files:**
- Create: `src/cripto/binance.ts`, `src/cripto/binance.test.ts`, `src/cripto/secrets.ts`
- Modify: `src-tauri/capabilities/default.json` (ou o arquivo onde está `http:default`)

**Interfaces:**
- Produces:
  - `BINANCE_BASE = 'https://api.binance.com'`; `ALLOWED = new Set(['GET /api/v3/account', 'GET /sapi/v1/simple-earn/flexible/position', 'GET /sapi/v1/simple-earn/locked/position'])`
  - `class BinanceError extends Error { kind: 'chave' | 'rede' | 'resposta' }`
  - `binanceRequest(method: string, url: string): URL` — lança `BinanceError('Chamada não permitida: o Yield só lê dados da Binance', 'resposta')` fora da lista (mesmo padrão de `pluggyRequest`).
  - `sign(secret: string, query: string): Promise<string>` — HMAC-SHA256 hex via `crypto.subtle`.
  - `fetchBinanceBalances(creds: { apiKey: string; secret: string }, fetchFn: typeof fetch, now = Date.now): Promise<{ balances: { asset: string; qty: number }[]; earnSkipped: boolean }>` — soma `free + locked` do spot, **descarta ativos com prefixo `LD`** (espelho do Earn no spot) e soma `totalAmount` (flexível) e `amount` (travado) do Earn; erro 401/403 nos endpoints de Earn → `earnSkipped: true` sem falhar; erro no `/account` → `BinanceError` ('chave' para 401/-2014/-2015, 'rede' para falha de fetch). Query com `timestamp` e `recvWindow=10000`, header `X-MBX-APIKEY`, assinatura em `signature`.
  - `src/cripto/secrets.ts`: `BINANCE_KEYS = { apiKey: 'binance.apiKey', secret: 'binance.secret' }`, `getBinanceCredentials()`, `setBinanceCredentials(apiKey, secret)`, `clearBinanceCredentials()` — cópia do padrão de `src/openfinance/secrets.ts` (cache por sessão, falha não cacheada, validação de vazio "Preencha a API Key e a Secret Key.").

- [ ] **Step 1: Testes que falham:**
  - `sign('NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j', 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559')` === `'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71'` (exemplo público da documentação da Binance).
  - `binanceRequest('POST', BINANCE_BASE + '/api/v3/order')`, `binanceRequest('GET', BINANCE_BASE + '/sapi/v1/capital/withdraw/apply')` e `binanceRequest('GET', 'https://evil.example/api/v3/account')` lançam; `fetchFn` mock nunca é chamado.
  - `fetchBinanceBalances` com mock: spot `[{asset:'BTC',free:'0.4',locked:'0.1'},{asset:'LDBTC',free:'9',locked:'0'},{asset:'ETH',free:'0',locked:'0'}]`, flexível `{rows:[{asset:'BTC',totalAmount:'0.2'}]}`, travado 403 → `[{asset:'BTC',qty:0.7}]`, `earnSkipped: true`; toda URL chamada tem `signature=` e header `X-MBX-APIKEY`.
  - `/account` 401 → `BinanceError` kind `'chave'`.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat: cliente só leitura da Binance`.

### Task 7: Binance nas telas e sincronização

**Files:**
- Create: `src/pages/configuracoes/Binance.tsx`
- Modify: `src/pages/Configuracoes.tsx` (seção depois de `<OpenFinance />`), `src/state/DataProvider.tsx` (`syncBinance`, estado `binanceSyncing`, `binanceError`), `src/pages/Carteira.tsx` (card Cripto)

**Interfaces:**
- Consumes: `getBinanceCredentials`, `setBinanceCredentials`, `clearBinanceCredentials`, `fetchBinanceBalances`, `BinanceError` (Task 6); `saveCryptoBalances`, `setCryptoCost` (Task 1); `Portfolio.crypto` (Task 4).
- Produces: `AppData` ganha `binance: { syncing: boolean; error: string | null; earnSkipped: boolean; syncNow(): Promise<void> }`.

Comportamento:
- **Configurações › Binance:** guia curta (criar chave em binance.com › Gerenciamento de API, marcar **só "Enable Reading"**, sem trade e sem saque; restrição de IP opcional), campos API Key e Secret Key (tipo senha), Salvar → Keychain + `syncNow`; com chave salva: "Chave salva" + "Remover chave" com confirmação na tela.
- **Sync:** ao abrir o app (se houver chave) e pelo botão "Atualizar" no card Cripto; grava com `saveCryptoBalances(db, balances, new Date().toISOString())` e `reload()`. Erros viram `binance.error` exibido no card Cripto ("Binance: chave inválida ou sem permissão de leitura" / "sem conexão com a Binance"); `earnSkipped` → nota "saldos do Earn não lidos: a chave não tem acesso".
- **Carteira › Cripto:** uma linha por saldo > 0: moeda, quantidade, valor em R$ (ou "sem cotação"), "saldo de dd/mm hh:mm", campo "aportado" editável (R$, salva com `setCryptoCost`; vazio = desconhecido) e rendimento quando há aportado.
- Ruling registrado no plano: **aportado automático pelo histórico da Binance fica de fora desta entrega** (o implementador não tem chave real para validar os endpoints de compra; o spec permite cair no aportado à mão).

- [ ] **Step 1: Teste que falha** (função pura em `src/pages/configuracoes/build.ts`): `binanceErrorText(new BinanceError('x','chave'))` → "Binance: chave inválida ou sem permissão de leitura"; `'rede'` → "Sem conexão com a Binance"; erro genérico → mensagem dele.
- [ ] **Step 2–4:** FAIL → implementar → PASS; tsc limpo.
- [ ] **Step 5: Ver na tela** com dados fake (fetch mockado no harness), sem chave real.
- [ ] **Step 6:** Commit `feat: saldos da Binance na carteira`.

### Task 8: Docs e fechamento

**Files:**
- Modify: `README.md` (renda fixa pela Posição/Movimentação da B3, exterior, Binance só leitura e o domínio novo na seção de privacidade), `CHANGELOG.md` ("Próxima versão": renda fixa, exterior, Binance, olhinho nos resumos)

- [ ] **Step 1:** Atualizar README e CHANGELOG (sem dados reais).
- [ ] **Step 2:** `npx vitest run` e `npx tsc --noEmit -p .` → PASS.
- [ ] **Step 3:** Commit `docs: renda fixa, exterior e cripto no README e no changelog`.
- [ ] **Step 4 (manual, dono):** backup do banco real em `antes-009-yield.db`, build local assinado, importar Posição + Movimentação reais e conferir os números com o app da corretora.
