# Yield — Fase 2 (Orçamento mensal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a aba `Finanças` da planilha de orçamento por um plano mensal no app: entradas e saídas por linha, salário PJ líquido calculado, saldo do mês, mês seguinte criado a partir das linhas recorrentes, importação da planilha, e — como a fase 3 já existe — planejado × gasto real e sugestões vindas dos gastos.

**Architecture:** Mesmo desenho das fases 1 e 3: regras puras em `src/domain/orcamento.ts` (PJ, saldo, próximo mês, planejado × real, sugestões), dados no SQLite (meses, linhas, sugestões descartadas, configuração PJ em `meta`), tudo derivado no `DataProvider`. A importação lê a aba `Finanças` pelos valores calculados que o Excel guardou e usa a fórmula da linha "Saldo" para saber quais linhas são entradas e quais são saídas.

**Tech Stack:** o das fases 1 e 3 (Tauri 2, React, TS, Vitest, `@tauri-apps/plugin-sql`, SheetJS `xlsx`, `src/ui/charts.tsx`).

**Spec:** `docs/superpowers/specs/2026-10-26-yield-design.md` §8.2 (e §5, §9). Fora desta fase (spec §8.4): Planejamento (aba `Aluguel`) e Milhas; abas `Aluguel`, `MILHAS` e `Cartão de Crédito` não são importadas.

## Global Constraints

- Tudo das fases 1 e 3 continua valendo: pt-BR, centavos inteiros (`Cents`), meses `YYYY-MM`, nenhum dado real no git (a planilha fica em `planilhas/`, gitignored; fixtures sintéticas com nomes e valores inventados — **nunca copiar rótulos ou valores da planilha real para arquivos versionados**), commits **sem** `Co-Authored-By`, tema Grafite, confirmação na tela para apagar/substituir (nunca `window.confirm`/`alert`/`prompt`), dinheiro digitado validado com `parseMoney` (`src/pages/notas/build.ts`).
- Esquema novo em `src-tauri/migrations/003_orcamento.sql`; `SCHEMA_VERSION = 3`. Colunas só `INTEGER`, `TEXT`, `REAL`.
- Salário PJ (spec §8.2): pró-labore **28%** do bruto, IRPJ **6%** do bruto, INSS **11% do pró-labore**, contabilidade em R$; percentuais editáveis. Líquido = bruto − IRPJ − INSS − contabilidade − outros descontos (o pró-labore não é desconto: é parte do que a pessoa recebe).
- "Nada entra no plano sem confirmação. Gasto avulso não entra no plano." (spec §8.2)
- Mockup aprovado pelo Yago antes de construir as telas (Task 5).

**Mudança depois dos mockups (27/10/2026):** o Yago pediu **fontes de renda** no lugar de um "Salário PJ" único (`docs/design/telas-fase-2.md`). A Task 6 (nova) troca a config PJ única e o `pjGrossCents` das linhas por uma tabela de fontes; as antigas Tasks 6 e 7 viram 7 e 8. A migração 003 já rodou no banco do Yago, então a mudança vai numa 004.

## Review Focus

1. **Importar a planilha duas vezes** não duplica linhas nem sobrescreve linhas que o usuário já mudou no app. Teste na Task 4.
2. **Criar o mês seguinte duas vezes** (clique duplo, ou mês já criado) não duplica linhas. Teste na Task 1.
3. **Parcela que acabou** (ex.: 5/5) não é copiada para o mês seguinte; 4/5 vira 5/5. Teste na Task 2.
4. **Arredondamento do PJ:** as partes e o líquido somam exatamente o bruto em centavos. Teste na Task 2.
5. **Planejado × real** usa a mesma definição de gasto do Resumo de gastos (`monthTotals`: fatura, transferência e investimento não contam). Teste na Task 2.

---

## Estrutura de arquivos (novos)

```
src-tauri/migrations/003_orcamento.sql   meses, linhas, sugestões descartadas
src/db/orcamentoRepo.ts                  leitura/escrita do orçamento
src/domain/orcamento.ts                  PJ, saldo, próximo mês, planejado × real
src/domain/sugestoes.ts                  sugestões vindas dos gastos
src/import/orcamentoPlanilha.ts          aba Finanças → meses e linhas
src/pages/Orcamento.tsx (+ orcamento/build.ts)
src/pages/configuracoes/OrcamentoConfig.tsx   importar planilha + salário PJ
tests/fixtures/makeOrcamento.ts          planilha sintética (SheetJS)
```

