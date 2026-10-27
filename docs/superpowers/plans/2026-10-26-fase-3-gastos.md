# Yield — Fase 3 (Últimos gastos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar os gastos reais de conta e cartão dos bancos do Yago, vindos da Pluggy/MeuPluggy (somente leitura) ou de extratos OFX/CSV, com categorias, regras "sempre categorizar X como Y" e assinaturas detectadas.

**Architecture:** Mesmo desenho da fase 1: regra pura em `src/domain/` (categorizar, totais, assinaturas), dados de origem no SQLite (contas, transações, categorias, regras), tudo derivado em memória no `DataProvider`. A Pluggy é lida por um cliente que só conhece `POST /auth` e três `GET`; as credenciais ficam no cofre do sistema (Keychain/Credential Manager) via comandos Rust com o crate `keyring`. A fase é construída contra respostas simuladas; o primeiro contato real é um roteiro que o Yago segue depois.

**Tech Stack:** o da fase 1 (Tauri 2, React, TS, Vitest, `@tauri-apps/plugin-sql`, `@tauri-apps/plugin-http`, `@tauri-apps/plugin-dialog`) + crate Rust `keyring` 3 (features `apple-native`, `windows-native`).

**Spec:** `docs/superpowers/specs/2026-10-26-yield-design.md` §5, §7 ("Pluggy no desenvolvimento"), §8.3, §9 e decisão 15; apoio em `docs/pesquisa-open-finance.md`.

**Ordem:** o Yago pediu a fase 3 antes da fase 2 (26/10/2026). Nada aqui depende da fase 2; a ligação "planejado × real" fica para a fase 2.

**Fora desta fase:** investimentos vindos do Open Finance (spec: no máximo conferência; fica para depois); faturas de cartão (`GET /bills`) e PDF de fatura; categorização da própria Pluggy (exige plano Pro); webhooks; criar/atualizar/excluir item na Pluggy; seletor de intervalo de sincronização; gráficos.

## Global Constraints

- Tudo da fase 1 continua valendo: pt-BR, centavos inteiros (`Cents`), datas `YYYY-MM-DD` e meses `YYYY-MM` como string, nenhum dado real no git, commits **sem** `Co-Authored-By`, tema Grafite, confirmação na tela para tudo que apaga ou substitui dados (nunca `window.confirm`/`alert`), validação de dinheiro digitado com `parseMoney` (`src/pages/notas/build.ts`).
- **Open Finance somente leitura (decisão 15):** o app só chama `POST https://api.pluggy.ai/auth`, `GET /accounts`, `GET /v2/transactions`. Nunca `PATCH`/`DELETE`/`POST /items`, `/payments`, `/connect_token` ou qualquer outra rota. A tela de conexão diz isso com todas as letras.
- Rede: só saem da máquina as cotações do Yahoo e as chamadas acima à Pluggy. Capability do `plugin-http` ganha só `https://api.pluggy.ai/*`.
- Credenciais da Pluggy (`client_id`/`client_secret`) só no cofre do sistema, serviço `com.yagoramires.yield`, contas `pluggy.clientId` e `pluggy.clientSecret`. Nunca no banco, no backup, em log ou no estado do React além do momento do uso.
- **Janela de 15 dias da Pluggy:** o Yago não cria a conta antes desta fase estar pronta; a tela e o roteiro dizem isso.
- Sinal interno das transações: `amountCents < 0` = dinheiro saindo (gasto), `> 0` = entrando. Cartão da Pluggy vem invertido (positivo = compra) e é convertido na leitura.
- Esquema novo em `src-tauri/migrations/002_gastos.sql`; `SCHEMA_VERSION = 2`. Colunas só `INTEGER`, `TEXT`, `REAL`.
- Mockup aprovado pelo Yago antes de construir as telas (Task 7).
- Extratos reais para testar ficam em `extratos/` (gitignored, como `notas/`); fixtures são sintéticas.

## Review Focus

