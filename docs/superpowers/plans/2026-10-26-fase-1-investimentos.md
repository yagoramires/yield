# Yield — Fase 1 (Investimentos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um app desktop local (Windows + macOS) que substitui a planilha de investimentos do Yago: importa o histórico, calcula carteira, preço médio e IR/DARF mensal desde 2020, lê notas da Clear em PDF, busca cotações e controla proventos.

**Architecture:** Tauri 2 com front React + TypeScript. Toda a regra de negócio é TypeScript puro em `src/domain/` (sem I/O, testado com Vitest). Os dados vivem num SQLite local via `@tauri-apps/plugin-sql`, atrás de uma interface `Db` mínima para que os testes rodem com `node:sqlite`. O app guarda só fatos de origem (notas, eventos, proventos, pagamentos) e recalcula tudo em memória a cada mudança, em ordem cronológica.

**Tech Stack:** Tauri 2, React 19, TypeScript, Vite, Vitest, SQLite (`@tauri-apps/plugin-sql`), `@tauri-apps/plugin-http` (fetch sem CORS), `@tauri-apps/plugin-dialog`, SheetJS (`xlsx` 0.20.3 do CDN oficial), `pdfjs-dist`.

**Spec:** `docs/superpowers/specs/2026-10-26-yield-design.md` (com apoio em `docs/analise-planilha-investimentos.md` e `docs/pesquisa-open-finance.md`).

**Fora desta fase (decisões tomadas aqui):** Bens e Direitos / fichas DIRPF (P1 da spec, plano próprio depois); brapi como reserva de cotação (fica só Yahoo + preço manual); renda fixa atualizada por indicador (valor manual); importação da aba `Movimentações` (é derivada das notas; serve só de conferência); quantidades de dólar/BTC escritas dentro das fórmulas da `Visão Geral` (o resumo da importação pede para lançar à mão); gráficos.

## Global Constraints

- Interface toda em **pt-BR**. Valores com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
- Dinheiro sempre em **centavos inteiros** (`Cents = number`). Datas `YYYY-MM-DD`, meses `YYYY-MM`, sempre string.
- Tickers sempre passam por `normalizeTicker` antes de entrar no motor ou no banco.
- **Nenhum dado real no git**: `planilhas/`, `notas/`, `.superpowers/` estão no `.gitignore`. Fixtures são sintéticas.
- Commits **sem** linha `Co-Authored-By` (preferência do Yago).
- Sem backend, sem conta, sem telemetria. Só sai da máquina: requisição de cotação ao Yahoo.
- Tema **Grafite**: fundo `#0b0c0d`, barra lateral `#121315`, superfície `#1a1b1f`, borda `#26282e`, texto `#d6d8dd`, texto secundário `#8a8d96`, texto apagado `#5d6068`, acento `#c6ff3d`, fundo do acento `#1c2410`, negativo `#ff6b6b`. Fonte `-apple-system, "SF Pro Display", Inter, "Segoe UI", sans-serif`.
- Navegação **A** (decisão 3 da spec): barra lateral com as três páginas e todas as subseções sempre visíveis. Nesta fase só Investimentos funciona; Últimos gastos e Orçamento mensal aparecem desabilitados com "em breve".
- Day trade fora do app: compra e venda do mesmo ticker, mesmo dia e mesma corretora gera aviso, nunca cálculo de day trade.
- IR cobre só renda variável na B3 (Ação, FII, ETF, BDR). Cripto e dólar não entram, e a tela diz isso.
- Antes de construir cada tela, mockup aprovado pelo Yago (Task 13).
- Identificador do app: `com.yagoramires.yield`. Título da janela: `Yield`.

## Review Focus

1. **Ticker do mercado fracionário** (`ITSA4F`) precisa somar na mesma posição que `ITSA4`. Teste na Task 4.
2. **Venda maior que a posição** (histórico incompleto, que é o caso real dele): aviso visível e mês marcado como incompleto no IR, nunca imposto calculado em silêncio sobre custo zero. Testes nas Tasks 4 e 5.
3. **Importar o mesmo arquivo duas vezes** (planilha, extrato B3 ou PDF de nota) não duplica nada. Testes nas Tasks 7, 8 e 9.
4. **Importar como backup um arquivo que não é do Yield** não apaga os dados atuais. Teste na Task 10.
5. **Números no formato brasileiro** vindos de planilha e PDF (`1.234,56`, `R$ 10,85`, `-`, célula numérica já convertida pelo Excel) viram centavos corretos. Teste na Task 7 (`parseBRL`), usado pelas Tasks 7, 8 e 9.

---

## Estrutura de arquivos

```
yield/
  package.json, vite.config.ts, tsconfig.json, index.html
  src-tauri/                      Tauri (Rust mínimo: plugins + migração)
    migrations/001_init.sql       esquema do banco (lido pelo Rust e pelos testes)
    src/lib.rs, tauri.conf.json, capabilities/default.json
  src/
    main.tsx, App.tsx             shell + rota simples por estado
    theme.css                     tokens Grafite
    ui/Sidebar.tsx                navegação A
    domain/                       regra pura, sem I/O
      types.ts  money.ts  calendar.ts  fees.ts  ledger.ts  tax.ts  darf.ts  portfolio.ts
    db/
      client.ts                   interface Db + openDb (Tauri)
      testDb.ts                   Db sobre node:sqlite para testes
      repo.ts                     leitura/escrita do Dataset
      backup.ts                   exportar/importar
    import/
      parse.ts                    parseBRL, parseBRDate
      planilha.ts                 .xlsm da planilha antiga
      b3.ts                       extrato de movimentação da B3
      clearPdf.ts                 texto de nota SINACOR da Clear → rascunho
      pdfText.ts                  extração de texto com pdfjs
    quotes/yahoo.ts               cotação + atualização
    state/DataProvider.tsx        carrega Dataset e deriva tudo com useMemo
    pages/                        Carteira, Notas, Proventos, Imposto, Configuracoes
  tests/fixtures/                 arquivos sintéticos
```

---

### Task 1: Esqueleto do app com tema Grafite e barra lateral

**Files:**
- Create: projeto Tauri 2 + React + TS em `yield/` (Vite), `src/theme.css`, `src/ui/Sidebar.tsx`, `src/App.tsx`
- Create: `vitest.config.ts` (ambiente `node`, `include: ['src/**/*.test.ts']`)
- Test: `src/ui/routes.test.ts`

**Interfaces:**
- Produces: `type Route = 'carteira' | 'notas' | 'proventos' | 'imposto' | 'configuracoes'`; `const ROUTES: { page: 'Últimos gastos' | 'Orçamento mensal' | 'Investimentos' | 'Sistema'; items: { route: Route | null; label: string; disabled: boolean }[] }[]` em `src/ui/routes.ts`; `<Sidebar route onNavigate />`.

- [ ] **Step 1:** Criar o projeto com `pnpm create tauri-app` (template React + TypeScript, gerenciador pnpm) dentro de `yield/` sem apagar `docs/`, `.gitignore`, `planilhas/`, `notas/`. Ajustar `tauri.conf.json`: identifier `com.yagoramires.yield`, título `Yield`, janela 1200×780, mínimo 960×640.
- [ ] **Step 2: Teste que falha**

```ts
import { ROUTES } from './routes'
test('Investimentos tem as 4 subseções ativas e as outras páginas ficam em breve', () => {
  const inv = ROUTES.find(p => p.page === 'Investimentos')!
  expect(inv.items.map(i => i.label)).toEqual(['Carteira', 'Notas', 'Proventos', 'Imposto'])
  expect(inv.items.every(i => !i.disabled)).toBe(true)
  const gastos = ROUTES.find(p => p.page === 'Últimos gastos')!
  expect(gastos.items.map(i => i.label)).toEqual(['Lançamentos', 'Assinaturas', 'Categorias'])
  expect(gastos.items.every(i => i.disabled && i.route === null)).toBe(true)
  const orc = ROUTES.find(p => p.page === 'Orçamento mensal')!
  expect(orc.items.map(i => i.label)).toEqual(['Mês atual'])
  expect(ROUTES.at(-1)!.items[0]).toMatchObject({ route: 'configuracoes', label: 'Configurações' })
})
```