---

### Task 1: Esquema e repositório do orçamento

**Files:**
- Create: `src-tauri/migrations/003_orcamento.sql`, `src/db/orcamentoRepo.ts`
- Modify: `src-tauri/src/lib.rs` (`Migration { version: 3, … 003_orcamento.sql }`), `src/db/testDb.ts` (lista `[001, 002, 003]`), `src/db/client.ts` (`SCHEMA_VERSION = 3`)
- Test: `src/db/orcamentoRepo.test.ts`, `src/db/backup.test.ts`, `src/db/gastosRepo.test.ts` (asserções de `schema_version` passam a `'3'`)

**Interfaces:**
- Produces:

```ts
export type LineKind = 'entrada' | 'saida'
export interface BudgetLine { id: string; month: Month; kind: LineKind; name: string; amountCents: Cents; recurring: boolean; position: number; categoryId: string | null; installmentCurrent: number | null; installmentTotal: number | null; pjGrossCents: Cents | null; sourceKey: string | null }
export interface PjConfig { proLaborePct: number; irpjPct: number; inssPct: number /* sobre o pró-labore */; contabilidadeCents: Cents; outrosCents: Cents }
export const DEFAULT_PJ: PjConfig = { proLaborePct: 28, irpjPct: 6, inssPct: 11, contabilidadeCents: 0, outrosCents: 0 }
export interface OrcamentoData { months: Month[] /* criados, em ordem */; lines: BudgetLine[]; dismissed: { month: Month; key: string }[]; pj: PjConfig }
export function loadOrcamento(db: Db): Promise<OrcamentoData>
export function createMonth(db: Db, month: Month, lines: Omit<BudgetLine, 'id' | 'month'>[]): Promise<'criado' | 'ja-existe'>   // mês já existente: não grava nada
export function saveLine(db: Db, line: Omit<BudgetLine, 'id'> & { id?: string }): Promise<string>   // sem id insere (position = fim do mês)
export function deleteLine(db: Db, id: string): Promise<void>
export function dismissSuggestion(db: Db, month: Month, key: string): Promise<void>
export function savePjConfig(db: Db, cfg: PjConfig): Promise<void>     // meta key 'orcamento.pj' (JSON)
```

Esquema: `budget_months(month PK)`; `budget_lines(id PK, month FK → budget_months ON DELETE CASCADE, kind CHECK IN ('entrada','saida'), name, amount_cents, recurring INTEGER, position INTEGER, category_id FK → categories ON DELETE SET NULL, installment_current, installment_total, pj_gross_cents, source_key UNIQUE)` com índice em `month`; `budget_dismissals(month, key, PK (month, key))`; `UPDATE meta SET value = '3' WHERE key = 'schema_version'`.

- [ ] **Step 1: Testes que falham** — `createMonth` grava o mês e as linhas; chamar de novo devolve `'ja-existe'` e não duplica (Review Focus 2); `saveLine` sem id põe a linha no fim e com id atualiza; apagar uma categoria de gastos deixa `categoryId = null` na linha; `loadOrcamento` sem config PJ devolve `DEFAULT_PJ`; `source_key` repetido é recusado; banco novo tem `schema_version = '3'`, `validateBackup` aceita 3 e recusa 2 com a mensagem de versão; um banco v2 recebe a 003 no `createTestDb`.
- [ ] **Step 2:** `pnpm vitest run src/db` → FAIL. **Step 3:** implementar. **Step 4:** → PASS; `cargo check` em `src-tauri`.
- [ ] **Step 5: Commit** `feat: esquema e repositório do orçamento`

---

### Task 2: Regras do orçamento

**Files:**
- Create: `src/domain/orcamento.ts`
- Test: `src/domain/orcamento.test.ts`

**Interfaces:**
- Consumes: `BudgetLine`, `PjConfig` (Task 1); `Txn`, `Category`, `monthTotals` (fase 3); `addMonths`.
- Produces:

```ts
export interface PjBreakdown { grossCents: Cents; proLaboreCents: Cents; irpjCents: Cents; inssCents: Cents; contabilidadeCents: Cents; outrosCents: Cents; netCents: Cents }
export function pjNet(grossCents: Cents, cfg: PjConfig): PjBreakdown
export function monthSummary(lines: BudgetLine[]): { entradasCents: Cents; saidasCents: Cents; saldoCents: Cents }
export function nextMonthLines(lines: BudgetLine[], cfg: PjConfig): Omit<BudgetLine, 'id' | 'month'>[]   // linhas recorrentes do mês; parcelas avançam; PJ recalculado
export interface PlanVsReal { plannedSaidasCents: Cents; realSpentCents: Cents; byCategory: { categoryId: string; plannedCents: Cents; realCents: Cents }[] }
export function planVsReal(lines: BudgetLine[], txns: Txn[], cat: (t: Txn) => Category | null, month: Month): PlanVsReal
```

Regras: `pjNet` arredonda cada parte com `Math.round` (pró-labore e IRPJ sobre o bruto, INSS sobre o pró-labore já arredondado) e o líquido é `gross − irpj − inss − contabilidade − outros`, então a soma fecha em centavos. `nextMonthLines`: só `recurring`; com parcela, `current < total` vira `current + 1` e `current === total` não é copiada; linha com `pjGrossCents` tem `amountCents = pjNet(gross, cfg).netCents`; `sourceKey` vai `null`; `position` mantida. `planVsReal`: `realSpentCents = monthTotals(...).spentCents`; `byCategory` só para categorias com linha de saída ligada (soma das linhas × gasto real da categoria no mês, mesma regra de `monthTotals`).

- [ ] **Step 1: Testes que falham**

```ts
expect(pjNet(1_000_000, { ...DEFAULT_PJ, contabilidadeCents: 30_000 })).toEqual({ grossCents: 1_000_000, proLaboreCents: 280_000, irpjCents: 60_000, inssCents: 30_800, contabilidadeCents: 30_000, outrosCents: 0, netCents: 879_200 })
// bruto ímpar (ex.: 333_333) → irpj + inss + contabilidade + outros + net === gross
// parcela 4/5 recorrente → 5/5 no mês seguinte; 5/5 não aparece; linha não recorrente não aparece
// linha PJ copiada usa o cfg atual (mudou o %: o líquido do mês novo muda)
// planVsReal: mês com compra −100,00 no cartão e pagamento de fatura −100,00 na conta → realSpentCents 10000
// linha "Mercado" 1.500,00 ligada à categoria mercado e gasto real 1.618,40 nela → byCategory [{ plannedCents: 150000, realCents: 161840 }]
```

- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: salário PJ, saldo e mês seguinte do orçamento`

---

### Task 3: Sugestões vindas dos gastos

**Files:**
- Create: `src/domain/sugestoes.ts`
- Test: `src/domain/sugestoes.test.ts`

**Interfaces:**
- Consumes: `Subscription` (fase 3), `Txn`, `Account`, `normalizeDescription`, `BudgetLine`.
- Produces:

```ts
export interface Suggestion { key: string; reason: 'assinatura' | 'parcela'; name: string; amountCents: Cents; categoryId: string | null; installmentCurrent: number | null; installmentTotal: number | null }
export function suggestForMonth(month: Month, subscriptions: Subscription[], txns: Txn[], cat: (t: Txn) => Category | null, lines: BudgetLine[], dismissed: string[]): Suggestion[]
```

Regras: **assinatura** — ativa; mensal entra todo mês com `amountCents`; anual só no mês do `nextDate`; `key = 'sub:' + merchantKey`; categoria = a da última cobrança. **Parcela** — para cada compra parcelada (mesma conta, `normalizeDescription`, valor e total), pega a parcela mais recente `n/total` na data `d`; a parcela `n + j` (1 ≤ j ≤ total − n) cai em `addMonths(monthOf(d), j)`; se esse mês for `month`, sugere `"<descrição> (n+j/total)"` com `key = 'parc:' + accountId + '|' + descrição normalizada + '|' + total + '|' + valor`, `installmentCurrent = n + j`. Some da lista o que já tem linha com o mesmo `sourceKey` no mês ou está em `dismissed`. Ordem: maior valor primeiro. Gasto avulso nunca é sugerido. As "contas fixas" do spec entram pela mesma detecção de assinaturas (cobrança mensal no mesmo lugar com valor parecido); conta de valor variável fica de fora nesta fase.

- [ ] **Step 1: Testes que falham** — assinatura mensal ativa aparece; parada não; anual só no mês da próxima cobrança; compra em 3/10 em setembro sugere 4/10 em outubro e 10/10 em março, nada em abril; linha com o mesmo `sourceKey` esconde a sugestão; descartada não aparece; compra à vista nunca aparece.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: sugestões do orçamento a partir dos gastos`

