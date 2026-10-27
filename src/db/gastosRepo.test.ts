import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test } from 'vitest'
import { createTestDb, tmpPath, type Db } from './testDb'
import {
  deleteAccount, deleteCategory, deletePluggyItem, deleteRule, dismissRuleSuggestion, dismissSubscription, insertTxns, loadGastos,
  replaceWindow, saveCategory, savePluggyItem, saveRule, setLastSync, setOverride, updateCategory, upsertAccount,
  saveOwnerNames,
} from './gastosRepo'
import { loadOrcamento, saveLine } from './orcamentoRepo'

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
    await expect(deleteCategory(db, 'lazer', null)).rejects.toThrow('Categoria padrão não pode ser apagada')
    const id = await saveCategory(db, 'Pets', true)
    await saveRule(db, 'petz', id)
    await setOverride(db, 'fp-z', id)
    await deleteCategory(db, id, null)
    const d = await loadGastos(db)
    expect(d.categories.find(c => c.id === id)).toBeUndefined()
    expect(d.rules).toHaveLength(0)
    expect(d.overrides).toEqual({})
  })
  test('updateCategory grava nome, ícone e cor; conta como gasto só muda nas do usuário', async () => {
    await updateCategory(db, 'lazer', { name: 'Diversão', icon: 'gamepad-2', color: '#ff8fd0', countsAsSpending: false })
    const id = await saveCategory(db, 'Pets', true, { icon: 'paw-print', color: '#f5d76e' })
    await updateCategory(db, id, { name: 'Animais', icon: 'paw-print', color: '#6fdc8c', countsAsSpending: false })
    const { categories } = await loadGastos(db)
    expect(categories.find(c => c.id === 'lazer')).toMatchObject({ name: 'Diversão', icon: 'gamepad-2', color: '#ff8fd0', countsAsSpending: true })
    expect(categories.find(c => c.id === id)).toMatchObject({ name: 'Animais', icon: 'paw-print', color: '#6fdc8c', countsAsSpending: false })
    expect(categories.find(c => c.id === 'mercado')).toMatchObject({ icon: null, color: null })
  })
  const linhaPets = (categoryId: string) => saveLine(db, { month: '2026-10', kind: 'saida', name: 'Ração', amountCents: 9000, recurring: false, position: 0, categoryId, installmentCurrent: null, installmentTotal: null, sourceId: null, sourceKey: null })
  test('deleteCategory move compras, regras e orçamento para outra categoria', async () => {
    const pets = await saveCategory(db, 'Pets', true)
    await saveRule(db, 'petz', pets); await saveRule(db, 'racao', 'outros')
    await setOverride(db, 'fp-1', pets)
    await linhaPets(pets)
    await deleteCategory(db, pets, 'outros')
    const d = await loadGastos(db)
    expect(d.overrides).toEqual({ 'fp-1': 'outros' })
    expect(d.rules.map(r => [r.pattern, r.categoryId])).toEqual([['petz', 'outros'], ['racao', 'outros']])
    expect((await loadOrcamento(db)).lines.map(l => l.categoryId)).toEqual(['outros'])
  })
  test('deleteCategory sem destino tira as escolhas e deixa a linha do orçamento sem categoria', async () => {
    const pets = await saveCategory(db, 'Pets', true)
    await saveRule(db, 'petz', pets); await setOverride(db, 'fp-1', pets)
    await linhaPets(pets)
    await deleteCategory(db, pets, null)
    const d = await loadGastos(db)
    expect([d.overrides, d.rules]).toEqual([{}, []])
    expect((await loadOrcamento(db)).lines.map(l => [l.name, l.categoryId])).toEqual([['Ração', null]])
  })
  test('recusa de sugestão de regra vai para o meta sem repetir', async () => {
    expect((await loadGastos(db)).ruleSuggestionsDismissed).toEqual([])
    await dismissRuleSuggestion(db, 'padaria sol'); await dismissRuleSuggestion(db, 'padaria sol')
    expect((await loadGastos(db)).ruleSuggestionsDismissed).toEqual(['padaria sol'])
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
    expect((await migrado.select<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'"))[0].value).toBe('6')
    expect((await loadGastos(migrado)).categories).toHaveLength(17)
  })
})

test('nome do titular vai para o meta e volta no loadGastos', async () => {
  expect((await loadGastos(db)).ownerNames).toEqual([])
  await saveOwnerNames(db, ['Ana Teste', 'ANA T S'])
  await saveOwnerNames(db, ['Ana Teste'])
  expect((await loadGastos(db)).ownerNames).toEqual(['Ana Teste'])
})

test('migração 005: categoria da Pluggy é gravada e lida', async () => {
  const id = await upsertAccount(db, { source: 'pluggy', externalId: 'pluggy:a', institution: 'Banco', name: 'Conta', kind: 'conta', number: null, itemId: 'it', lastSyncAt: null })
  await replaceWindow(db, id, '2026-01-01', [{ date: '2026-10-01', description: 'Mercado', amountCents: -100, pending: false, installment: null, operationType: null, fingerprint: 'f', sourceKey: 's', pluggyCategory: 'Groceries' }])
  expect((await loadGastos(db)).txns[0].pluggyCategory).toBe('Groceries')
})