1. **Pagamento de fatura contado duas vezes**: a conta paga a fatura e o cartão já tem as compras; o total de gastos do mês não pode somar os dois. Teste na Task 2.
2. **Sincronizar de novo** (inclusive quando a Pluggy recria transações de cartão com outro `id` perto do fechamento da fatura) não duplica nada e não perde a categoria que o usuário escolheu. Testes nas Tasks 1 e 6.
3. **O mesmo extrato importado duas vezes, ou dois extratos sobrepostos**, não duplica. Teste na Task 4.
4. **Credencial errada, rede fora, 429 ou item inválido** viram mensagem clara em pt-BR e não apagam nada do que já foi sincronizado. Teste na Task 6.
5. **Datas da Pluggy em UTC**: `2026-10-05T00:00:00.000Z` é o dia 05/10; `2026-10-06T01:30:00.000Z` é 05/10 no horário de Brasília (UTC−3). Teste na Task 6.

---

## Estrutura de arquivos (novos)

```
src-tauri/migrations/002_gastos.sql   contas, transações, categorias, regras, ajustes, itens Pluggy
src-tauri/src/lib.rs                  + comandos secret_get/secret_set/secret_delete (keyring)
src/domain/gastos.ts                  normalizar descrição, fingerprint, categorizar, totais
src/domain/assinaturas.ts             detectar cobranças recorrentes
src/db/gastosRepo.ts                  leitura/escrita das tabelas novas
src/import/ofx.ts                     OFX 1.x (SGML) e 2.x (XML)
src/import/extratoCsv.ts              CSV com presets (Nubank conta, Mercado Pago)
src/import/extrato.ts                 importar OFX/CSV no banco
src/openfinance/secrets.ts            cofre (invoke) para as credenciais
src/openfinance/pluggy.ts             cliente só-leitura
src/openfinance/sync.ts               sincronizar contas e transações
src/pages/Lancamentos.tsx, Assinaturas.tsx, Categorias.tsx (+ pastas com build.ts)
docs/roteiro-pluggy.md                passo a passo do primeiro contato real
tests/fixtures/                       ofx/csv/json sintéticos
```

---

### Task 1: Esquema, repositório e migração

**Files:**
- Create: `src-tauri/migrations/002_gastos.sql`, `src/db/gastosRepo.ts`
- Modify: `src-tauri/src/lib.rs` (segunda `Migration { version: 2, … include_str!("../migrations/002_gastos.sql") }`), `src/db/testDb.ts` (aplica 001 e 002 em ordem quando faltar), `src/db/client.ts` (`SCHEMA_VERSION = 2`), `.gitignore` (`/extratos/`)
- Test: `src/db/gastosRepo.test.ts`, `src/db/backup.test.ts` (schema 2)

**Interfaces:**
- Produces:

```ts
export type AccountKind = 'conta' | 'cartao'
export interface Account { id: string; source: 'pluggy' | 'arquivo'; externalId: string; institution: string; name: string; kind: AccountKind; number: string | null; itemId: string | null; lastSyncAt: string | null }
export interface Txn { id: string; accountId: string; date: ISODate; description: string; amountCents: Cents; pending: boolean; installment: string | null /* '3/10' */; operationType: string | null; fingerprint: string; sourceKey: string }
export interface Category { id: string; name: string; countsAsSpending: boolean; builtin: boolean }
export interface CategoryRule { id: string; pattern: string; categoryId: string }
export interface GastosData { accounts: Account[]; txns: Txn[]; categories: Category[]; rules: CategoryRule[]; overrides: Record<string, string> /* fingerprint → categoryId */; dismissed: string[] /* merchantKey */; pluggyItems: { itemId: string; label: string }[] }
export function loadGastos(db: Db): Promise<GastosData>
export function upsertAccount(db: Db, a: Omit<Account, 'id'>): Promise<string>          // por externalId; devolve o id
export function deleteAccount(db: Db, id: string): Promise<void>                          // cascata nas transações
export function replaceWindow(db: Db, accountId: string, from: ISODate, txns: Omit<Txn, 'id' | 'accountId'>[]): Promise<{ inserted: number; removed: number }>   // lê as da conta com date >= from, apaga, grava as novas; se gravar falhar, regrava as antigas e relança (mesmo padrão compensatório do saveNote)
export function insertTxns(db: Db, accountId: string, txns: Omit<Txn, 'id' | 'accountId'>[]): Promise<{ inserted: number; skipped: number }>  // sourceKey repetido é pulado
export function saveCategory(db: Db, name: string, countsAsSpending: boolean): Promise<string>
export function renameCategory(db: Db, id: string, name: string): Promise<void>
export function deleteCategory(db: Db, id: string): Promise<void>                          // builtin → lança 'Categoria padrão não pode ser apagada'
export function saveRule(db: Db, pattern: string, categoryId: string): Promise<void>       // pattern já normalizado; repetido substitui a categoria
export function deleteRule(db: Db, id: string): Promise<void>
export function setOverride(db: Db, fingerprint: string, categoryId: string | null): Promise<void>  // null remove
export function dismissSubscription(db: Db, merchantKey: string): Promise<void>
export function savePluggyItem(db: Db, itemId: string, label: string): Promise<void>
export function deletePluggyItem(db: Db, itemId: string): Promise<void>
export function setLastSync(db: Db, accountId: string, at: string): Promise<void>
```