---

### Task 4: Importar a aba Finanças

**Files:**
- Create: `src/import/orcamentoPlanilha.ts`, `tests/fixtures/makeOrcamento.ts` (monta com SheetJS uma planilha **sintética** com a mesma forma: datas na linha 2, rótulos na coluna A, linha "Saldo" com `SUM(<col>3:<col>5)-SUM(<col>6:<col>30)`, bloco PJ ao lado com "Pró Labore" `=0.28*S1`, "IRPJ" `=0.06*S1`, "INSS" `=0.11*S2`, "Contabilidade", "Salário Líquido" `=S1-SUM(S3:S5)-<outros>`, e uma linha de entrada que aponta para o líquido)
- Test: `src/import/orcamentoPlanilha.test.ts`

**Interfaces:**
- Consumes: `createMonth`, `saveLine`, `savePjConfig`, `loadOrcamento` (Task 1); `pjNet` (Task 2).
- Produces:

```ts
export interface OrcamentoImport { months: { month: Month; lines: Omit<BudgetLine, 'id' | 'month' | 'position'>[] }[]; pj: PjConfig & { grossCents: Cents } | null; warnings: string[] }
export function parseOrcamentoPlanilha(data: ArrayBuffer): OrcamentoImport
export function importOrcamento(db: Db, p: OrcamentoImport): Promise<{ months: number; lines: number; skipped: number }>
```

Regras de leitura (aba `Finanças`; sem ela → erro `'Aba "Finanças" não encontrada'`): cada coluna com **data na linha 2** é um mês (`YYYY-MM` da data); a linha cujo rótulo normalizado é `saldo` define pela fórmula quais linhas são entradas (primeiro `SUM`) e saídas (segundo `SUM`) — sem ela → erro `'Linha "Saldo" não encontrada'`. Cada célula com rótulo na coluna A e valor numérico calculado ≠ 0 vira linha (`amountCents = Math.round(v * 100)`; valor negativo → aviso e a linha é pulada); `sourceKey = 'planilha:' + mês + ':' + linha`; `recurring` = a mesma linha tem valor em pelo menos 2 meses importados. **PJ:** acha a célula "Salário Líquido" (normalizado) e lê do bloco as porcentagens das fórmulas de "Pró Labore", "IRPJ" e "INSS", o bruto (célula citada na fórmula do pró-labore), a contabilidade e `outrosCents = bruto − IRPJ − INSS − contabilidade − líquido`; linhas cuja fórmula cita a célula do líquido ganham `pjGrossCents = bruto`. Sem bloco PJ → `pj: null`. `importOrcamento`: `position` = ordem das linhas na aba; cria o mês que falta; num mês existente, insere só as linhas cujo `sourceKey` ainda não existe (nunca muda linha existente); grava a config PJ só se ainda não houver uma salva.

- [ ] **Step 1: Testes que falham** (com `makeOrcamento`) — meses saem das datas da linha 2; entradas e saídas separadas pela fórmula do Saldo; o saldo de cada mês importado bate com o valor calculado da linha Saldo; PJ: porcentagens 28/6/11, `outrosCents` reconstrói o líquido e a linha que aponta para ele tem `pjGrossCents`; importar duas vezes → `{ lines: 0, skipped: N }`; linha editada no app depois da 1ª importação continua como o usuário deixou (Review Focus 1); sem aba → erro; sem linha Saldo → erro.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS. Conferir localmente (fora do git) com `planilhas/_Controle Financeiro Yago.xlsx` que os saldos de todos os meses batem, **sem imprimir valores em arquivos**; anotar só "bate"/"não bate e por quê" no relatório.
- [ ] **Step 5: Commit** `feat: importação da planilha de orçamento`

---

### Task 5: Mockup da tela de orçamento (aprovação do Yago)

**Files:**
- Create: `docs/design/telas-fase-2.html` e `docs/design/telas-fase-2.md` (depois da aprovação)