- [ ] **Step 3:** `pnpm vitest run src/ui/routes.test.ts` → FAIL (módulo não existe).
- [ ] **Step 4:** Implementar `routes.ts`, `theme.css` com os tokens das Global Constraints como variáveis CSS, `Sidebar.tsx` no layout do mockup aprovado (`.superpowers/brainstorm/*/content/navegacao.html`, opção A: logo "● Yield" com o ponto no acento, grupos por página, item ativo com fundo do acento, desabilitados com texto apagado e sufixo "em breve"), `App.tsx` com `useState<Route>('carteira')` e uma página placeholder por rota.
- [ ] **Step 5:** `pnpm vitest run` → PASS. `pnpm tauri dev` → a janela abre com a barra lateral e troca de página ao clicar.
- [ ] **Step 6: Commit** `feat: esqueleto Tauri com tema Grafite e navegação`

---

### Task 2: Tipos, dinheiro e calendário de dias úteis

**Files:**
- Create: `src/domain/types.ts`, `src/domain/money.ts`, `src/domain/calendar.ts`
- Test: `src/domain/money.test.ts`, `src/domain/calendar.test.ts`

**Interfaces:**
- Produces (`types.ts`, usados por todas as tasks seguintes):

```ts
export type Cents = number
export type ISODate = string            // 'YYYY-MM-DD'
export type Month = string              // 'YYYY-MM'
export type AssetType = 'Ação' | 'FII' | 'ETF' | 'BDR'
export type Side = 'C' | 'V'
export interface Trade {
  id: string; noteId: string; seq: number; broker: string
  tradeDate: ISODate; settleDate: ISODate; side: Side; assetType: AssetType
  ticker: string; qty: number; priceCents: Cents; feesCents: Cents; irrfCents: Cents
}
export type CorporateEvent =
  | { id: string; kind: 'bonificacao'; ticker: string; date: ISODate; qtyDelta: number; unitCostCents: Cents | null }
  | { id: string; kind: 'desdobramento' | 'grupamento'; ticker: string; date: ISODate; qtyDelta: number }
  | { id: string; kind: 'mudanca_ticker'; ticker: string; newTicker: string; date: ISODate }
export interface Position { ticker: string; assetType: AssetType; qty: number; totalCostCents: Cents }
export interface Sale {
  tradeId: string; tradeDate: ISODate; settleDate: ISODate; ticker: string; assetType: AssetType
  qty: number; grossCents: Cents; netCents: Cents; costBasisCents: Cents; resultCents: Cents; irrfCents: Cents
}
export type WarningKind = 'day_trade' | 'venda_maior_que_posicao' | 'bonificacao_sem_custo'
export interface Warning { kind: WarningKind; ticker: string; date: ISODate; detail: string }
export type DividendKind = 'Dividendo' | 'JCP' | 'Rendimento'
export interface Dividend {
  id: string; ticker: string; kind: DividendKind; payDate: ISODate; amountCents: Cents
  broker: string | null; source: 'b3' | 'planilha' | 'manual'; sourceKey: string | null
}
export interface DarfPayment { month: Month; paidAt: ISODate; amountCents: Cents }
```

- Produces: `formatBRL(c: Cents): string`; `monthOf(d: ISODate): Month`; `addMonths(m: Month, n: number): Month`; `monthsBetween(from: Month, to: Month): Month[]` (inclusivo); `nationalHolidays(year: number): ISODate[]`; `isBusinessDay(d: ISODate): boolean`; `lastBusinessDayOfMonth(m: Month): ISODate`.

- [ ] **Step 1: Testes que falham**

```ts
// money.test.ts
expect(formatBRL(123456)).toBe('R$ 1.234,56')          // comparar com   normalizado para espaço
expect(formatBRL(-5)).toBe('-R$ 0,05')
expect(addMonths('2024-12', 1)).toBe('2025-01')
expect(monthsBetween('2023-11', '2024-02')).toEqual(['2023-11', '2023-12', '2024-01', '2024-02'])

// calendar.test.ts
expect(lastBusinessDayOfMonth('2024-03')).toBe('2024-03-28')   // 29 = Sexta-feira Santa, 30–31 fim de semana
expect(lastBusinessDayOfMonth('2022-02')).toBe('2022-02-25')   // 28 = segunda de Carnaval
expect(lastBusinessDayOfMonth('2025-02')).toBe('2025-02-28')
expect(isBusinessDay('2024-11-20')).toBe(false)                // Consciência Negra, feriado nacional desde 2024
expect(isBusinessDay('2023-11-20')).toBe(true)
expect(isBusinessDay('2024-02-13')).toBe(false)                // terça de Carnaval
expect(isBusinessDay('2024-05-30')).toBe(false)                // Corpus Christi
expect(isBusinessDay('2024-12-25')).toBe(false)
```

- [ ] **Step 2:** `pnpm vitest run src/domain` → FAIL.
- [ ] **Step 3:** Implementar. Feriados: fixos 01-01, 04-21, 05-01, 09-07, 10-12, 11-02, 11-15, 12-25, 11-20 a partir de 2024; móveis a partir da Páscoa (algoritmo de Meeus/Butcher): Carnaval segunda e terça (Páscoa −48 e −47), Sexta-feira Santa (−2), Corpus Christi (+60). Datas sempre manipuladas em UTC para não sofrer com fuso.
- [ ] **Step 4:** `pnpm vitest run src/domain` → PASS.
- [ ] **Step 5: Commit** `feat: tipos do domínio, dinheiro e calendário de dias úteis`

---

### Task 3: Rateio de taxas da nota

**Files:**
- Create: `src/domain/fees.ts`
- Test: `src/domain/fees.test.ts`

**Interfaces:**
- Produces:

```ts
export interface NoteItemInput { side: Side; assetType: AssetType; ticker: string; qty: number; priceCents: Cents }
export interface NoteFees {
  liquidacaoCents: Cents; registroCents: Cents; emolumentosCents: Cents
  operacionalCents: Cents; issCents: Cents; outrosCents: Cents; irrfCents: Cents
}
export function allocateFees(items: NoteItemInput[], fees: NoteFees): (NoteItemInput & { feesCents: Cents; irrfCents: Cents })[]
```

Regras (da planilha, análise §4 "Distribuir Taxas"): `operacional` dividido igualmente entre os itens; `iss` proporcional ao operacional de cada linha; `liquidacao + registro + emolumentos + outros` proporcional ao valor bruto (`qty × priceCents`); `irrf` só entre as vendas, proporcional ao bruto. Em cada rateio, cada linha recebe `Math.floor` da sua parte e a **última** linha elegível recebe o resto, para a soma bater exatamente. IRRF não entra em `feesCents`.

- [ ] **Step 1: Testes que falham**

```ts
const items = [
  { side: 'C', assetType: 'Ação', ticker: 'ITSA4', qty: 100, priceCents: 1000 },   // bruto 100000
  { side: 'C', assetType: 'FII', ticker: 'HGLG11', qty: 10, priceCents: 16000 },   // bruto 160000
  { side: 'V', assetType: 'FII', ticker: 'MXRF11', qty: 100, priceCents: 1000 },   // bruto 100000
]
const zero = { liquidacaoCents: 0, registroCents: 0, emolumentosCents: 0, operacionalCents: 0, issCents: 0, outrosCents: 0, irrfCents: 0 }
test('rateia por bruto, operacional igual, ISS sobre operacional e IRRF só nas vendas', () => {
  const r = allocateFees(items, { ...zero, liquidacaoCents: 90, operacionalCents: 300, issCents: 15, irrfCents: 5 })
  expect(r.map(x => x.feesCents)).toEqual([130, 145, 130])
  expect(r.map(x => x.irrfCents)).toEqual([0, 0, 5])
})
test('resto do arredondamento vai para a última linha', () => {
  const r = allocateFees(items, { ...zero, operacionalCents: 100, issCents: 10 })
  expect(r.map(x => x.feesCents)).toEqual([33 + 3, 33 + 3, 34 + 4])
})
test('IRRF entre duas vendas', () => {
  const sells = [
    { side: 'V', assetType: 'Ação', ticker: 'A', qty: 100, priceCents: 1000 },
    { side: 'V', assetType: 'Ação', ticker: 'B', qty: 100, priceCents: 2000 },
  ]
  expect(allocateFees(sells, { ...zero, irrfCents: 3 }).map(x => x.irrfCents)).toEqual([1, 2])
})
test('nota sem vendas e com IRRF lança erro', () => {
  expect(() => allocateFees(items.slice(0, 2), { ...zero, irrfCents: 1 })).toThrow('IRRF sem venda na nota')
})
```

