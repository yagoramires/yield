import type { Cents, Month } from '../domain/types'
import type { Db } from './client'

export type LineKind = 'entrada' | 'saida'
export interface BudgetLine { id: string; month: Month; kind: LineKind; name: string; amountCents: Cents; recurring: boolean; position: number; categoryId: string | null; installmentCurrent: number | null; installmentTotal: number | null; pjGrossCents: Cents | null; sourceKey: string | null }
export interface PjConfig { proLaborePct: number; irpjPct: number; inssPct: number /* sobre o pró-labore */; contabilidadeCents: Cents; outrosCents: Cents }
export const DEFAULT_PJ: PjConfig = { proLaborePct: 28, irpjPct: 6, inssPct: 11, contabilidadeCents: 0, outrosCents: 0 }
export interface OrcamentoData { months: Month[]; lines: BudgetLine[]; dismissed: { month: Month; key: string }[]; pj: PjConfig }

const PJ_KEY = 'orcamento.pj'

export async function loadOrcamento(db: Db): Promise<OrcamentoData> {
  const [months, lines, dismissed, pj] = await Promise.all([
    db.select<{ month: Month }>('SELECT month FROM budget_months ORDER BY month'),
    db.select<BudgetLine>(`SELECT id, month, kind, name, amount_cents AS amountCents, recurring, position, category_id AS categoryId,
      installment_current AS installmentCurrent, installment_total AS installmentTotal, pj_gross_cents AS pjGrossCents, source_key AS sourceKey
      FROM budget_lines ORDER BY month, position`),
    db.select<{ month: Month; key: string }>('SELECT month, key FROM budget_dismissals ORDER BY month, key'),
    db.select<{ value: string }>('SELECT value FROM meta WHERE key = ?', [PJ_KEY]),
  ])
  let saved: Partial<PjConfig> = {}
  try { saved = pj[0] ? JSON.parse(pj[0].value) ?? {} : {} } catch { /* config corrompida: volta ao padrão */ }
  return { months: months.map(m => m.month), lines: lines.map(l => ({ ...l, recurring: !!l.recurring })), dismissed, pj: { ...DEFAULT_PJ, ...saved } }
}

const insertLine = (db: Db, id: string, l: Omit<BudgetLine, 'id'>) => db.execute(
  `INSERT INTO budget_lines (id, month, kind, name, amount_cents, recurring, position, category_id, installment_current, installment_total, pj_gross_cents, source_key)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, l.month, l.kind, l.name, l.amountCents, l.recurring ? 1 : 0, l.position, l.categoryId, l.installmentCurrent, l.installmentTotal, l.pjGrossCents, l.sourceKey],
)

export async function createMonth(db: Db, month: Month, lines: Omit<BudgetLine, 'id' | 'month'>[]): Promise<'criado' | 'ja-existe'> {
  const r = await db.execute('INSERT OR IGNORE INTO budget_months (month) VALUES (?)', [month])
  if (!r.rowsAffected) return 'ja-existe'
  try {
    for (const l of lines) await insertLine(db, crypto.randomUUID(), { ...l, month })
  } catch (e) {
    await db.execute('DELETE FROM budget_months WHERE month = ?', [month])
    throw e
  }
  return 'criado'
}

export async function saveLine(db: Db, line: Omit<BudgetLine, 'id'> & { id?: string }): Promise<string> {
  if (line.id) {
    await db.execute(
      `UPDATE budget_lines SET kind = ?, name = ?, amount_cents = ?, recurring = ?, position = ?, category_id = ?, installment_current = ?, installment_total = ?, pj_gross_cents = ?, source_key = ? WHERE id = ?`,
      [line.kind, line.name, line.amountCents, line.recurring ? 1 : 0, line.position, line.categoryId, line.installmentCurrent, line.installmentTotal, line.pjGrossCents, line.sourceKey, line.id],
    )
    return line.id
  }
  await db.execute('INSERT OR IGNORE INTO budget_months (month) VALUES (?)', [line.month])
  const [{ next }] = await db.select<{ next: number }>('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM budget_lines WHERE month = ?', [line.month])
  const id = crypto.randomUUID()
  await insertLine(db, id, { ...line, position: next })
  return id
}

export async function deleteLine(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM budget_lines WHERE id = ?', [id])
}

export async function dismissSuggestion(db: Db, month: Month, key: string): Promise<void> {
  await db.execute('INSERT OR IGNORE INTO budget_dismissals (month, key) VALUES (?, ?)', [month, key])
}

export async function savePjConfig(db: Db, cfg: PjConfig): Promise<void> {
  await db.execute('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [PJ_KEY, JSON.stringify(cfg)])
}