- [ ] **Step 1:** No visual companion, tema Grafite, dados fictícios, no formato de `docs/design/telas-fase-3.html`: **Orçamento › Mês atual** (mês com setas; cartões Entradas, Saídas, Saldo; barra "planejado × gasto real até agora" com o quanto do mês já passou; tabelas Entradas e Saídas com nome, valor, recorrente, parcela, categoria ligada e real do mês; adicionar/editar/apagar com confirmação; linha PJ mostrando bruto → líquido com o detalhamento; "Criar <mês seguinte>"; painel "Sugestões dos seus gastos" com Aceitar / Ajustar / Descartar; estado vazio com "Criar plano" e "Importar planilha") e **Configurações** (cartão "Importar planilha de orçamento" com o resumo e avisos; cartão "Salário PJ" com os percentuais, contabilidade e outros descontos).
- [ ] **Step 2: Parar e esperar o Yago aprovar.** Registrar ajustes em `docs/design/telas-fase-2.md`.
- [ ] **Step 3: Commit** `docs: telas aprovadas da fase 2`

---

### Task 6: Fontes de renda

**Files:**
- Create: `src-tauri/migrations/004_fontes_renda.sql`
- Modify: `src-tauri/src/lib.rs` (`Migration { version: 4, … }`), `src/db/testDb.ts` (lista com 004), `src/db/client.ts` (`SCHEMA_VERSION = 4`), `src/db/orcamentoRepo.ts`, `src/domain/orcamento.ts`, `src/import/orcamentoPlanilha.ts` (+ testes de todos; asserções de `schema_version` para `'4'`)

**Interfaces:**
- Produces (substitui `PjConfig` em `OrcamentoData`, `savePjConfig` e `BudgetLine.pjGrossCents`):

```ts
export type SourceKind = 'pj' | 'fixo'
export interface IncomeSource { id: string; name: string; kind: SourceKind; grossCents: Cents | null /* pj */; proLaborePct: number; irpjPct: number; inssPct: number; contabilidadeCents: Cents; outrosCents: Cents; netCents: Cents | null /* fixo */; sourceKey: string | null }
// BudgetLine: troca pjGrossCents por sourceId: string | null
// OrcamentoData: troca pj por sources: IncomeSource[]
export function saveSource(db: Db, s: Omit<IncomeSource, 'id'> & { id?: string }): Promise<string>
export function deleteSource(db: Db, id: string): Promise<void>     // linhas ficam com o último valor (FK ON DELETE SET NULL)
export function applySource(db: Db, sourceId: string, fromMonth: Month, amountCents: Cents): Promise<number>   // atualiza o valor das linhas ligadas em meses >= fromMonth; devolve quantas
// orcamento.ts
export function sourceNet(s: IncomeSource): Cents                  // pj → pjNet(gross, s).netCents; fixo → netCents
export function nextMonthLines(lines: BudgetLine[], sources: IncomeSource[]): Omit<BudgetLine, 'id' | 'month'>[]   // linha com fonte existente usa sourceNet
// orcamentoPlanilha.ts: OrcamentoImport.pj vira source: Omit<IncomeSource, 'id'> | null (kind 'pj', name = rótulo na célula acima de "Pró Labore" ou 'Salário PJ', sourceKey 'planilha:pj'); linhas que citam o líquido levam sourceKey da fonte e o import liga sourceId
```

Esquema 004: `income_sources(id PK, name, kind CHECK IN ('pj','fixo'), gross_cents, pro_labore_pct REAL, irpj_pct REAL, inss_pct REAL, contabilidade_cents, outros_cents, net_cents, source_key UNIQUE)`; `ALTER TABLE budget_lines ADD COLUMN source_id TEXT REFERENCES income_sources(id) ON DELETE SET NULL`; `ALTER TABLE budget_lines DROP COLUMN pj_gross_cents`; `DELETE FROM meta WHERE key = 'orcamento.pj'`; `schema_version = '4'`. `pjNet(gross, cfg)` fica como está (recebe a fonte, que tem os mesmos campos de `PjConfig`).

- [ ] **Step 1: Testes que falham** — salvar/editar/apagar fonte; apagar fonte deixa `sourceId = null` e o valor da linha intacto; `applySource` muda só meses >= fromMonth; `sourceNet` (PJ do exemplo da Task 2 = 879_200; fixo = netCents); `nextMonthLines` recalcula pela fonte e mantém o valor quando a fonte sumiu; importação cria **uma** fonte PJ (reimportar não cria outra) e liga as linhas que citam o líquido; banco v3 recebe a 004 e passa a `'4'`.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS; `cargo check`.
- [ ] **Step 5: Commit** `feat: fontes de renda no orçamento`