- [ ] **Step 2:** `pnpm vitest run src/domain/fees.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `allocateFees`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: rateio de taxas da nota de corretagem`

---

### Task 4: Motor de posições e vendas (replay cronológico)

**Files:**
- Create: `src/domain/ledger.ts`
- Test: `src/domain/ledger.test.ts`

**Interfaces:**
- Consumes: tipos da Task 2.
- Produces:

```ts
export function normalizeTicker(t: string): string
export interface ReplayResult { positions: Position[]; sales: Sale[]; warnings: Warning[] }
export function replay(trades: Trade[], events: CorporateEvent[]): ReplayResult
```

Regras:
- Ordem: por data; no mesmo dia, eventos antes de trades; trades do mesmo dia por `noteId` e `seq`. O resultado não depende da ordem de entrada dos arrays.
- Posição por ticker normalizado, somando todas as corretoras. Compra: `qty += q`, `totalCost += q × price + fees`. `assetType` vem do primeiro trade do ticker.
- Venda: `gross = q × price`, `net = gross − fees`, `costBasis = Math.round(totalCost × q / qty)`, `result = net − costBasis`; depois `qty −= q`, `totalCost −= costBasis`. Quando a posição zera, `totalCost = 0`.
- Venda com `q` maior que a posição: vende só o que existe (se existir), gera `venda_maior_que_posicao` com o excedente em `detail`. Sem venda a descoberto.
- Compra e venda do mesmo ticker na mesma data e corretora: aviso `day_trade` (uma vez por ticker+data+corretora), cálculo normal.
- `desdobramento`/`grupamento`: `qty += qtyDelta`, custo total igual. `bonificacao`: `qty += qtyDelta`, `totalCost += qtyDelta × unitCostCents`; com `unitCostCents === null`, soma 0 e gera `bonificacao_sem_custo`. `mudanca_ticker`: move qty e custo para `newTicker` (somando se já existir).
- `positions` só com `qty > 0`, ordenadas por ticker.

- [ ] **Step 1: Testes que falham** (helper `t(...)` monta `Trade` com defaults: broker `CLEAR`, `settleDate = tradeDate`, `fees/irrf = 0`)

```ts
test('preço médio com taxas e resultado da venda', () => {
  const r = replay([
    t({ id: '1', tradeDate: '2024-01-10', side: 'C', ticker: 'ITSA4', qty: 100, priceCents: 1000, feesCents: 120 }),
    t({ id: '2', tradeDate: '2024-02-10', side: 'C', ticker: 'ITSA4', qty: 100, priceCents: 1200 }),
    t({ id: '3', tradeDate: '2024-03-10', side: 'V', ticker: 'ITSA4', qty: 50, priceCents: 1500, feesCents: 50 }),
  ], [])
  expect(r.sales[0]).toMatchObject({ grossCents: 75000, netCents: 74950, costBasisCents: 55030, resultCents: 19920 })
  expect(r.positions).toEqual([{ ticker: 'ITSA4', assetType: 'Ação', qty: 150, totalCostCents: 165090 }])
})
test('ordem de entrada não importa', () => { /* mesmos 3 trades embaralhados → mesmo resultado */ })
test('fracionário soma na posição do lote padrão', () => {
  expect(normalizeTicker(' itsa4f ')).toBe('ITSA4')
  expect(normalizeTicker('TAEE11F')).toBe('TAEE11')
  expect(normalizeTicker('HGLG11')).toBe('HGLG11')
  // compra 10 ITSA4F + 100 ITSA4 → uma posição ITSA4 com qty 110
})
test('venda maior que a posição avisa e não vende o excedente', () => {
  const r = replay([t({ id: '1', side: 'C', qty: 10, tradeDate: '2024-01-02' }), t({ id: '2', side: 'V', qty: 15, tradeDate: '2024-01-05' })], [])
  expect(r.sales[0].qty).toBe(10)
  expect(r.warnings).toContainEqual(expect.objectContaining({ kind: 'venda_maior_que_posicao', date: '2024-01-05' }))
  expect(r.positions).toEqual([])
})
test('compra e venda no mesmo dia e corretora gera aviso de day trade', () => { /* kind: 'day_trade' */ })
test('desdobramento mantém custo total', () => { /* 100 ações custo 100000 + qtyDelta 100 → qty 200, custo 100000 */ })
test('bonificação soma custo atribuído; sem custo avisa', () => {
  /* qtyDelta 10, unitCost 500 → custo +5000; unitCost null → custo +0 e aviso bonificacao_sem_custo */
})
test('mudança de ticker move a posição e as compras seguintes somam no novo ticker', () => {})
test('evento do mesmo dia é aplicado antes da venda do dia', () => {})
```

- [ ] **Step 2:** `pnpm vitest run src/domain/ledger.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `normalizeTicker` (uppercase, trim, remove o `F` final quando casar `/^[A-Z]{4}\d{1,2}F$/`) e `replay`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: motor de posições, preço médio e eventos corporativos`

---

### Task 5: Apuração mensal de IR (comum e FII)

**Files:**
- Create: `src/domain/tax.ts`
- Test: `src/domain/tax.test.ts`

**Interfaces:**
- Consumes: `Sale`, `Warning` (Task 2/4), `monthOf`, `monthsBetween`.
- Produces:

```ts
export interface PotMonth {
  resultCents: Cents; exemptProfitCents: Cents; lossInCents: Cents /* ≤ 0, vindo do mês anterior */
  baseCents: Cents; taxDueCents: Cents; irrfMonthCents: Cents; irrfUsedCents: Cents
  irrfCarryOutCents: Cents; lossOutCents: Cents /* ≤ 0 */; taxPayableCents: Cents
}
export interface TaxMonth { month: Month; stockSalesCents: Cents; comum: PotMonth; fii: PotMonth; incomplete: boolean }
export function computeTax(sales: Sale[], warnings: Warning[], exemptTickers: string[], from: Month, to: Month): TaxMonth[]
```

Regras (análise §6, corrigindo o que a planilha errava):
- Mês da venda = mês de `tradeDate`. IRRF entra no mês de `settleDate`.
- Pote **comum** = Ação + ETF + BDR, alíquota 15%. Pote **fii** = FII, 20%. Prejuízos e IRRF separados por pote.
- `stockSalesCents` = soma do `grossCents` das vendas de **Ação** no mês, exceto tickers isentos com venda até 2023-12-31.
- Isenção: se `stockSalesCents <= 2_000_000` (lei: "igual ou inferior a R$ 20 mil"), o resultado **positivo** de Ação do mês vira `exemptProfitCents` e sai da base. Resultado negativo de Ação continua no pote (prejuízo compensável).
- Tickers da lista de isentos (Lei 13.043) com venda até 2023-12-31: o resultado dessas vendas fica fora do resultado do pote; se positivo, soma em `exemptProfitCents`; se negativo, é descartado; a venda não conta em `stockSalesCents`. De 2024 em diante, tratamento normal.
- `base = max(resultado − isento + lossIn, 0)`; `lossOut = min(resultado − isento + lossIn, 0)`.
- `taxDue = Math.floor(base × aliquota)` (aliquota como fração inteira: `base * 15 / 100`, com `Math.floor`).
- IRRF: disponível = `irrfMonth + irrfCarryIn`; `irrfUsed = min(disponível, taxDue)`; `irrfCarryOut = disponível − irrfUsed`; o carry **zera em janeiro** (o que sobra em dezembro fica visível em `irrfCarryOutCents` de dezembro, para a declaração).
- `taxPayable = taxDue − irrfUsed`.
- `incomplete = true` se houver warning `venda_maior_que_posicao` com data no mês.
- Todos os meses de `from` a `to` aparecem, mesmo sem vendas, com prejuízo e IRRF seguindo adiante.