Esquema: `accounts(id PK, source CHECK IN ('pluggy','arquivo'), external_id UNIQUE, institution, name, kind CHECK IN ('conta','cartao'), number, item_id, last_sync_at)`; `transactions(id PK, account_id FK ON DELETE CASCADE, date, description, amount_cents, pending INTEGER, installment, operation_type, fingerprint NOT NULL, source_key UNIQUE NOT NULL)` com índice em `(account_id, date)`; `categories(id PK, name UNIQUE, counts_as_spending INTEGER, builtin INTEGER)` semeada com: Alimentação, Mercado, Transporte, Moradia, Contas, Saúde, Educação, Lazer, Compras, Assinaturas, Viagem, Impostos e taxas, Outros (contam como gasto) e Receita, Transferência, Pagamento de fatura, Investimento (não contam); todas `builtin = 1`; `category_rules(id PK, pattern UNIQUE, category_id FK ON DELETE CASCADE)`; `category_overrides(fingerprint PK, category_id FK ON DELETE CASCADE)`; `subscription_dismissals(merchant_key PK)`; `pluggy_items(item_id PK, label)`; `UPDATE meta SET value = '2' WHERE key = 'schema_version'`.

- [ ] **Step 1: Testes que falham** — `replaceWindow` troca só a janela (`date >= from`) e mantém o que é mais antigo; com um insert inválido no meio, nada da janela antiga some; `insertTxns` pula `sourceKey` repetido; apagar conta apaga as transações; ajuste por fingerprint sobrevive a `replaceWindow` (está em outra tabela); `deleteCategory` de uma builtin lança erro; apagar categoria custom remove regras e ajustes dela; banco novo tem `schema_version = '2'` e `validateBackup` aceita; um banco v1 (só `001`) recebe a `002` no `createTestDb` e passa a `'2'`.
- [ ] **Step 2:** `pnpm vitest run src/db` → FAIL.
- [ ] **Step 3:** Implementar migração, repo e o `testDb` com a lista `[001, 002]` (aplica as que faltam pela `schema_version` atual).
- [ ] **Step 4:** → PASS. `cargo check` em `src-tauri`.
- [ ] **Step 5: Commit** `feat: esquema e repositório de gastos`

---

### Task 2: Categorizar e totalizar

**Files:**
- Create: `src/domain/gastos.ts`
- Test: `src/domain/gastos.test.ts`

**Interfaces:**
- Consumes: `Txn`, `Category`, `CategoryRule` (Task 1).
- Produces:

