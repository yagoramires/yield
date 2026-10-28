import type { Cents, ISODate } from '../domain/types'
import type { Db } from './client'

export type AccountKind = 'conta' | 'cartao'
export interface Account { id: string; source: 'pluggy' | 'arquivo'; externalId: string; institution: string; name: string; kind: AccountKind; number: string | null; itemId: string | null; lastSyncAt: string | null }
export interface Txn { id: string; accountId: string; date: ISODate; description: string; amountCents: Cents; pending: boolean; installment: string | null /* '3/10' */; operationType: string | null; fingerprint: string; sourceKey: string; pluggyCategory?: string | null /* em inglês, só da Pluggy */ }
export interface Category { id: string; name: string; countsAsSpending: boolean; builtin: boolean; icon: string | null /* nome Lucide */; color: string | null }
export interface CategoryRule { id: string; pattern: string; categoryId: string }
export interface GastosData { accounts: Account[]; txns: Txn[]; categories: Category[]; rules: CategoryRule[]; overrides: Record<string, string> /* fingerprint → categoryId */; dismissed: string[] /* merchantKey */; pluggyItems: { itemId: string; label: string }[]; ownerNames: string[] /* variações do nome do titular, para Pix entre contas suas */; companyNames: string[] /* nome ou CNPJ da empresa do titular: o que ela paga é Receita */; ruleSuggestionsDismissed: string[] /* padrões que o usuário não quer virar regra */ }

type TxnInput = Omit<Txn, 'id' | 'accountId'>

const TXN_COLS = `id, account_id AS accountId, date, description, amount_cents AS amountCents, pending, installment,
  operation_type AS operationType, fingerprint, source_key AS sourceKey, pluggy_category AS pluggyCategory`

const SUGGESTIONS_KEY = 'categorias.sugestoesRecusadas'

export async function loadGastos(db: Db): Promise<GastosData> {
  const [accounts, txns, categories, rules, overrides, dismissed, pluggyItems, owner, company, refused] = await Promise.all([
    db.select<Account>('SELECT id, source, external_id AS externalId, institution, name, kind, number, item_id AS itemId, last_sync_at AS lastSyncAt FROM accounts ORDER BY institution, name'),
    db.select<Txn>(`SELECT ${TXN_COLS} FROM transactions ORDER BY date, id`),
    db.select<Category>('SELECT id, name, counts_as_spending AS countsAsSpending, builtin, icon, color FROM categories ORDER BY builtin DESC, rowid'),
    db.select<CategoryRule>('SELECT id, pattern, category_id AS categoryId FROM category_rules ORDER BY pattern'),
    db.select<{ fingerprint: string; categoryId: string }>('SELECT fingerprint, category_id AS categoryId FROM category_overrides'),
    db.select<{ merchantKey: string }>('SELECT merchant_key AS merchantKey FROM subscription_dismissals ORDER BY merchant_key'),
    db.select<{ itemId: string; label: string }>('SELECT item_id AS itemId, label FROM pluggy_items ORDER BY label'),
    db.select<{ value: string }>("SELECT value FROM meta WHERE key = 'gastos.titular'"),
    db.select<{ value: string }>("SELECT value FROM meta WHERE key = 'gastos.empresa'"),
    db.select<{ value: string }>('SELECT value FROM meta WHERE key = ?', [SUGGESTIONS_KEY]),
  ])
  return {
    accounts,
    txns: txns.map(t => ({ ...t, pending: !!t.pending })),
    categories: categories.map(c => ({ ...c, countsAsSpending: !!c.countsAsSpending, builtin: !!c.builtin })),
    rules,
    overrides: Object.fromEntries(overrides.map(o => [o.fingerprint, o.categoryId])),
    dismissed: dismissed.map(d => d.merchantKey),
    pluggyItems,
    ownerNames: owner[0] ? JSON.parse(owner[0].value) as string[] : [],
    companyNames: company[0] ? JSON.parse(company[0].value) as string[] : [],
    ruleSuggestionsDismissed: refused[0] ? JSON.parse(refused[0].value) as string[] : [],
  }
}