- [ ] **Step 1: Testes que falham** (helper `s(...)` monta `Sale`; cada teste roda `computeTax` num intervalo curto)

```ts
test('vendas de ações até 20 mil: lucro isento', () => {
  // Ação, 2024-03, gross 1_500_000, result 300_000 → exemptProfit 300_000, taxDue 0
})
test('exatamente 20 mil ainda é isento', () => { /* gross 2_000_000 → isento */ })
test('acima de 20 mil: 15% sobre o lucro', () => { /* gross 2_500_000, result 300_000 → base 300_000, taxDue 45_000 */ })
test('prejuízo de ETF compensa no mês seguinte', () => {
  // 2024-01 ETF result −100_000; 2024-02 ETF result +300_000
  // → jan lossOut −100_000; fev base 200_000, taxDue 30_000
})
test('prejuízo em mês isento continua compensável', () => {
  // 2024-01 Ação gross 1_000_000 result −50_000; 2024-02 Ação gross 3_000_000 result +200_000 → fev base 150_000, taxDue 22_500
})
test('FII tem pote próprio a 20%', () => {
  // mesmo mês: ETF −100_000 e FII +100_000 → fii.taxDue 20_000; comum.lossOut −100_000
})
test('IRRF abate o imposto e sobra passa para o mês seguinte, zerando em janeiro', () => {
  // 2024-11: irrf 1_000 sem imposto → carryOut 1_000; 2024-12: taxDue 600 → irrfUsed 600, payable 0, carryOut 400
  // 2025-01: taxDue 300 → irrfUsed 0 (carry zerou), payable 300
})
test('ticker isento da Lei 13.043 até 2023, normal depois', () => {
  // exempt ['ABCD3']; 2023-06 gross 3_000_000 result 50_000 → stockSales 0, exempt 50_000, taxDue 0
  // 2024-06 mesma venda → stockSales 3_000_000, taxDue 7_500
})
test('mês com venda maior que a posição fica incompleto', () => {})
test('meses sem venda aparecem e carregam o prejuízo', () => {})
```

- [ ] **Step 2:** `pnpm vitest run src/domain/tax.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `computeTax`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: apuração mensal de IR em renda variável`

---

### Task 6: DARF (acúmulo abaixo de R$ 10, vencimento e situação)

**Files:**
- Create: `src/domain/darf.ts`
- Test: `src/domain/darf.test.ts`

**Interfaces:**
- Consumes: `TaxMonth` (Task 5), `DarfPayment`, `lastBusinessDayOfMonth`, `addMonths`.
- Produces:

```ts
export type DarfStatus = 'sem_imposto' | 'acumulado' | 'a_vencer' | 'em_aberto' | 'pago'
export interface DarfRow {
  month: Month; taxCents: Cents /* comum + fii a pagar no mês */; accumulatedCents: Cents
  darfCents: Cents /* 0 quando acumula */; dueDate: ISODate | null; status: DarfStatus; payment: DarfPayment | null
}
export const DARF_CODE = '6015'
export function computeDarfs(months: TaxMonth[], payments: DarfPayment[], today: ISODate): DarfRow[]
```

Regras: soma comum + fii (ambos código 6015); `accumulated = tax + pendente anterior`; se `accumulated < 1000`, `darfCents = 0`, `status = 'acumulado'` (ou `sem_imposto` quando 0) e o valor passa adiante; senão `darfCents = accumulated`, pendente zera, `dueDate = lastBusinessDayOfMonth(addMonths(month, 1))`; status `pago` se houver pagamento do mês, senão `a_vencer` quando `today <= dueDate`, senão `em_aberto`.

- [ ] **Step 1: Testes que falham**

```ts
// 2024-01 payable 600 → acumulado; 2024-02 payable 500 → darf 1100, dueDate '2024-03-28'
expect(rows[0]).toMatchObject({ month: '2024-01', darfCents: 0, status: 'acumulado' })
expect(rows[1]).toMatchObject({ month: '2024-02', accumulatedCents: 1100, darfCents: 1100, dueDate: '2024-03-28', status: 'em_aberto' }) // today '2026-10-26'
// com today '2024-03-10' → status 'a_vencer'
// com payment { month: '2024-02', paidAt: '2026-11-05', amountCents: 1300 } → 'pago'
// mês sem imposto → 'sem_imposto', dueDate null
```

- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: DARF mensal com acúmulo e vencimento`

---

### Task 7: Banco local, repositório e números em formato brasileiro

**Files:**
- Create: `src-tauri/migrations/001_init.sql`, `src/db/client.ts`, `src/db/testDb.ts`, `src/db/repo.ts`, `src/import/parse.ts`
- Modify: `src-tauri/src/lib.rs` (registrar `tauri_plugin_sql` com a migração via `include_str!`, `tauri_plugin_http`, `tauri_plugin_dialog`), `src-tauri/capabilities/default.json` (permissões `sql:default`, `sql:allow-execute`, `http:default` com allow `https://query1.finance.yahoo.com/*` e `https://query2.finance.yahoo.com/*`, `dialog:default`)
- Test: `src/db/repo.test.ts`, `src/import/parse.test.ts`

**Interfaces:**
- Produces:

```ts
// client.ts
export interface Db {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>
}
export const SCHEMA_VERSION = 1
export function openDb(path?: string): Promise<Db>   // padrão 'sqlite:yield.db'; com path abre outro arquivo (backup)
// testDb.ts
export function createTestDb(): Db                    // node:sqlite em memória + 001_init.sql
// parse.ts
export function parseBRL(v: string | number | null | undefined): Cents   // '1.234,56' → 123456; 'R$ 10,85' → 1085; '-' / '' / null → 0; 10.85 (número) → 1085; '(1,00)' e '-1,00' → -100
export function parseBRDate(v: string | number | Date): ISODate          // '05/01/2024' → '2024-01-05'; serial do Excel → data; Date → data
// repo.ts
export interface ManualAsset { id: string; name: string; assetClass: 'renda_fixa' | 'cripto' | 'dolar' | 'outro'; quoteSymbol: string | null; quantity: number | null; valueCents: Cents | null; updatedAt: ISODate }
export interface Note { id: string; number: string; broker: string; tradeDate: ISODate; settleDate: ISODate; source: 'manual' | 'pdf' | 'planilha' | 'sem_nota'; sourceKey: string | null; label: string | null }
export interface Quote { symbol: string; priceCents: Cents; fetchedAt: string; source: 'yahoo' | 'manual' }
export interface Dataset { notes: Note[]; trades: Trade[]; events: CorporateEvent[]; dividends: Dividend[]; payments: DarfPayment[]; quotes: Quote[]; manualAssets: ManualAsset[]; exemptTickers: string[] }
export function loadAll(db: Db): Promise<Dataset>
export function saveNote(db: Db, note: Omit<Note, 'id'>, trades: Omit<Trade, 'id' | 'noteId' | 'broker' | 'tradeDate' | 'settleDate'>[]): Promise<{ id: string } | { skipped: 'duplicada' }>
export function deleteNote(db: Db, id: string): Promise<void>
export function saveEvent(db: Db, e: Omit<CorporateEvent, 'id'> & { sourceKey?: string }): Promise<{ id: string } | { skipped: 'duplicada' }>
export function deleteEvent(db: Db, id: string): Promise<void>
export function setBonificacaoCost(db: Db, id: string, unitCostCents: Cents): Promise<void>
export function upsertDividends(db: Db, list: Omit<Dividend, 'id'>[]): Promise<{ inserted: number; skipped: number; replaced: number }>
export function deleteDividend(db: Db, id: string): Promise<void>
export function savePayment(db: Db, p: DarfPayment): Promise<void>
export function deletePayment(db: Db, month: Month): Promise<void>
export function upsertQuote(db: Db, q: Quote): Promise<void>
export function deleteQuote(db: Db, symbol: string): Promise<void>
export function saveManualAsset(db: Db, a: Omit<ManualAsset, 'id'> & { id?: string }): Promise<string>
export function deleteManualAsset(db: Db, id: string): Promise<void>
export function setExemptTickers(db: Db, tickers: string[]): Promise<void>
export function getAlias(db: Db, spec: string): Promise<string | null>
export function saveAlias(db: Db, spec: string, ticker: string): Promise<void>
```