```ts
export function normalizeDescription(s: string): string       // minúsculas, sem acento, sem dígitos, sem pontuação, sem prefixos 'pg *', 'pag*', 'paypal *', 'mp*', 'ifd*', espaços colapsados
export function fingerprint(accountId: string, date: ISODate, amountCents: Cents, description: string, occurrence: number): string   // `${accountId}|${date}|${amountCents}|${normalizeDescription(description)}|#${occurrence}`
export function withFingerprints<T extends { date: ISODate; amountCents: Cents; description: string }>(accountId: string, rows: T[]): (T & { fingerprint: string })[]   // occurrence = posição entre linhas idênticas no mesmo dia
export function categorize(t: Txn, account: Account, rules: CategoryRule[], overrides: Record<string, string>, categories: Category[]): Category | null
export interface MonthTotals { spentCents: Cents; incomeCents: Cents; byCategory: { category: Category | null; cents: Cents }[] }
export function monthTotals(txns: Txn[], accounts: Account[], cat: (t: Txn) => Category | null, month: Month): MonthTotals
```

Ordem de `categorize`: ajuste do fingerprint → regra cujo `pattern` está contido em `normalizeDescription(t.description)` (a mais longa ganha) → automático: `operationType === 'PAGAMENTO_FATURA'` ou conta corrente com descrição que case `/pagamento.*fatura|pag(to)? fatura|fatura.*cart/` → "Pagamento de fatura"; `RENDIMENTO_APLIC_FINANCEIRA`/`RESGATE_APLIC_FINANCEIRA` → "Investimento"; cartão com `amountCents > 0` (pagamento recebido) → "Pagamento de fatura" → senão `null` ("Sem categoria"). `monthTotals`: gasto = `amountCents < 0` cuja categoria é `null` ou `countsAsSpending`; entrada = `amountCents > 0` com categoria `null`, "Receita" ou que conte como gasto (estorno); pendentes entram.

- [ ] **Step 1: Testes que falham**

```ts
expect(normalizeDescription('PG *NETFLIX.COM 1234')).toBe('netflix com')
expect(normalizeDescription('Pão de Açúcar  #12')).toBe('pao de acucar')
// mês com: compra no cartão −100,00; pagamento da fatura na conta −100,00 ('Pagamento de fatura'); mesma fatura recebida no cartão +100,00
expect(monthTotals(...).spentCents).toBe(10000)
// regra 'uber' → Transporte e regra 'uber eats' → Alimentação: 'UBER *EATS' cai em Alimentação
// ajuste do fingerprint ganha da regra
// duas compras iguais no mesmo dia geram fingerprints '#0' e '#1'
```

- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: categorias e totais de gastos`

---

### Task 3: Assinaturas detectadas

**Files:**
- Create: `src/domain/assinaturas.ts`
- Test: `src/domain/assinaturas.test.ts`

**Interfaces:**
- Consumes: `Txn`, `Account`, `normalizeDescription`, categorizador (Task 2).
- Produces:

```ts
export interface Subscription { merchantKey: string; name: string /* descrição mais recente */; accountId: string; period: 'mensal' | 'anual'; amountCents: Cents /* positivo */; monthlyCents: Cents; yearlyCents: Cents; lastDate: ISODate; nextDate: ISODate; active: boolean; charges: number }
export function detectSubscriptions(txns: Txn[], cat: (t: Txn) => Category | null, dismissed: string[], today: ISODate): Subscription[]
```

Regra: só gastos (`amountCents < 0`, contam como gasto), sem parcela (`installment === null`), não pendentes. Agrupa por `normalizeDescription` + conta. Mensal: ≥ 3 cobranças, intervalos entre 25 e 35 dias, valores a até 15% da mediana; anual: ≥ 2 cobranças com intervalo de 350 a 380 dias. `amountCents` = última cobrança; `monthlyCents` = mensal ou anual/12 (arredondado); `yearlyCents` = mensal×12 ou o anual; `nextDate` = última + mediana dos intervalos (mensal) ou + 1 ano; `active` = última cobrança há no máximo 45 dias (mensal) ou 400 (anual). Dispensadas (`dismissed`) somem. Ordena por `monthlyCents` desc.

