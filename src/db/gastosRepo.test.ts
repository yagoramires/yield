import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test } from 'vitest'
import { createTestDb, tmpPath, type Db } from './testDb'
import {
  deleteAccount, deleteCategory, deletePluggyItem, deleteRule, dismissSubscription, insertTxns, loadGastos, renameCategory,
  replaceWindow, saveCategory, savePluggyItem, saveRule, setLastSync, setOverride, upsertAccount,
} from './gastosRepo'

let db: Db
beforeEach(() => { db = createTestDb() })

const conta = { source: 'arquivo' as const, externalId: 'ext-1', institution: 'Banco X', name: 'Corrente', kind: 'conta' as const, number: '123', itemId: null, lastSyncAt: null }
const tx = (key: string, date: string, extra = {}) => ({ date, description: `Loja ${key}`, amountCents: -1000, pending: false, installment: null, operationType: null, fingerprint: `fp-${key}`, sourceKey: key, ...extra })

describe('contas e transações', () => {
  test('upsertAccount mantém o id, atualiza campos e preserva last_sync_at', async () => {
    const id = await upsertAccount(db, conta)
    await setLastSync(db, id, '2026-01-01T00:00:00Z')
    const id2 = await upsertAccount(db, { ...conta, name: 'Nova', lastSyncAt: null })
    expect(id2).toBe(id)
    const [a] = (await loadGastos(db)).accounts
    expect(a).toMatchObject({ name: 'Nova', lastSyncAt: '2026-01-01T00:00:00Z' })
  })
  test('replaceWindow troca só a janela e mantém o mais antigo', async () => {
    const id = await upsertAccount(db, conta)
    await insertTxns(db, id, [tx('a', '2026-01-05'), tx('b', '2026-02-10'), tx('c', '2026-02-20')])
    const r = await replaceWindow(db, id, '2026-02-01', [tx('d', '2026-02-15', { pending: true })])
    expect(r).toEqual({ inserted: 1, removed: 2 })
    const { txns } = await loadGastos(db)
    expect(txns.map(t => t.sourceKey).sort()).toEqual(['a', 'd'])
    expect(txns.find(t => t.sourceKey === 'd')!.pending).toBe(true)
  })
  test('replaceWindow conta como novo só o sourceKey que não existia e como removido só o que não voltou', async () => {
    const id = await upsertAccount(db, conta)
    const janela = [tx('a', '2026-02-10'), tx('b', '2026-02-20')]
    expect(await replaceWindow(db, id, '2026-02-01', janela)).toEqual({ inserted: 2, removed: 0 })
    expect(await replaceWindow(db, id, '2026-02-01', janela)).toEqual({ inserted: 0, removed: 0 })
    expect(await replaceWindow(db, id, '2026-02-01', [tx('b', '2026-02-20'), tx('c', '2026-02-25')])).toEqual({ inserted: 1, removed: 1 })
  })
  test('replaceWindow remove também a linha cujo sourceKey volta com data anterior a from', async () => {
    const id = await upsertAccount(db, conta)
    await insertTxns(db, id, [tx('a', '2026-02-01')])
    await replaceWindow(db, id, '2026-02-02', [tx('a', '2026-01-31')]) // virou fuso
    const { txns } = await loadGastos(db)
    expect(txns).toHaveLength(1)
    expect(txns[0].date).toBe('2026-01-31')
  })
  test('replaceWindow com insert inválido no meio não perde a janela antiga', async () => {
    const id = await upsertAccount(db, conta)
    await insertTxns(db, id, [tx('a', '2026-02-10'), tx('b', '2026-02-20')])
    const ruim = [tx('x', '2026-02-12'), tx('x', '2026-02-13')] // sourceKey repetido
    await expect(replaceWindow(db, id, '2026-02-01', ruim)).rejects.toThrow()
    expect((await loadGastos(db)).txns.map(t => t.sourceKey).sort()).toEqual(['a', 'b'])
  })
  test('insertTxns pula sourceKey repetido', async () => {
    const id = await upsertAccount(db, conta)
    expect(await insertTxns(db, id, [tx('a', '2026-02-10'), tx('b', '2026-02-11')])).toEqual({ inserted: 2, skipped: 0 })
    expect(await insertTxns(db, id, [tx('b', '2026-02-11'), tx('c', '2026-02-12'), tx('c', '2026-02-12')])).toEqual({ inserted: 1, skipped: 2 })
  })
  test('apagar conta apaga as transações', async () => {
    const id = await upsertAccount(db, conta)
    await insertTxns(db, id, [tx('a', '2026-02-10')])
    await deleteAccount(db, id)
    const d = await loadGastos(db)
    expect(d.accounts).toHaveLength(0)
    expect(d.txns).toHaveLength(0)
  })
  test('ajuste por fingerprint sobrevive a replaceWindow', async () => {
    const id = await upsertAccount(db, conta)
    await insertTxns(db, id, [tx('a', '2026-02-10')])
    await setOverride(db, 'fp-a', 'lazer')
    await replaceWindow(db, id, '2026-02-01', [tx('a', '2026-02-10')])
    expect((await loadGastos(db)).overrides).toEqual({ 'fp-a': 'lazer' })
    await setOverride(db, 'fp-a', null)
    expect((await loadGastos(db)).overrides).toEqual({})
  })
})