Esquema (`001_init.sql`): `meta(key PK, value)` com `('app','yield')` e `('schema_version','1')`; `notes` (`source_key` UNIQUE); `trades` (FK `note_id` com `ON DELETE CASCADE`, `seq`); `corporate_events` (`source_key` UNIQUE); `dividends` (`source_key` UNIQUE); `darf_payments(month PK)`; `quotes(symbol PK)`; `manual_assets`; `exempt_tickers(ticker PK)`; `ticker_aliases(spec PK, ticker)`. Ids com `crypto.randomUUID()`. Parâmetros SQL sempre com `?`. Ligar `PRAGMA foreign_keys = ON` em `openDb` e `createTestDb`.

`saveNote` faz o insert da nota e, num único `INSERT ... VALUES (...), (...)`, os trades; se o insert dos trades falhar, apaga a nota e relança o erro. `upsertDividends`: `sourceKey` repetido é ignorado (`skipped`); ao inserir um provento `source: 'b3'`, apaga antes os de `source: 'planilha'` com o mesmo ticker e o mesmo mês de `payDate` (`replaced`), porque o extrato da B3 é mais preciso que a grade manual.

- [ ] **Step 1: Testes que falham**

```ts
// parse.test.ts
expect(parseBRL('1.234,56')).toBe(123456)
expect(parseBRL('R$ 10,85')).toBe(1085)
expect(parseBRL('-')).toBe(0)
expect(parseBRL(10.85)).toBe(1085)
expect(parseBRL('-1,00')).toBe(-100)
expect(parseBRDate('05/01/2024')).toBe('2024-01-05')
expect(parseBRDate(45296)).toBe('2024-01-05')     // serial do Excel

// repo.test.ts (createTestDb)
test('salva nota com trades e recarrega', async () => {})
test('excluir nota apaga os trades', async () => {})
test('nota com o mesmo sourceKey é ignorada', async () => {
  expect(await saveNote(db, { ...nota, sourceKey: 'pdf:CLEAR:123' }, trades)).toHaveProperty('id')
  expect(await saveNote(db, { ...nota, sourceKey: 'pdf:CLEAR:123' }, trades)).toEqual({ skipped: 'duplicada' })
})
test('provento repetido é ignorado e o da B3 substitui o da planilha no mesmo mês', async () => {
  await upsertDividends(db, [{ ticker: 'HGLG11', kind: 'Rendimento', payDate: '2024-03-01', amountCents: 1000, broker: null, source: 'planilha', sourceKey: 'planilha:HGLG11:2024-03:Rendimento' }])
  const r = await upsertDividends(db, [
    { ticker: 'HGLG11', kind: 'Rendimento', payDate: '2024-03-14', amountCents: 1100, broker: 'CLEAR', source: 'b3', sourceKey: 'b3:x' },
    { ticker: 'HGLG11', kind: 'Rendimento', payDate: '2024-03-14', amountCents: 1100, broker: 'CLEAR', source: 'b3', sourceKey: 'b3:x' },
  ])
  expect(r).toEqual({ inserted: 1, skipped: 1, replaced: 1 })
  expect((await loadAll(db)).dividends.map(d => d.amountCents)).toEqual([1100])
})
```

- [ ] **Step 2:** `pnpm vitest run src/db src/import/parse.test.ts` → FAIL. (Se o Vitest não resolver `node:sqlite`, usar `better-sqlite3` como devDependency no lugar, mantendo a mesma interface.)
- [ ] **Step 3:** Implementar migração, `client.ts` (sobre `@tauri-apps/plugin-sql`), `testDb.ts`, `repo.ts`, `parse.ts`.
- [ ] **Step 4:** → PASS. `pnpm tauri dev` abre sem erro de migração.
- [ ] **Step 5: Commit** `feat: banco local, repositório e parse de valores brasileiros`

---

### Task 8: Importar a planilha antiga e conferir os números

**Files:**
- Create: `src/import/planilha.ts`, `tests/fixtures/makePlanilha.ts` (gera um `.xlsx` sintético com SheetJS no próprio teste)
- Test: `src/import/planilha.test.ts`, `src/import/conferencia.local.test.ts`

**Interfaces:**
- Consumes: `parseBRL`, `parseBRDate`, `normalizeTicker`, `saveNote`, `upsertDividends`, `setExemptTickers`, `saveManualAsset`, `replay`, `computeTax`.
- Produces:

```ts
export interface PlanilhaImport {
  notes: { note: Omit<Note, 'id'>; trades: Parameters<typeof saveNote>[2] }[]
  dividends: Omit<Dividend, 'id'>[]
  exemptTickers: string[]
  manualAssets: Omit<ManualAsset, 'id'>[]
  ignored: string[]                    // mensagens em pt-BR para o resumo
}
export function parsePlanilha(data: ArrayBuffer): PlanilhaImport
export function importPlanilha(db: Db, p: PlanilhaImport): Promise<{ notes: number; notesSkipped: number; dividends: number; dividendsSkipped: number; manualAssets: number }>
```

Leitura (SheetJS `read(data, { cellDates: true })`; instalar com `pnpm add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`):
- Aba `Notas`, cabeçalho na linha 1, colunas da análise §3 (`Nota`, `Corretora`, `Data Pregão`, `Data Liquidação`, `C/V`, `Tipo`, `Ticker`, `Quantidade`, `Preço`, `I.R.R.F.` e as colunas de taxa). Agrupar por `Corretora + Nota + Data Pregão` → uma nota com `source: 'planilha'`, `sourceKey: planilha:<corretora>:<nota>:<data>`. `feesCents` de cada linha = soma das colunas de taxa **sem** o IRRF (as taxas já estão rateadas na planilha, então não chamar `allocateFees`). Linhas com `Tipo` fora de `AssetType` vão para `ignored`.
- Abas `Rendimentos 2022` a `Rendimentos 2025`: grade ativo × mês em blocos (Dividendos Ações → `Dividendo`, JCP Ações → `JCP`, FIIs → `Rendimento`). Cada célula > 0 vira um provento com `payDate = <ano>-<mês>-01`, `source: 'planilha'`, `sourceKey: planilha:<ticker>:<mês>:<kind>`. O layout exato dos blocos deve ser confirmado rodando um script local de inspeção sobre `planilhas/Controle de Investimentos.xlsm` (só imprimir rótulos e posições, nunca valores) antes de escrever o parser, e reproduzido na fixture sintética.
- Aba `Ações Isentas`: coluna de tickers → `exemptTickers`.
- Aba `Visão Geral`: linhas "Tesouro Selic" e "Pré-fixado" → `manualAssets` com `assetClass: 'renda_fixa'` e `valueCents`. Dólar e BTC entram em `ignored` com a mensagem "Dólar e BTC: lance a quantidade em Carteira › Ativos manuais".
- Abas que não existirem viram uma mensagem em `ignored`, sem erro.

- [ ] **Step 1: Testes que falham**