---

### Task 7: Tela Orçamento › Mês atual

**Files:**
- Create: `src/pages/Orcamento.tsx`, `src/pages/orcamento/build.ts`
- Modify: `src/state/DataProvider.tsx` (carrega `OrcamentoData`; expõe `orcamento: { data; month; setMonth; summary; planVsReal; suggestions; reload() }`), `src/ui/routes.ts` (rota `orcamento`, "Mês atual" habilitado), `src/App.tsx`
- Test: `src/pages/orcamento/build.test.ts`, `src/ui/routes.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 e 6; `useData().gastos` (categorias, txns, assinaturas, categorizador). Entrada nova escolhe uma fonte (valor = `sourceNet`) ou valor avulso. O planejado do "planejado × real" geral exclui saídas ligadas a categorias que não contam como gasto.

```ts
// orcamento/build.ts
export function validateLine(input: { name: string; amount: string; installment: string }): { name: string; amountCents: Cents; installmentCurrent: number | null; installmentTotal: number | null }   // nome vazio, valor inválido (parseMoney) e parcela fora de "n/total" com 1 ≤ n ≤ total → erro em pt-BR
export function monthProgress(month: Month, today: ISODate): number   // 0..1 do mês já passado; mês passado = 1, futuro = 0
export function defaultMonth(months: Month[], today: ISODate): Month   // o mês de hoje se existir, senão o último criado, senão o de hoje
```

- [ ] **Step 1: Testes que falham** — `validateLine` (vazio, "abc", "3/2", "0/5", "2/5" ok); `monthProgress` (dia 15 de um mês de 30 ≈ 0,5); `defaultMonth`; rota nova.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar conforme o mockup aprovado: aceitar sugestão grava a linha com `sourceKey = key`; ajustar abre o formulário preenchido; descartar chama `dismissSuggestion`; "Criar <mês seguinte>" usa `nextMonthLines` + `createMonth` e desabilita enquanto grava; o mês vazio oferece copiar o anterior.
- [ ] **Step 4:** → PASS. Prints de um harness `mockIPC` (como nas Tasks 8–11 da fase 3), vazio e com dados; apagar o harness.
- [ ] **Step 5: Commit** `feat: tela do orçamento mensal`

---

### Task 8: Configurações do orçamento

**Files:**
- Create: `src/pages/configuracoes/OrcamentoConfig.tsx`
- Modify: `src/pages/Configuracoes.tsx`, `src/pages/configuracoes/build.ts` (+ teste)

**Interfaces:**
- Consumes: `parseOrcamentoPlanilha`, `importOrcamento` (Task 4/6); `saveSource`, `deleteSource`, `applySource` (Task 6); `pjNet`, `sourceNet`; `DEFAULT_PJ` (valores iniciais de uma fonte PJ nova).

```ts
export function validateSource(input: { name: string; kind: SourceKind; gross: string; proLabore: string; irpj: string; inss: string; contabilidade: string; outros: string; net: string }): Omit<IncomeSource, 'id' | 'sourceKey'>   // nome obrigatório; % entre 0 e 100 com vírgula; R$ via parseMoney; PJ exige bruto e líquido > 0; fixo exige líquido; erro em pt-BR
export function orcamentoImportSummary(r: { months: number; lines: number; skipped: number }, warnings: string[], sourceCreated: boolean): string
```

- [ ] **Step 1: Testes que falham** — `validateSource` (PJ ok; "120" em % erro; "abc" erro; PJ com descontos maiores que o bruto → 'O líquido ficou negativo: confira os descontos'; fixo sem líquido erro); resumo da importação.
- [ ] **Step 2:** → FAIL. **Step 3:** cartão "Importar planilha de orçamento" e cartão "Fontes de renda" conforme o mockup (salvar fonte chama `applySource` a partir do mês de hoje; apagar com confirmação na tela).
- [ ] **Step 4:** → PASS. `pnpm vitest run` e `pnpm exec tsc --noEmit` limpos. Print do harness.
- [ ] **Step 5: Commit** `feat: importação e fontes de renda nas configurações`