- [ ] **Step 1: Testes que falham** — Netflix 39,90 em 05/07, 05/08, 05/09 → mensal, próxima 05/10; preço subiu para 44,90 na 3ª (≤ 15%) continua assinatura; parcelas `1/3, 2/3, 3/3` nunca viram assinatura; duas compras no mesmo mercado em meses seguidos com valores diferentes não viram; anual de 2025-03-10 e 2026-03-12 → anual, `monthlyCents` = valor/12; última cobrança há 60 dias → `active: false`; dispensada não aparece.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: detecção de assinaturas`

---

### Task 4: Importar extrato OFX e CSV (plano B)

**Files:**
- Create: `src/import/ofx.ts`, `src/import/extratoCsv.ts`, `src/import/extrato.ts`, `tests/fixtures/extrato-sgml.ofx`, `tests/fixtures/extrato-cartao.ofx`, `tests/fixtures/nubank-conta.csv`, `tests/fixtures/mercadopago.csv`
- Test: `src/import/ofx.test.ts`, `src/import/extratoCsv.test.ts`, `src/import/extrato.test.ts`

**Interfaces:**
- Consumes: `upsertAccount`, `insertTxns` (Task 1), `withFingerprints` (Task 2), `parseBRL`, `parseBRDate`.
- Produces:

```ts
// ofx.ts
export interface ParsedStatement { institution: string; externalId: string /* 'ofx:<BANKID|ORG>:<ACCTID>' */; kind: AccountKind; number: string | null; rows: { date: ISODate; description: string; amountCents: Cents; fitid: string | null }[] }
export function decodeStatement(data: ArrayBuffer): string    // UTF-8; se o cabeçalho disser CHARSET:1252/ISO-8859-1 ou houver bytes inválidos, decodifica como windows-1252
export function parseOfx(text: string): ParsedStatement        // BANKMSGSRSV1 → conta; CREDITCARDMSGSRSV1 → cartão; tags SGML sem fechamento e XML
// extratoCsv.ts
export type CsvPreset = 'nubank-conta' | 'mercadopago'
export function detectCsvPreset(text: string): CsvPreset | null   // pelo cabeçalho
export function parseExtratoCsv(text: string, preset: CsvPreset, accountLabel: string): ParsedStatement
// extrato.ts
export function importStatement(db: Db, s: ParsedStatement): Promise<{ accountId: string; inserted: number; skipped: number }>
```

Presets (cabeçalhos públicos; validar com arquivos reais em `extratos/` se o Yago tiver colocado, senão marcar como pendente): Nubank conta `Data,Valor,Identificador,Descrição` (data `DD/MM/AAAA`, valor com ponto decimal e sinal); Mercado Pago `RELEASE_DATE;TRANSACTION_TYPE;REFERENCE_ID;TRANSACTION_NET_AMOUNT;PARTIAL_BALANCE` (separador `;`, decimal com vírgula). `sourceKey`: OFX `ofx:<conta>:<FITID>`; sem FITID, `ofx:<conta>:<fingerprint>`; Nubank `csv:nubank:<Identificador>`; Mercado Pago `csv:mp:<REFERENCE_ID>`. Conta do arquivo: `source: 'arquivo'`.

- [ ] **Step 1: Testes que falham** — OFX SGML de conta (sem tags de fechamento, `CHARSET:1252`, descrição "PADARIA SÃO JOSÉ" em latin1) vira 3 linhas com acento certo e sinais corretos; OFX de cartão vira `kind: 'cartao'`; CSV Nubank e Mercado Pago viram linhas com centavos e datas certos; `detectCsvPreset` reconhece os dois e devolve `null` para um CSV qualquer; importar o mesmo OFX duas vezes → `{ inserted: 0, skipped: 3 }`; dois OFX sobrepostos (dias 1–20 e 10–31) somam só as linhas novas.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: importação de extrato OFX e CSV`

---

### Task 5: Cofre do sistema para as credenciais

**Files:**
- Modify: `src-tauri/Cargo.toml` (`keyring = { version = "3", features = ["apple-native", "windows-native"] }`), `src-tauri/src/lib.rs`
- Create: `src/openfinance/secrets.ts`
- Test: teste Rust em `lib.rs` (`#[cfg(test)]`, builder `keyring::mock`)

**Interfaces:**
- Produces:

```rust
#[tauri::command] fn secret_get(key: String) -> Result<Option<String>, String>
#[tauri::command] fn secret_set(key: String, value: String) -> Result<(), String>
#[tauri::command] fn secret_delete(key: String) -> Result<(), String>   // inexistente não é erro
// só aceitam key em ["pluggy.clientId", "pluggy.clientSecret"]; outra key → Err
```