```ts
test('agrupa linhas em notas e soma taxas sem o IRRF', () => {
  const p = parsePlanilha(makePlanilha({ notas: [/* 2 linhas da nota 1001 CLEAR 2024-01-05, 1 linha da nota 1002 INTER */] }))
  expect(p.notes).toHaveLength(2)
  expect(p.notes[0].trades[0]).toMatchObject({ feesCents: 37, irrfCents: 0 })   // liq 30 + emol 7 na fixture
})
test('grade de rendimentos vira proventos por mês', () => {})
test('importar duas vezes não duplica', async () => {
  const db = createTestDb(); const p = parsePlanilha(makePlanilha(base))
  await importPlanilha(db, p)
  expect(await importPlanilha(db, p)).toMatchObject({ notes: 0, notesSkipped: 2, dividends: 0 })
})
test('aba faltando entra no resumo, sem erro', () => {})
```

- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5: Conferência local** — `conferencia.local.test.ts` usa `describe.skipIf(!existsSync('planilhas/Controle de Investimentos.xlsm'))`, importa a planilha real num `createTestDb`, roda `replay` + `computeTax` de 2020-01 a 2021-12 e compara com os valores calculados das abas `Imposto de Renda` (coluna `Imposto Devido`) e `Imposto de Renda F.I.I.`, e as posições com a tabela do `Resumo`. Imprime só as diferenças por mês/ticker (ex.: `2021-05 comum: planilha 123,45 · Yield 120,00`). Rodar `pnpm vitest run conferencia` e anotar em `docs/conferencia-fase-1.md` cada diferença com a explicação (bug conhecido da planilha da análise §7, IRRF fora das taxas, regra do "≤ 20 mil", etc.). Diferença sem explicação = bug a corrigir antes de seguir.
- [ ] **Step 6: Commit** `feat: importação da planilha antiga com conferência local` (sem dados reais: conferir `git status` antes)

---

### Task 9: Importar o extrato de movimentação da B3

**Files:**
- Create: `src/import/b3.ts`, `tests/fixtures/makeB3.ts`
- Test: `src/import/b3.test.ts`

**Interfaces:**
- Consumes: `parseBRL`, `parseBRDate`, `normalizeTicker`, `upsertDividends`, `saveEvent`.
- Produces:

```ts
export interface B3Import { dividends: Omit<Dividend, 'id'>[]; events: (Omit<CorporateEvent, 'id'> & { sourceKey: string })[]; ignored: number }
export function parseB3Movimentacao(data: ArrayBuffer): B3Import
export function importB3(db: Db, p: B3Import): Promise<{ dividends: number; dividendsSkipped: number; replaced: number; events: number; eventsSkipped: number }>
```

Colunas do extrato: `Entrada/Saída`, `Data`, `Movimentação`, `Produto`, `Instituição`, `Quantidade`, `Preço unitário`, `Valor da Operação`. Ticker = primeiro token de `Produto` antes de ` - `, normalizado. Mapeamento de `Movimentação`:
- `Rendimento` → `Rendimento`; `Dividendo` → `Dividendo`; `Juros Sobre Capital Próprio` → `JCP` (provento com `amountCents = Valor da Operação`).
- `Bonificação em Ativos` → evento `bonificacao`, `qtyDelta = Quantidade`, `unitCostCents = null` (o usuário informa o custo depois; o motor avisa).
- `Desdobro` → `desdobramento`, `qtyDelta = +Quantidade`; `Grupamento` → `grupamento`, `qtyDelta = −Quantidade`.
- Qualquer outra (`Transferência - Liquidação`, `Atualização`, `Leilão de Fração`, `Direito de Subscrição`, ...) → `ignored` (negociações entram pelas notas).
- `sourceKey = b3:<data>:<movimentação>:<produto>:<instituição>:<quantidade>:<valor>`.

- [ ] **Step 1: Testes que falham**

```ts
test('proventos, bonificação e desdobro', () => {
  const p = parseB3Movimentacao(makeB3([
    ['Credito', '14/03/2024', 'Rendimento', 'HGLG11 - CSHG LOGISTICA FII', 'CLEAR CORRETORA - GRUPO XP', '10', '1,10', '11,00'],
    ['Credito', '20/04/2024', 'Bonificação em Ativos', 'ITSA4 - ITAUSA S.A.', 'CLEAR CORRETORA - GRUPO XP', '5', '-', '-'],
    ['Credito', '02/05/2024', 'Desdobro', 'BBAS3 - BANCO DO BRASIL S.A.', 'CLEAR CORRETORA - GRUPO XP', '100', '-', '-'],
    ['Debito', '05/01/2024', 'Transferência - Liquidação', 'ITSA4 - ITAUSA S.A.', 'CLEAR CORRETORA - GRUPO XP', '100', '10,00', '1.000,00'],
  ]))
  expect(p.dividends[0]).toMatchObject({ ticker: 'HGLG11', kind: 'Rendimento', payDate: '2024-03-14', amountCents: 1100, source: 'b3' })
  expect(p.events.map(e => e.kind)).toEqual(['bonificacao', 'desdobramento'])
  expect(p.ignored).toBe(1)
})
test('importar o mesmo extrato duas vezes não duplica', async () => {})
```

- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: importação do extrato de movimentação da B3`

---

### Task 10: Exportar e importar backup

**Files:**
- Create: `src/db/backup.ts`
- Test: `src/db/backup.test.ts`

**Interfaces:**
- Consumes: `Db`, `SCHEMA_VERSION`, `createTestDb`.
- Produces:

```ts
export class BackupError extends Error {}
export function exportBackup(db: Db, path: string): Promise<void>                 // VACUUM INTO ?
export function importBackup(target: Db, source: Db, safetyPath: string): Promise<void>
export const TABLES: string[]   // ordem que respeita as FKs: notes antes de trades, etc.
```

`importBackup`: (1) lê `meta` de `source`; se `app !== 'yield'` ou `schema_version !== String(SCHEMA_VERSION)` (ou se a tabela não existir), lança `BackupError('Este arquivo não é um backup do Yield.')` **sem tocar no `target`**; (2) `exportBackup(target, safetyPath)`; (3) para cada tabela de `TABLES` (exceto `meta`), apaga no `target` (ordem inversa) e copia as linhas de `source` (ordem direta) com `INSERT` de várias linhas. Se qualquer passo de (3) falhar, repete (3) usando o arquivo de segurança como origem e relança o erro. Sem `ATTACH` e sem transação explícita (o pool do plugin-sql não garante a mesma conexão).

- [ ] **Step 1: Testes que falham**

```ts
test('arquivo que não é do Yield não apaga nada', async () => {
  const target = createTestDb(); await saveNote(target, nota, trades)
  const alien = createRawDb()           // node:sqlite sem a migração
  await expect(importBackup(target, alien, tmp('safe.db'))).rejects.toThrow('não é um backup do Yield')
  expect((await loadAll(target)).notes).toHaveLength(1)
})
test('backup válido substitui os dados e deixa cópia de segurança', async () => {})
test('exportar e importar devolve os mesmos dados', async () => {})
```

- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: exportar e importar backup com cópia de segurança`

---

### Task 11: Leitor de nota da Clear em PDF

**Files:**
- Create: `src/import/pdfText.ts`, `src/import/clearPdf.ts`, `tests/fixtures/clear-nota-sintetica.txt`
- Test: `src/import/clearPdf.test.ts`

**Interfaces:**
- Consumes: `parseBRL`, `parseBRDate`, `normalizeTicker`, `NoteFees`.
- Produces:

```ts
export class PdfPasswordError extends Error {}
export function extractPdfText(data: Uint8Array, password?: string): Promise<string[]>   // uma string por página, linhas reconstruídas pela posição y
export interface NoteDraftItem { side: Side; spec: string; ticker: string | null; assetType: AssetType | null; qty: number; priceCents: Cents }
export interface NoteDraft { number: string; broker: 'CLEAR'; tradeDate: ISODate; settleDate: ISODate | null; items: NoteDraftItem[]; fees: NoteFees }
export function parseClearNote(pages: string[]): NoteDraft[]     // um PDF pode ter várias notas
```

