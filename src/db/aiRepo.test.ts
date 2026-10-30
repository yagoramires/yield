import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, expect, test } from 'vitest'
import { getInsights, saveInsights } from './aiRepo'
import { createTestDb, type Db } from './testDb'

let db: Db
beforeEach(() => { db = createTestDb() })

const salvo = (texto: string) => ({ month: '2026-10', factsHash: 'h1', model: 'qwen3-8b', insights: [{ factIds: ['gasto_mes'], titulo: 'Mês', texto }], createdAt: '2026-10-30T12:00:00Z' })

test('guarda os insights do mês e salvar de novo substitui', async () => {
  expect(await getInsights(db, '2026-10')).toBeNull()
  await saveInsights(db, salvo('primeiro'))
  await saveInsights(db, { ...salvo('segundo'), factsHash: 'h2' })
  expect(await getInsights(db, '2026-10')).toEqual({ ...salvo('segundo'), factsHash: 'h2' })
  expect(await getInsights(db, '2026-09')).toBeNull()
})

test('a migração 017 só muda a versão do esquema no meta', () => {
  const dir = new URL('../../src-tauri/migrations/', import.meta.url)
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  const d = new DatabaseSync(':memory:')
  files.filter(f => f < '017').forEach(f => d.exec(readFileSync(new URL(f, dir), 'utf8')))
  d.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('orcamento.fixas', '[\"x\"]')")
  d.exec(readFileSync(new URL('017_ai_insights.sql', dir), 'utf8'))
  expect(d.prepare("SELECT key, value FROM meta WHERE key IN ('orcamento.fixas', 'schema_version') ORDER BY key").all()).toEqual([
    { key: 'orcamento.fixas', value: '["x"]' }, { key: 'schema_version', value: '17' },
  ])
})