export async function saveOwnerNames(db: Db, names: string[]): Promise<void> {
  await db.execute("INSERT INTO meta (key, value) VALUES ('gastos.titular', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [JSON.stringify(names)])
}

export async function saveCompanyNames(db: Db, names: string[]): Promise<void> {
  await db.execute("INSERT INTO meta (key, value) VALUES ('gastos.empresa', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [JSON.stringify(names)])
}

export async function upsertAccount(db: Db, a: Omit<Account, 'id'>): Promise<string> {
  // last_sync_at fica de fora do UPDATE: só setLastSync grava.
  await db.execute(
    `INSERT INTO accounts (id, source, external_id, institution, name, kind, number, item_id, last_sync_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (external_id) DO UPDATE SET institution = excluded.institution, name = excluded.name, kind = excluded.kind, number = excluded.number, item_id = excluded.item_id`,
    [crypto.randomUUID(), a.source, a.externalId, a.institution, a.name, a.kind, a.number, a.itemId, a.lastSyncAt],
  )
  return (await db.select<{ id: string }>('SELECT id FROM accounts WHERE external_id = ?', [a.externalId]))[0].id
}

export async function deleteAccount(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM accounts WHERE id = ?', [id])
}

export async function setLastSync(db: Db, accountId: string, at: string): Promise<void> {
  await db.execute('UPDATE accounts SET last_sync_at = ? WHERE id = ?', [at, accountId])
}

async function insertRow(db: Db, accountId: string, t: TxnInput & { id?: string }) {
  await db.execute(
    'INSERT INTO transactions (id, account_id, date, description, amount_cents, pending, installment, operation_type, fingerprint, source_key, pluggy_category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [t.id ?? crypto.randomUUID(), accountId, t.date, t.description, t.amountCents, t.pending ? 1 : 0, t.installment, t.operationType, t.fingerprint, t.sourceKey, t.pluggyCategory ?? null],
  )
}

export async function replaceWindow(db: Db, accountId: string, from: ISODate, txns: TxnInput[]): Promise<{ inserted: number; removed: number }> {
  const keys = txns.map(t => t.sourceKey)
  // Uma data convertida de fuso pode cair antes de `from`; sem apagar pelo sourceKey o UNIQUE quebraria toda sincronização.
  const where = `account_id = ? AND (date >= ?${keys.length ? ` OR source_key IN (${keys.map(() => '?').join(', ')})` : ''})`
  const params = [accountId, from, ...keys]
  const old = (await db.select<Txn>(`SELECT ${TXN_COLS} FROM transactions WHERE ${where}`, params)).map(t => ({ ...t, pending: !!t.pending }))
  await db.execute(`DELETE FROM transactions WHERE ${where}`, params)
  try {
    for (const t of txns) await insertRow(db, accountId, t)
  } catch (e) {
    // desfaz o que entrou e regrava a janela antiga
    await db.execute(`DELETE FROM transactions WHERE account_id = ? AND source_key IN (${keys.map(() => '?').join(', ')})`, [accountId, ...keys])
    for (const t of old) await insertRow(db, accountId, t)
    throw e
  }
  const before = new Set(old.map(t => t.sourceKey)), now = new Set(keys)
  return { inserted: keys.filter(k => !before.has(k)).length, removed: old.filter(t => !now.has(t.sourceKey)).length }
}

export async function insertTxns(db: Db, accountId: string, txns: TxnInput[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0
  for (const t of txns) {
    if ((await db.select('SELECT 1 FROM transactions WHERE source_key = ?', [t.sourceKey])).length) continue
    await insertRow(db, accountId, t)
    inserted++
  }
  return { inserted, skipped: txns.length - inserted }
}

export async function saveCategory(db: Db, name: string, countsAsSpending: boolean, look: { icon: string | null; color: string | null } = { icon: null, color: null }): Promise<string> {
  const id = crypto.randomUUID()
  await db.execute('INSERT INTO categories (id, name, counts_as_spending, builtin, icon, color) VALUES (?, ?, ?, 0, ?, ?)', [id, name, countsAsSpending ? 1 : 0, look.icon, look.color])
  return id
}

// "Conta como gasto" só muda nas do usuário: o app trata receita, transferência, fatura e investimento pelo id.
export async function updateCategory(db: Db, id: string, f: { name: string; icon: string | null; color: string | null; countsAsSpending: boolean }): Promise<void> {
  await db.execute(
    'UPDATE categories SET name = ?, icon = ?, color = ?, counts_as_spending = CASE WHEN builtin = 1 THEN counts_as_spending ELSE ? END WHERE id = ?',
    [f.name, f.icon, f.color, f.countsAsSpending ? 1 : 0, id],
  )
}

/**
 * Apaga uma categoria do usuário. Com `moveTo`, as compras escolhidas à mão, as regras e as linhas do orçamento vão para ela;
 * sem, as escolhas e regras somem (a compra volta para a categoria automática) e a linha do orçamento fica sem categoria.
 * Move antes de apagar: sem transação no plugin, uma falha no meio deixa a categoria, nunca perde dado.
 */
export async function deleteCategory(db: Db, id: string, moveTo: string | null): Promise<void> {
  if ((await db.select('SELECT 1 FROM categories WHERE id = ? AND builtin = 1', [id])).length) throw new Error('Categoria padrão não pode ser apagada')
  if (moveTo) {
    for (const table of ['category_overrides', 'category_rules', 'budget_lines']) await db.execute(`UPDATE ${table} SET category_id = ? WHERE category_id = ?`, [moveTo, id])
  }
  await db.execute('DELETE FROM categories WHERE id = ?', [id])
}


export async function dismissRuleSuggestion(db: Db, pattern: string): Promise<void> {
  const [row] = await db.select<{ value: string }>('SELECT value FROM meta WHERE key = ?', [SUGGESTIONS_KEY])
  const list = row ? JSON.parse(row.value) as string[] : []
  if (!list.includes(pattern)) await db.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [SUGGESTIONS_KEY, JSON.stringify([...list, pattern])])
}

export async function saveRule(db: Db, pattern: string, categoryId: string): Promise<void> {
  await db.execute(
    'INSERT INTO category_rules (id, pattern, category_id) VALUES (?, ?, ?) ON CONFLICT (pattern) DO UPDATE SET category_id = excluded.category_id',
    [crypto.randomUUID(), pattern, categoryId],
  )
}

export async function deleteRule(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM category_rules WHERE id = ?', [id])
}

export async function setOverride(db: Db, fingerprint: string, categoryId: string | null): Promise<void> {
  if (categoryId === null) await db.execute('DELETE FROM category_overrides WHERE fingerprint = ?', [fingerprint])
  else await db.execute('INSERT OR REPLACE INTO category_overrides (fingerprint, category_id) VALUES (?, ?)', [fingerprint, categoryId])
}

export async function dismissSubscription(db: Db, merchantKey: string): Promise<void> {
  await db.execute('INSERT OR IGNORE INTO subscription_dismissals (merchant_key) VALUES (?)', [merchantKey])
}

export async function savePluggyItem(db: Db, itemId: string, label: string): Promise<void> {
  await db.execute('INSERT OR REPLACE INTO pluggy_items (item_id, label) VALUES (?, ?)', [itemId, label])
}

export async function deletePluggyItem(db: Db, itemId: string): Promise<void> {
  await db.execute('DELETE FROM pluggy_items WHERE item_id = ?', [itemId])
}