Antes de escrever o parser: rodar `extractPdfText` sobre os PDFs em `notas/` num script local (fora do git) para ver o layout real e se pedem senha. A fixture `clear-nota-sintetica.txt` reproduz esse layout com dados inventados. `ticker` sai do texto quando a especificação contiver algo que case `/\b[A-Z]{4}\d{1,2}\b/` (comum em FII); senão fica `null` e a tela resolve com o apelido salvo (`getAlias`) ou pedindo ao usuário (`saveAlias`). `assetType`: `FII` quando a especificação começar com `FII` ou o ticker terminar em `11` e a linha disser `FII`; `null` quando não der para saber. Taxas lidas do "Resumo Financeiro"/"Resumo dos Negócios": taxa de liquidação, taxa de registro, emolumentos, taxa operacional, ISS, I.R.R.F. s/ operações, outros. `pdfjs-dist` com o worker configurado para Vite (`pdfjs-dist/build/pdf.worker.min.mjs?url`).

- [ ] **Step 1: Testes que falham** (sobre o texto da fixture)

```ts
const drafts = parseClearNote([readFileSync('tests/fixtures/clear-nota-sintetica.txt', 'utf8')])
expect(drafts).toHaveLength(1)
expect(drafts[0]).toMatchObject({ number: '123456', tradeDate: '2024-01-05', settleDate: '2024-01-09' })
expect(drafts[0].items).toEqual([
  { side: 'C', spec: 'ITAUSA PN N1', ticker: null, assetType: null, qty: 100, priceCents: 1050 },
  { side: 'C', spec: 'FII CSHG LOG HGLG11 CI', ticker: 'HGLG11', assetType: 'FII', qty: 2, priceCents: 16000 },
])
expect(drafts[0].fees).toMatchObject({ liquidacaoCents: 37, emolumentosCents: 7, irrfCents: 0 })
```

- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS. Rodar o script local sobre todos os PDFs de `notas/` e conferir que nenhum dá erro e que as taxas somadas batem com o líquido da nota.
- [ ] **Step 5: Commit** `feat: leitor de nota de corretagem da Clear` (só a fixture sintética entra no git)

---

### Task 12: Cotações do Yahoo

**Files:**
- Create: `src/quotes/yahoo.ts`
- Test: `src/quotes/yahoo.test.ts`

**Interfaces:**
- Consumes: `upsertQuote`, `Db`.
- Produces:

```ts
export function yahooSymbol(tickerOrSymbol: string): string     // 'ITSA4' → 'ITSA4.SA'; 'BTC-BRL', 'ETH-BRL', 'BRL=X' passam direto
export function fetchYahooQuote(symbol: string, fetchFn: typeof fetch): Promise<{ priceCents: Cents; at: string }>
export function refreshQuotes(db: Db, symbols: string[], fetchFn: typeof fetch): Promise<{ ok: string[]; failed: string[] }>
export const MANUAL_QUOTE_SYMBOLS = { dolar: 'BRL=X', BTC: 'BTC-BRL', ETH: 'ETH-BRL' }
export const REFRESH_MS = 15 * 60 * 1000
```

Endpoint: `https://query1.finance.yahoo.com/v8/finance/chart/<symbol>?range=1d&interval=1d`; preço em `chart.result[0].meta.regularMarketPrice`, hora em `regularMarketTime` (segundos). No app, `fetchFn` é o `fetch` de `@tauri-apps/plugin-http`. Falha de um símbolo não derruba os outros e mantém a última cotação salva. Cotação com `source: 'manual'` nunca é sobrescrita pelo Yahoo.

- [ ] **Step 1: Testes que falham** (com `fetchFn` falso)

```ts
expect(yahooSymbol('itsa4')).toBe('ITSA4.SA')
expect(yahooSymbol('BTC-BRL')).toBe('BTC-BRL')
// resposta { chart: { result: [{ meta: { regularMarketPrice: 10.92, regularMarketTime: 1793030000 } }] } } → priceCents 1092
// refreshQuotes com ['ITSA4.SA' ok, 'XXXX3.SA' 404] → { ok: ['ITSA4.SA'], failed: ['XXXX3.SA'] } e a cotação antiga de XXXX3.SA continua no banco
```

- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: cotações via Yahoo Finance com cache local`

---

### Task 13: Mockups das telas de Investimentos (aprovação do Yago)

**Files:**
- Create: telas no visual companion (`.superpowers/brainstorm/`, fora do git)

- [ ] **Step 1:** Subir o visual companion da skill brainstorming com `--project-dir` no `yield/` e mostrar, no tema Grafite e com números fictícios: Carteira (cartões de patrimônio, resultado e proventos 12m; tabela por ativo agrupável por classe; hora da cotação; ativos manuais), Notas (lista por data, formulário de nota com itens e taxas, revisão do rascunho do PDF com tickers a resolver, operação sem nota e eventos corporativos), Proventos (lista por mês com filtro por ticker e tipo, totais por ano), Imposto (linha por mês com resultado, isenção, prejuízo, IR, DARF, situação, botão "marcar como pago", destaque de em aberto e de incompleto, aviso "Cobre só renda variável na B3"), Configurações (importar planilha, importar extrato B3, exportar/importar backup).
- [ ] **Step 2:** **Parar e esperar o Yago aprovar cada tela.** Anotar ajustes pedidos em `docs/design/telas-fase-1.md` (commitado) e só então seguir para as Tasks 14–18.
- [ ] **Step 3: Commit** `docs: telas aprovadas da fase 1`

---

### Task 14: Estado da aplicação e Carteira

**Files:**
- Create: `src/domain/portfolio.ts`, `src/state/DataProvider.tsx`, `src/pages/Carteira.tsx`
- Test: `src/domain/portfolio.test.ts`

**Interfaces:**
- Consumes: `Dataset`, `loadAll`, `replay`, `computeTax`, `computeDarfs`, `refreshQuotes`, `yahooSymbol`, `REFRESH_MS`.
- Produces:

```ts
// portfolio.ts
export interface PortfolioRow { ticker: string; assetType: AssetType; qty: number; avgPriceCents: Cents; costCents: Cents; priceCents: Cents | null; valueCents: Cents | null; varCents: Cents | null; varPct: number | null; quotedAt: string | null }
export interface ManualRow { id: string; name: string; assetClass: ManualAsset['assetClass']; valueCents: Cents | null }
export interface Portfolio { rows: PortfolioRow[]; manual: ManualRow[]; byClass: { cls: AssetType | 'Ativos manuais'; costCents: Cents; valueCents: Cents }[]; totalValueCents: Cents; totalCostCents: Cents; dividends12mCents: Cents; missingQuotes: string[] }
export function buildPortfolio(positions: Position[], quotes: Quote[], manual: ManualAsset[], dividends: Dividend[], today: ISODate): Portfolio
// DataProvider.tsx
export function useData(): { data: Dataset; derived: { replay: ReplayResult; tax: TaxMonth[]; darfs: DarfRow[]; portfolio: Portfolio }; db: Db; reload(): Promise<void>; refreshing: boolean }
```

Regras: `avgPrice = Math.round(cost / qty)`; posição sem cotação tem `priceCents/valueCents/var* = null`, entra em `missingQuotes`, e **não** soma no total de valor (o total mostra "sem cotação: N ativos"). `byClass` soma custo e valor **da mesma classe** (corrige o bug da Visão Geral). Ativo manual: `quantity × cotação de quoteSymbol` quando os dois existirem, senão `valueCents`. `dividends12m` = proventos com `payDate` nos 365 dias até `today`. `tax` vai do mês da primeira venda (ou 2020-01, o que for menor) até o mês de `today`. `DataProvider` atualiza cotações ao abrir e a cada `REFRESH_MS`.

- [ ] **Step 1: Testes que falham**

```ts
// ITSA4 qty 100 custo 100000 + cotação 1200 → value 120000, var 20000, varPct 0.2, avgPrice 1000
// HGLG11 sem cotação → valueCents null e missingQuotes ['HGLG11'], fora do total
// ativo manual BTC quantity 0.01 com cotação BTC-BRL 50_000_000 → 500_000
// byClass com Ação e BDR: cada classe com o próprio custo e valor
// dividends12m conta 2025-10-27..2026-10-26 e ignora 2025-10-26 (today '2026-10-26')
```

- [ ] **Step 2:** → FAIL. **Step 3:** implementar `buildPortfolio`, `DataProvider` e a página conforme o mockup aprovado (incluindo cadastro/edição/exclusão de ativo manual e campo de preço manual por ativo, salvo como `Quote` com `source: 'manual'` e removível com `deleteQuote`).
- [ ] **Step 4:** → PASS. `pnpm tauri dev`: a Carteira mostra as posições com a hora da última cotação.
- [ ] **Step 5: Commit** `feat: carteira com cotações e ativos manuais`

---

### Task 15: Notas (manual, PDF da Clear, operação sem nota, eventos)

**Files:**
- Create: `src/pages/Notas.tsx` (e componentes em `src/pages/notas/` se passar de ~300 linhas)

**Interfaces:**
- Consumes: `allocateFees`, `saveNote`, `deleteNote`, `saveEvent`, `deleteEvent`, `setBonificacaoCost`, `extractPdfText`, `PdfPasswordError`, `parseClearNote`, `getAlias`, `saveAlias`, `normalizeTicker`, `useData`.

- [ ] **Step 1:** Lista de notas por data (corretora, número, itens, total) com excluir (confirmação "Excluir a nota X e recalcular tudo?").
- [ ] **Step 2:** Formulário de nota manual: cabeçalho, itens (C/V, tipo, ticker, qtd, preço) e as 7 taxas; ao salvar chama `allocateFees` e `saveNote` com `source: 'manual'`, `sourceKey: manual:<corretora>:<número>:<data>`. Precisa ser rápido de digitar: Tab percorre os campos, Enter adiciona item, ticker já em maiúsculas.
- [ ] **Step 3:** Importar PDF (`<input type="file" accept="application/pdf" multiple>`): extrai, pede senha se `PdfPasswordError`, mostra cada rascunho para revisão (itens com ticker `null` pedem o ticker e salvam o apelido; tipo `null` pede o tipo); confirmar salva com `source: 'pdf'`, `sourceKey: pdf:CLEAR:<número>`. Nota já importada aparece como "já importada" e não salva de novo.
- [ ] **Step 4:** Operação sem nota (IPO, subscrição): uma compra com data, ticker, tipo, qtd e preço, `source: 'sem_nota'`, `label` com o motivo.
- [ ] **Step 5:** Eventos corporativos: lista e formulário (bonificação com custo unitário, desdobramento, grupamento, mudança de ticker). Bonificação importada da B3 sem custo aparece destacada com campo para informar o custo.
- [ ] **Step 6:** Verificar no app: lançar uma nota manual, importar um PDF real de `notas/`, excluir uma nota e ver a Carteira e o Imposto mudarem. `pnpm vitest run` continua PASS.
- [ ] **Step 7: Commit** `feat: tela de notas com importação de PDF e eventos`

---

### Task 16: Proventos

**Files:**
- Create: `src/pages/Proventos.tsx`

**Interfaces:**
- Consumes: `useData`, `upsertDividends`, `deleteDividend`.

- [ ] **Step 1:** Lista por mês (data, ticker, tipo, corretora, valor, origem), filtro por ticker e tipo, total por ano e por tipo (Dividendo e Rendimento isentos, JCP com tributação exclusiva, rotulados assim).
- [ ] **Step 2:** Lançamento manual (`source: 'manual'`, `sourceKey: null`) e exclusão.
- [ ] **Step 3:** Verificar no app com os proventos importados da planilha. **Step 4: Commit** `feat: tela de proventos`

---

### Task 17: Imposto

**Files:**
- Create: `src/pages/Imposto.tsx`

**Interfaces:**
- Consumes: `useData` (`derived.tax`, `derived.darfs`, `derived.replay.warnings`), `savePayment`, `deletePayment`, `DARF_CODE`.

- [ ] **Step 1:** Aviso fixo no topo: "Cobre só renda variável na B3 (ações, FIIs, ETFs e BDRs). Cripto e dólar não entram. Day trade não é apurado."
- [ ] **Step 2:** Resumo: total de DARF em aberto e quantidade de meses em aberto, em destaque.
- [ ] **Step 3:** Tabela por mês, do mais recente ao mais antigo, agrupada por ano: vendas de ações, resultado comum, lucro isento, prejuízo a compensar, IR comum, resultado FII, IR FII, IRRF usado, DARF, vencimento, situação. Meses `incomplete` com aviso "Venda maior que a posição: faltam notas antes desta data". Meses com aviso de day trade também sinalizados.
- [ ] **Step 4:** Por DARF: dados para emitir (código `6015`, período de apuração = último dia do mês, valor principal, vencimento) com texto "Pagamento em atraso: calcule multa e juros no SicalcWeb da Receita" e link `https://sicalc.receita.economia.gov.br/sicalc/principal`; "Marcar como pago" pede data e valor pago (`savePayment`); desfazer (`deletePayment`).
- [ ] **Step 5:** Saldo de IRRF de dezembro de cada ano exibido como "IRRF a informar na declaração".
- [ ] **Step 6:** Verificar no app com o histórico importado: meses de 2022–2025 aparecem calculados. **Step 7: Commit** `feat: tela de imposto e DARF`

---

### Task 18: Configurações e primeira abertura

**Files:**
- Create: `src/pages/Configuracoes.tsx`
- Modify: `src/pages/Carteira.tsx` (estado vazio)

**Interfaces:**
- Consumes: `parsePlanilha`, `importPlanilha`, `parseB3Movimentacao`, `importB3`, `exportBackup`, `importBackup`, `BackupError`, `openDb`, `useData`; `save`/`open` de `@tauri-apps/plugin-dialog`; `appDataDir` de `@tauri-apps/api/path`.

- [ ] **Step 1:** Importar planilha (`<input type="file" accept=".xlsm,.xlsx">`) → resumo com contagens e a lista `ignored`.
- [ ] **Step 2:** Importar extrato B3 (`.xlsx`) → resumo com contagens (incluindo "substituídos da planilha").
- [ ] **Step 3:** Exportar backup: `save({ defaultPath: 'yield-backup-AAAA-MM-DD.db' })` → `exportBackup`. Importar backup: `open()` → confirmação "Isso substitui todos os dados atuais. Uma cópia de segurança será guardada." → `importBackup(db, await openDb(path), <appDataDir>/seguranca-<timestamp>.db)` → `reload()`; `BackupError` vira mensagem na tela.
- [ ] **Step 4:** Carteira vazia (sem notas) mostra "Comece importando sua planilha" com botão que leva a Configurações.
- [ ] **Step 5:** Verificar no app: primeira abertura → importar a planilha real → importar de novo (nada duplica) → exportar → importar o backup → mesmos dados. **Step 6: Commit** `feat: configurações, importações e backup`

---

### Task 19: Instaladores

**Files:**
- Create: `.github/workflows/build.yml`
- Modify: `src-tauri/tauri.conf.json` (ícones, `bundle.targets`)

- [ ] **Step 1:** Ícone simples no tema (ponto verde-lima sobre grafite) gerado com `pnpm tauri icon`.
- [ ] **Step 2:** `pnpm tauri build` no Mac → `.dmg` em `src-tauri/target/release/bundle/dmg/`. Abrir o app instalado e repetir a verificação da Task 18 com uma cópia do banco.
- [ ] **Step 3:** Workflow com `tauri-apps/tauri-action` gerando o instalador `.msi`/`.exe` do Windows em `windows-latest` (gatilho manual `workflow_dispatch`). **Não fazer push nem criar repositório remoto sem o Yago pedir**; avisar que o build do Windows depende disso.
- [ ] **Step 4: Commit** `build: ícone, build do Mac e workflow do Windows`
