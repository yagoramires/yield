import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test } from 'vitest'
import { createTestDb, tmpPath, type Db } from './testDb'
import { DEFAULT_PJ, createMonth, deleteLine, dismissSuggestion, loadOrcamento, saveLine, savePjConfig } from './orcamentoRepo'

let db: Db
beforeEach(() => { db = createTestDb() })

const linha = (name: string, extra = {}) => ({ kind: 'saida' as const, name, amountCents: 1000, recurring: true, position: 0, categoryId: null, installmentCurrent: null, installmentTotal: null, pjGrossCents: null, sourceKey: null, ...extra })

describe('meses', () => {
  test('createMonth grava mês e linhas; repetir devolve ja-existe sem duplicar', async () => {
    expect(await createMonth(db, '2026-03', [linha('A', { position: 0 }), linha('B', { position: 1 })])).toBe('criado')
    expect(await createMonth(db, '2026-03', [linha('C')])).toBe('ja-existe')
    const d = await loadOrcamento(db)
    expect(d.months).toEqual(['2026-03'])
    expect(d.lines.map(l => l.name)).toEqual(['A', 'B'])
    expect(d.lines[0]).toMatchObject({ month: '2026-03', recurring: true, categoryId: null })
  })
  test('createMonth com linha inválida não deixa mês pela metade', async () => {
    await expect(createMonth(db, '2026-03', [linha('A', { sourceKey: 'k' }), linha('B', { sourceKey: 'k' })])).rejects.toThrow()
    expect((await loadOrcamento(db)).months).toEqual([])
  })
  test('meses em ordem crescente', async () => {
    await createMonth(db, '2026-05', []); await createMonth(db, '2026-04', [])
    expect((await loadOrcamento(db)).months).toEqual(['2026-04', '2026-05'])
  })
})

describe('linhas', () => {
  test('saveLine sem id vai para o fim do mês, com id atualiza', async () => {
    await createMonth(db, '2026-03', [linha('A')])
    const id = await saveLine(db, { ...linha('B'), month: '2026-03', position: 99 })
    await saveLine(db, { ...linha('B2', { amountCents: 5, recurring: false, position: 1 }), month: '2026-03', id })
    const { lines } = await loadOrcamento(db)
    expect(lines.map(l => [l.name, l.position])).toEqual([['A', 0], ['B2', 1]])
    expect(lines[1]).toMatchObject({ amountCents: 5, recurring: false })
  })
  test('saveLine em mês inexistente cria o mês', async () => {
    await saveLine(db, { ...linha('A'), month: '2026-07' })
    expect((await loadOrcamento(db)).months).toEqual(['2026-07'])
  })
  test('deleteLine remove', async () => {
    const id = await saveLine(db, { ...linha('A'), month: '2026-07' })
    await deleteLine(db, id)
    expect((await loadOrcamento(db)).lines).toEqual([])
  })
  test('apagar categoria deixa categoryId nulo', async () => {
    await saveLine(db, { ...linha('A', { categoryId: 'mercado' }), month: '2026-07' })
    await db.execute("DELETE FROM categories WHERE id = 'mercado'")
    expect((await loadOrcamento(db)).lines[0].categoryId).toBeNull()
  })
  test('source_key repetido é recusado', async () => {
    await saveLine(db, { ...linha('A', { sourceKey: 'x' }), month: '2026-07' })
    await expect(saveLine(db, { ...linha('B', { sourceKey: 'x' }), month: '2026-07' })).rejects.toThrow()
  })
})

describe('config e dispensas', () => {
  test('pj padrão, salvo e mesclado; JSON inválido volta ao padrão', async () => {
    expect((await loadOrcamento(db)).pj).toEqual(DEFAULT_PJ)
    await savePjConfig(db, { ...DEFAULT_PJ, irpjPct: 9 })
    expect((await loadOrcamento(db)).pj).toEqual({ ...DEFAULT_PJ, irpjPct: 9 })
    await db.execute("UPDATE meta SET value = '{x' WHERE key = 'orcamento.pj'")
    expect((await loadOrcamento(db)).pj).toEqual(DEFAULT_PJ)
  })
  test('dismissSuggestion é idempotente', async () => {
    await dismissSuggestion(db, '2026-03', 'k'); await dismissSuggestion(db, '2026-03', 'k')
    expect((await loadOrcamento(db)).dismissed).toEqual([{ month: '2026-03', key: 'k' }])
  })
})

describe('migração', () => {
  test('banco v2 recebe a 003 no createTestDb', async () => {
    const path = tmpPath('v2.db')
    const d = new DatabaseSync(path)
    for (const f of ['001_init.sql', '002_gastos.sql']) d.exec(readFileSync(new URL(`../../src-tauri/migrations/${f}`, import.meta.url), 'utf8'))
    d.close()
    const migrado = createTestDb(path)
    expect((await migrado.select<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'"))[0].value).toBe('3')
    expect((await loadOrcamento(migrado)).months).toEqual([])
  })
})
