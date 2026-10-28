import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test } from 'vitest'
import { createTestDb, tmpPath, type Db } from './testDb'
import { DEFAULT_PJ, applySource, createMonth, deleteLine, deleteSource, dismissSuggestion, loadOrcamento, saveLine, saveSource } from './orcamentoRepo'

let db: Db
beforeEach(() => { db = createTestDb() })

const linha = (name: string, extra = {}) => ({ kind: 'saida' as const, name, amountCents: 1000, recurring: true, position: 0, categoryId: null, installmentCurrent: null, installmentTotal: null, sourceId: null, sourceKey: null, ...extra })
const fonte = (name: string, extra = {}) => ({ name, kind: 'pj' as const, grossCents: 1_000_000, ...DEFAULT_PJ, netCents: null, dependents: 0, sourceKey: null, ...extra })

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
  test('a mesma assinatura aceita em dois meses não colide (chave por mês)', async () => {
    await saveLine(db, { month: '2026-10', ...linha('Streaming', { sourceKey: 'sub:c1|streaming@2026-10' }) })
    await saveLine(db, { month: '2026-11', ...linha('Streaming', { sourceKey: 'sub:c1|streaming@2026-11' }) })
    expect((await loadOrcamento(db)).lines.map(l => l.sourceKey)).toEqual(['sub:c1|streaming@2026-10', 'sub:c1|streaming@2026-11'])
  })
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
  test('fontes: salva, edita (sem mudar sourceKey), ordena por nome', async () => {
    expect((await loadOrcamento(db)).sources).toEqual([])
    const b = await saveSource(db, fonte('Bravo', { sourceKey: 'k' }))
    const a = await saveSource(db, fonte('Alfa', { kind: 'fixo', grossCents: null, netCents: 500_000 }))
    await saveSource(db, { ...fonte('Bravo 2', { sourceKey: 'outra' }), id: b })
    const { sources } = await loadOrcamento(db)
    expect(sources.map(s => [s.id, s.name, s.kind, s.netCents, s.sourceKey])).toEqual([[a, 'Alfa', 'fixo', 500_000, null], [b, 'Bravo 2', 'pj', null, 'k']])
    expect(sources[1]).toMatchObject({ grossCents: 1_000_000, ...DEFAULT_PJ })
  })
  test('apagar fonte deixa a linha com sourceId nulo e valor intacto', async () => {
    const s = await saveSource(db, fonte('F'))
    await saveLine(db, { ...linha('Renda', { sourceId: s, amountCents: 777 }), month: '2026-07' })
    expect((await loadOrcamento(db)).lines[0].sourceId).toBe(s)
    await deleteSource(db, s)
    const o = await loadOrcamento(db)
    expect(o.sources).toEqual([])
    expect(o.lines[0]).toMatchObject({ sourceId: null, amountCents: 777 })
  })
  test('applySource muda só meses >= fromMonth e só linhas da fonte', async () => {
    const s = await saveSource(db, fonte('F'))
    for (const m of ['2026-05', '2026-06', '2026-07']) await saveLine(db, { ...linha('R', { sourceId: s }), month: m })
    await saveLine(db, { ...linha('Outra'), month: '2026-07' })
    expect(await applySource(db, s, '2026-06', 4242)).toBe(2)
    expect((await loadOrcamento(db)).lines.map(l => [l.month, l.name, l.amountCents])).toEqual([['2026-05', 'R', 1000], ['2026-06', 'R', 4242], ['2026-07', 'R', 4242], ['2026-07', 'Outra', 1000]])
  })
  test('dismissSuggestion é idempotente', async () => {
    await dismissSuggestion(db, '2026-03', 'k'); await dismissSuggestion(db, '2026-03', 'k')
    expect((await loadOrcamento(db)).dismissed).toEqual([{ month: '2026-03', key: 'k' }])
  })
})

describe('migração', () => {
  test('banco v6 recebe a 007: aceita CLT e as linhas continuam ligadas às fontes', async () => {
    const path = tmpPath('v6.db')
    const d = new DatabaseSync(path)
    for (const f of ['001_init.sql', '002_gastos.sql', '003_orcamento.sql', '004_fontes_renda.sql', '005_categoria_pluggy.sql', '006_categoria_visual.sql']) d.exec(readFileSync(new URL(`../../src-tauri/migrations/${f}`, import.meta.url), 'utf8'))
    d.exec(`INSERT INTO income_sources (id, name, kind, gross_cents, pro_labore_pct, irpj_pct, inss_pct, contabilidade_cents, outros_cents, net_cents, source_key)
      VALUES ('s1', 'Empresa Exemplo', 'pj', 1000000, 28, 6, 11, 0, 0, NULL, NULL);
      INSERT INTO budget_months VALUES ('2026-01');
      INSERT INTO budget_lines (id, month, kind, name, amount_cents, recurring, position, source_id) VALUES ('l1', '2026-01', 'entrada', 'Salário', 900000, 1, 0, 's1')`)
    d.close()
    const migrado = createTestDb(path)
    const o = await loadOrcamento(migrado)
    expect(o.lines[0].sourceId).toBe('s1')
    expect(o.sources[0]).toMatchObject({ id: 's1', kind: 'pj', grossCents: 1000000, dependents: 0 })
    const id = await saveSource(migrado, { name: 'Emprego', kind: 'clt', grossCents: 500000, netCents: null, dependents: 1, sourceKey: null, ...DEFAULT_PJ })
    expect((await loadOrcamento(migrado)).sources.find(x => x.id === id)).toMatchObject({ kind: 'clt', dependents: 1 })
  })
  test('banco v3 recebe a 004 e leva a pj_gross_cents embora', async () => {
    const path = tmpPath('v3.db')
    const d = new DatabaseSync(path)
    for (const f of ['001_init.sql', '002_gastos.sql', '003_orcamento.sql']) d.exec(readFileSync(new URL(`../../src-tauri/migrations/${f}`, import.meta.url), 'utf8'))
    d.exec("INSERT INTO meta (key, value) VALUES ('orcamento.pj', '{}'); INSERT INTO budget_months VALUES ('2026-01'); INSERT INTO budget_lines (id, month, kind, name, amount_cents, recurring, position, pj_gross_cents) VALUES ('l', '2026-01', 'entrada', 'R', 99, 1, 0, 5)")
    d.close()
    const migrado = createTestDb(path)
    expect((await migrado.select<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'"))[0].value).toBe('9')
    expect(await migrado.select("SELECT 1 FROM meta WHERE key = 'orcamento.pj'")).toEqual([])
    expect((await loadOrcamento(migrado)).lines[0]).toMatchObject({ amountCents: 99, sourceId: null })
  })
  test('banco v2 recebe a 003 e a 004 no createTestDb', async () => {
    const path = tmpPath('v2.db')
    const d = new DatabaseSync(path)
    for (const f of ['001_init.sql', '002_gastos.sql']) d.exec(readFileSync(new URL(`../../src-tauri/migrations/${f}`, import.meta.url), 'utf8'))
    d.close()
    const migrado = createTestDb(path)
    expect((await migrado.select<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'"))[0].value).toBe('9')
    expect((await loadOrcamento(migrado)).months).toEqual([])
  })
})
