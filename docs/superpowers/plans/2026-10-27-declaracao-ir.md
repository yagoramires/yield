# Declaração de IR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela "Declaração IR" com Bens e Direitos, Rendimentos, Renda variável e Cadastro (empresas/corretoras), pronta para copiar campo a campo.

**Architecture:** Migração 008 + `src/db/irRepo.ts` (cadastro); lógica pura em `src/domain/declaracao.ts`; leitura da planilha em `src/import/cadastroPlanilha.ts`; página `src/pages/Declaracao.tsx` + `src/pages/declaracao/*`.

**Tech Stack:** React 19 + TS, Vitest (node:sqlite), xlsx (já no projeto), lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-27-declaracao-ir-design.md`

## Global Constraints

- Repositório público: fixtures inventadas; nada de `planilhas/` em testes ou no código.
- Migrações 001–007 congeladas; esta é a 008.
- Centavos inteiros; pt-BR; sem `window.confirm/alert`.
- Commits sem `Co-Authored-By` nem rodapé do Claude.
- Posição em 31/12 pela **data de liquidação** (`settleDate <= AAAA-12-31`), como a planilha — ver Ruling no fim.

## Review Focus

1. Ativo com `mudanca_ticker` no ano → uma linha só, "era" com a posição do ticker antigo (teste na Task 2).
2. Venda total no ano → aparece zerado, texto "Posição zerada…" (teste na Task 2).
3. Compra em 30/12 liquidando em janeiro → não conta em 31/12 (teste na Task 2).
4. CNPJ com dígito verificador errado ou só pontuação → recusado com mensagem (teste na Task 1).
5. Importar planilha com ticker já editado à mão → não sobrescreve (teste na Task 1).

---

### Task 1: Banco e cadastro

**Files:** Create `src-tauri/migrations/008_cadastro_ir.sql`, `src/db/irRepo.ts`, `src/db/irRepo.test.ts`; Modify `lib.rs`, `client.ts` (`SCHEMA_VERSION = 8`), `testDb.ts`, asserções de versão nos testes.

**Produces:**
- `formatCnpj(text: string): string` em `src/domain/declaracao.ts` — aceita com ou sem pontuação, valida 14 dígitos + DV, devolve `00.000.000/0000-00`; senão `throw new Error('CNPJ inválido: confira os 14 números')`.
- `interface Issuer { ticker: string; name: string; cnpj: string }`, `interface Broker { code: string; name: string; cnpj: string }`
- `loadCadastro(db): Promise<{ issuers: Issuer[]; brokers: Broker[] }>`, `saveIssuer(db, i)`, `saveBroker(db, b)` (upsert; nome aparado e não vazio, CNPJ via `formatCnpj`), `deleteIssuer`/`deleteBroker` não são necessários.
- `importCadastro(db, data: { issuers: Issuer[]; brokers: Broker[] }): Promise<{ issuers: number; brokers: number; skipped: number }>` — `INSERT OR IGNORE` (o que já existe fica).

- [ ] Testes: `formatCnpj` (válido com/sem pontuação; DV errado; 13 dígitos; vazio); save/load; import não sobrescreve um issuer salvo antes e conta `skipped`; migração 008 cria as tabelas (versão '8').
- [ ] Rodar → FAIL; implementar; `npx vitest run` + `tsc` + `cargo check` verdes; commit `feat: cadastro de empresas e corretoras para a declaração de IR`.

### Task 2: Lógica da declaração (`src/domain/declaracao.ts`)

**Consumes:** `replay` (ledger), `TaxMonth`, `DarfPayment`, `Dividend`, `Trade`, `CorporateEvent`, `Issuer`, `Broker`.

**Produces:**
- `BEM_CODES: Record<AssetType, { grupo: string; codigo: string; label: string }>` — valores do spec (Ação 03/01, FII 07/03, ETF 07/09, BDR 04/04) com o texto "03 – Participações societárias / 01 – Ações" etc.
- `interface Bem { ticker: string; oldTickers: string[]; assetType: AssetType; qtyPrev: number; costPrevCents: Cents; qty: number; costCents: Cents; brokers: string[] }`
- `bensDoAno(trades, events, year: number): Bem[]` — posições por replay com trades `settleDate <= {ano}-12-31` (e `{ano-1}-12-31`) e eventos até a data; une cadeias de `mudanca_ticker`; inclui quem tem `qty > 0` em qualquer das datas; corretoras pelo saldo por corretora na cadeia (fallback: as que negociaram). Ordem: `costCents` desc.
- `discriminacao(b: Bem, year: number, issuer: Issuer | undefined, brokers: Map<string, Broker>): string` — formatos do spec (4 casas no preço médio, "Ações"/"Cotas", uma/várias corretoras com " e ", zerada, marcadores `[CNPJ não cadastrado]`/`[razão social não cadastrada]`).
- `rendimentosDoAno(dividends, year, typeOf: (ticker) => AssetType | undefined, issuers: Map<string, Issuer>): { linha: '09' | '26' | '10'; payerKey: string; name: string | null; cnpj: string | null; tickers: string[]; cents: Cents }[]`
- `lucroIsentoDoAno(tax: TaxMonth[], year): Cents` (soma `comum.exemptProfitCents`).
- `rendaVariavelDoAno(tax, payments: DarfPayment[], year): { comum: Linha[]; fii: Linha[] }` com `Linha = { month; resultCents; lossInCents; irrfCents; taxPayableCents; darfPaidCents }`, só meses com `resultCents !== 0` ou venda (`stockSalesCents > 0`) — FII: `fii.resultCents !== 0`.
- `pendencias(bens, rendimentos, issuers, brokersMap): { tickers: string[]; brokers: string[] }`

- [ ] Testes com trades inventados cobrindo os 5 itens do Review Focus + texto da discriminação em cada formato + mapeamento 09/26/10 + agrupamento por CNPJ + DARF por mês de competência.
- [ ] FAIL → implementar → verde; commit `feat: bens, rendimentos e renda variável da declaração de IR`.

### Task 3: Ler o cadastro da planilha (`src/import/cadastroPlanilha.ts`)

**Produces:** `parseCadastroPlanilha(buf: ArrayBuffer, knownBrokers: string[]): { issuers: Issuer[]; brokers: Broker[]; unknownBrokers: number; invalid: number }` — aba "Empresas Listadas" (cabeçalho Ticker/CNPJ/Razão social; ticker em maiúsculas; CNPJ inválido conta em `invalid` e fica de fora); bloco de corretoras da aba "Bens e Direitos" a partir da linha cujo A é "Corretora", até a primeira vazia, casando A com `knownBrokers` sem caixa/acentos (o `code` salvo é o de `knownBrokers`).
- [ ] Teste com workbook gerado pelo `xlsx` no próprio teste; FAIL → implementar → verde; commit `feat: importar empresas e corretoras da planilha`.

### Task 4: A tela

**Files:** Create `src/pages/Declaracao.tsx`, `src/pages/declaracao/{Bens,Rendimentos,RendaVariavel,Cadastro}.tsx`; Modify `src/ui/routes.ts` (rota `declaracao`, label "Declaração IR" em Investimentos, depois de Imposto), `src/App.tsx`, `src/theme.css`, `src/state/DataProvider.tsx` (carregar cadastro junto: `data.cadastro` + recarregar no `reload`).

Layout e textos exatamente como a seção "Tela" do spec; copiar com `navigator.clipboard.writeText` e ✓ por 1,5 s.
- [ ] Implementar; `tsc` + `vitest` verdes; conferência visual em página de teste temporária (dados inventados, desktop e 390px); commit `feat: tela de Declaração de IR`.

### Task 5: Fechamento
- [ ] Varrer diff contra dados reais; build assinado + cópia do banco antes da 008 + instalar; revisão final por revisor novo.

---
**Ruling (autor do plano):** posição em 31/12 pela data de liquidação, como a planilha antiga — a Carteira usa o pregão, então uma compra de 30/12 aparece na Carteira em dezembro mas só na declaração do ano seguinte. Custo se errado: trocar o filtro para `tradeDate`.