describe('categorias, regras e demais tabelas', () => {
  test('categorias padrão semeadas', async () => {
    const { categories } = await loadGastos(db)
    expect(categories).toHaveLength(17)
    expect(categories.filter(c => !c.countsAsSpending).map(c => c.name).sort()).toEqual(['Investimento', 'Pagamento de fatura', 'Receita', 'Transferência'])
    expect(categories.every(c => c.builtin)).toBe(true)
  })
  test('deleteCategory de builtin lança; custom remove regras e ajustes', async () => {
    await expect(deleteCategory(db, 'lazer')).rejects.toThrow('Categoria padrão não pode ser apagada')
    const id = await saveCategory(db, 'Pets', true)
    await renameCategory(db, id, 'Animais')
    await saveRule(db, 'petz', id)
    await setOverride(db, 'fp-z', id)
    await deleteCategory(db, id)
    const d = await loadGastos(db)
    expect(d.categories.find(c => c.id === id)).toBeUndefined()
    expect(d.rules).toHaveLength(0)
    expect(d.overrides).toEqual({})
  })
  test('regra repetida substitui a categoria; deleteRule', async () => {
    await saveRule(db, 'uber', 'transporte')
    await saveRule(db, 'uber', 'viagem')
    const { rules } = await loadGastos(db)
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ pattern: 'uber', categoryId: 'viagem' })
    await deleteRule(db, rules[0].id)
    expect((await loadGastos(db)).rules).toHaveLength(0)
  })
  test('assinaturas dispensadas e itens da Pluggy', async () => {
    await dismissSubscription(db, 'netflix'); await dismissSubscription(db, 'netflix')
    await savePluggyItem(db, 'it1', 'Meu banco'); await savePluggyItem(db, 'it1', 'Outro')
    let d = await loadGastos(db)
    expect(d.dismissed).toEqual(['netflix'])
    expect(d.pluggyItems).toEqual([{ itemId: 'it1', label: 'Outro' }])
    await deletePluggyItem(db, 'it1')
    d = await loadGastos(db)
    expect(d.pluggyItems).toEqual([])
  })
})

describe('migração', () => {
  test('banco v1 recebe a 002 no createTestDb', async () => {
    const path = tmpPath('v1.db')
    const d = new DatabaseSync(path)
    d.exec(readFileSync(new URL('../../src-tauri/migrations/001_init.sql', import.meta.url), 'utf8'))
    d.close()
    const migrado = createTestDb(path)
    expect((await migrado.select<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'"))[0].value).toBe('3')
    expect((await loadGastos(migrado)).categories).toHaveLength(17)
  })
})