```ts
export const SECRET_KEYS = { clientId: 'pluggy.clientId', clientSecret: 'pluggy.clientSecret' } as const
export function getPluggyCredentials(): Promise<{ clientId: string; clientSecret: string } | null>   // null se faltar qualquer um
export function setPluggyCredentials(clientId: string, clientSecret: string): Promise<void>       // trim; vazio lança erro em pt-BR
export function clearPluggyCredentials(): Promise<void>
```

Serviço do keyring: `com.yagoramires.yield`. A lógica dos comandos fica numa função que recebe o `Entry` (ou o nome do serviço) para o teste usar o builder `mock`.

- [ ] **Step 1: Teste Rust que falha** — set → get devolve o valor; delete → get devolve `None`; delete de algo inexistente é `Ok`; key fora da lista → `Err`.
- [ ] **Step 2:** `cargo test` → FAIL. **Step 3:** implementar e registrar no `invoke_handler`. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: credenciais da Pluggy no cofre do sistema`

---

### Task 6: Cliente Pluggy só-leitura e sincronização

**Files:**
- Create: `src/openfinance/pluggy.ts`, `src/openfinance/sync.ts`, `tests/fixtures/pluggy/*.json` (sintéticos, no formato da documentação)
- Modify: `src-tauri/capabilities/default.json` (`http:default` + `{ "url": "https://api.pluggy.ai/*" }`)
- Test: `src/openfinance/pluggy.test.ts`, `src/openfinance/sync.test.ts`

**Interfaces:**
- Consumes: `upsertAccount`, `replaceWindow`, `setLastSync`, `loadGastos` (Task 1), `withFingerprints` (Task 2), `getPluggyCredentials` (Task 5).
- Produces:

```ts
// pluggy.ts
export const PLUGGY_BASE = 'https://api.pluggy.ai'
export class PluggyError extends Error { constructor(message: string, public kind: 'credenciais' | 'item' | 'limite' | 'rede' | 'resposta') }
export interface PluggyAccount { id: string; type: 'BANK' | 'CREDIT'; subtype: string; name: string; marketingName?: string | null; number?: string | null; itemId: string }
export interface PluggyTxn { id: string; date: string; description: string; amount: number; type: 'DEBIT' | 'CREDIT'; status: 'PENDING' | 'POSTED'; operationType?: string | null; creditCardMetadata?: { installmentNumber?: number; totalInstallments?: number } | null }
export function createPluggyClient(creds: { clientId: string; clientSecret: string }, fetchFn: typeof fetch): {
  listAccounts(itemId: string): Promise<PluggyAccount[]>
  listTransactions(accountId: string, dateFrom: ISODate, dateTo: ISODate): Promise<PluggyTxn[]>   // GET /v2/transactions?accountId&dateFrom&dateTo; segue `next` até acabar
}
export function pluggyDate(iso: string): ISODate        // T00:00:00.000Z → o próprio dia; outro horário → dia em UTC−3
export function toTxnRow(t: PluggyTxn, kind: AccountKind): { date: ISODate; description: string; amountCents: Cents; pending: boolean; installment: string | null; operationType: string | null }
// sync.ts
export const SYNC_EVERY_MS = 6 * 60 * 60 * 1000
export interface SyncResult { accounts: number; inserted: number; removed: number; errors: { itemId: string; label: string; message: string }[] }
export function syncPluggy(db: Db, creds: { clientId: string; clientSecret: string }, fetchFn: typeof fetch, today: ISODate): Promise<SyncResult>
```

Cliente: uma função interna `request(method: 'GET' | 'POST', path: string, …)` que **recusa** qualquer combinação fora de `POST /auth`, `GET /accounts`, `GET /v2/transactions` (lança antes de chamar `fetchFn`). API key de `POST /auth` reutilizada por 1h50 na mesma instância. Erros: 401/403 → `credenciais` ("Client ID ou Client Secret inválidos"); 404 no item → `item` ("Item <id> não encontrado: confira o itemId"); 429 → `limite` ("A Pluggy pediu para esperar; tente mais tarde"); falha de rede → `rede`; JSON fora do formato → `resposta`. Conversão: conta `BANK` → `conta`, `CREDIT` → `cartao`; cartão inverte o sinal; `installment` = `"<n>/<total>"` quando `totalInstallments > 1`; `pending` = `status === 'PENDING'`. `externalId` = `pluggy:<account.id>`, `institution` = label do item. Sync: para cada item salvo, lista contas, `upsertAccount`, e para cada conta busca de `dateFrom` = `today − 365 dias` na primeira vez, senão `lastSyncAt − 35 dias` (cobre a reemissão de transações de cartão no fechamento), até `today + 31` (pendentes e parcelas futuras), e aplica `replaceWindow` com `sourceKey = pluggy:<fingerprint>`. Erro num item vai para `errors` e não toca nas contas dele; os outros itens seguem.

- [ ] **Step 1: Testes que falham** (com `fetchFn` falso que grava as chamadas)

```ts
// só POST /auth e GETs: depois de um sync completo, toda chamada é POST .../auth ou GET .../accounts?itemId= ou GET .../v2/transactions?...
// chamar a função interna com PATCH /items/x ou GET /payments lança e não chama fetchFn
expect(pluggyDate('2026-10-05T00:00:00.000Z')).toBe('2026-10-05')
expect(pluggyDate('2026-10-06T01:30:00.000Z')).toBe('2026-10-05')
// cartão: amount 75 → amountCents −7500; amount −150 (pagamento) → +15000
// paginação: duas páginas via `next` viram uma lista
// sync duas vezes com as mesmas respostas → 0 linhas a mais
// a 2ª resposta traz a mesma compra de cartão com outro id → continua uma linha só e o ajuste de categoria (fingerprint) continua valendo
// 401 → errors[0].message 'Client ID ou Client Secret inválidos' e as transações já salvas continuam lá
// um item com 404 e outro ok → o ok sincroniza, o 404 aparece em errors
```

- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: leitura da Pluggy só com GET e sincronização`

---

### Task 7: Mockups das telas de Últimos gastos (aprovação do Yago)

**Files:**
- Create: `docs/design/telas-fase-3.html` e `docs/design/telas-fase-3.md` (depois da aprovação)

- [ ] **Step 1:** No visual companion (skill brainstorming, `--project-dir` no `yield/`), no tema Grafite e com números fictícios, no mesmo formato de `docs/design/telas-fase-1.html`: **Lançamentos** (cartões do mês: gasto, entradas, maior categoria; filtros conta/cartão, mês, categoria; lista por dia com descrição, conta, categoria editável, parcela, pendente; "sempre categorizar … como …"; botões "Sincronizar" com hora da última sincronização e "Importar extrato"; aviso de duas contas da mesma instituição com os mesmos dígitos), **Assinaturas** (lista com valor, período, mensal equivalente, próxima cobrança, conta, ativa/parada; total mensal e anual; "não é assinatura"), **Categorias** (lista com gasto do mês e se conta como gasto; criar, renomear, apagar com confirmação; regras com padrão → categoria, apagar), **Configurações › Open Finance** (passo a passo da Pluggy com o aviso dos 15 dias, a frase "O Yield só lê seus dados: não move dinheiro nem inicia pagamentos.", campos Client ID/Client Secret, lista de itemIds com nome do banco, "Testar conexão", situação por item).
- [ ] **Step 2:** **Parar e esperar o Yago aprovar cada tela.** Registrar ajustes em `docs/design/telas-fase-3.md`.
- [ ] **Step 3: Commit** `docs: telas aprovadas da fase 3`

---

### Task 8: Estado e tela de Lançamentos

**Files:**
- Create: `src/pages/Lancamentos.tsx`, `src/pages/lancamentos/build.ts`
- Modify: `src/state/DataProvider.tsx` (carrega `GastosData`, deriva categorizador/totais/assinaturas, sincroniza ao abrir se a última sincronização de alguma conta Pluggy tiver mais de `SYNC_EVERY_MS` e houver credenciais, e expõe `syncNow()` e `lastSyncResult`), `src/ui/routes.ts` (rotas `lancamentos`, `assinaturas`, `categorias` habilitadas), `src/App.tsx`
- Test: `src/pages/lancamentos/build.test.ts`, `src/ui/routes.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: `useData()` ganha `gastos: { data: GastosData; categorize(t: Txn): Category | null; subscriptions: Subscription[]; syncing: boolean; lastSyncResult: SyncResult | null; syncNow(): Promise<void> }`.

- [ ] **Step 1: Testes que falham** (funções puras de `build.ts`): filtro por conta, mês e categoria (inclusive "Sem categoria"); agrupamento por dia, mais recente primeiro; `suggestRulePattern(description)` = `normalizeDescription`; `duplicateAccountWarning(accounts)` acusa duas contas da mesma instituição e mesmo `number`, de origens diferentes.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar a página conforme o mockup aprovado: trocar a categoria salva um ajuste (`setOverride`); a caixa "sempre categorizar" salva uma regra (`saveRule`) em vez do ajuste; "Importar extrato" aceita `.ofx,.csv`, detecta o preset, pede o nome da conta quando o CSV não traz, mostra o resumo (`inserted`, `skipped`); erros de sincronização aparecem por item.
- [ ] **Step 4:** → PASS. Conferir no app com print (sem clicar via automação): a página abre com o banco vazio.
- [ ] **Step 5: Commit** `feat: tela de lançamentos com sincronização e importação`

---

### Task 9: Telas de Assinaturas e Categorias

**Files:**
- Create: `src/pages/Assinaturas.tsx`, `src/pages/Categorias.tsx`, `src/pages/categorias/build.ts`
- Test: `src/pages/categorias/build.test.ts`

**Interfaces:**
- Consumes: `useData().gastos`, `dismissSubscription`, `saveCategory`, `renameCategory`, `deleteCategory`, `saveRule`, `deleteRule`.

- [ ] **Step 1: Testes que falham**: `spentByCategory(month)` bate com `monthTotals`; validação do nome de categoria (vazio, repetido ignorando acento e caixa → erro em pt-BR); `totalsOfSubscriptions(subs)` soma só as ativas (mensal e anual).
- [ ] **Step 2:** → FAIL. **Step 3:** implementar as duas páginas conforme o mockup; apagar categoria custom avisa quantas regras e ajustes vão junto e pede confirmação; "não é assinatura" pede confirmação e chama `dismissSubscription`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: telas de assinaturas e categorias`

---

### Task 10: Configurações › Open Finance e roteiro

**Files:**
- Create: `src/pages/configuracoes/OpenFinance.tsx`, `docs/roteiro-pluggy.md`
- Modify: `src/pages/Configuracoes.tsx`, `docs/superpowers/specs/2026-10-26-yield-design.md` (decisão 5: anotar que a fase 3 veio antes da 2 a pedido do Yago em 26/10/2026)
- Test: `src/pages/configuracoes/build.test.ts` (validação de itemId)

**Interfaces:**
- Consumes: `setPluggyCredentials`, `getPluggyCredentials`, `clearPluggyCredentials` (Task 5), `createPluggyClient` (Task 6), `savePluggyItem`, `deletePluggyItem` (Task 1), `useData().gastos.syncNow`.

- [ ] **Step 1: Teste que falha**: `parseItemId(text)` aceita UUID (com espaços em volta) e recusa o resto com "itemId inválido: copie do painel da Pluggy".
- [ ] **Step 2:** → FAIL. **Step 3:** implementar o cartão conforme o mockup: o passo a passo de `docs/pesquisa-open-finance.md` (criar conta em meu.pluggy.ai, conectar cada banco, adicionar o conector MeuPluggy no dashboard, copiar itemId, Client ID e Client Secret) com o aviso "Faça tudo dentro dos 15 dias do teste da Pluggy" e a frase de somente leitura; os campos de credencial nunca mostram o secret salvo (só "salvo no cofre do sistema" e "Trocar"/"Apagar" com confirmação); "Testar conexão" chama `listAccounts` de cada item e mostra quantas contas achou ou o erro. `docs/roteiro-pluggy.md`: o mesmo passo a passo, na ordem, para o Yago seguir no primeiro contato real, com o que conferir depois da primeira sincronização (contas certas, sinais, fatura não contada duas vezes).
- [ ] **Step 4:** → PASS. `pnpm vitest run` e `pnpm exec tsc --noEmit` limpos.
- [ ] **Step 5: Commit** `feat: conexão Open Finance só leitura nas configurações`
