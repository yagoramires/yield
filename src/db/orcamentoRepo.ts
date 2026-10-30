import type { Cents, Month } from '../domain/types'
import type { Db } from './client'

export type LineKind = 'entrada' | 'saida'
// bloco da saída; parcela é a saída com n/total, qualquer que seja o grupo
export type Grupo = 'fixo' | 'variavel' | 'meta'
export interface BudgetLine { id: string; month: Month; kind: LineKind; name: string; amountCents: Cents; recurring: boolean; position: number; categoryId: string | null; installmentCurrent: number | null; installmentTotal: number | null; sourceId: string | null; sourceKey: string | null; grupo: Grupo | null /* só saída */ }
// irpjPct: imposto sobre o faturamento (DAS do Simples ou IRPJ); dasCents: DAS fixo do MEI
export interface PjConfig { proLaborePct: number; irpjPct: number; inssPct: number /* sobre o pró-labore */; contabilidadeCents: Cents; outrosCents: Cents; dasCents: Cents }
export const DEFAULT_PJ: PjConfig = { proLaborePct: 28, irpjPct: 6, inssPct: 11, contabilidadeCents: 0, outrosCents: 0, dasCents: 0 }
export type SourceKind = 'pj' | 'mei' | 'clt' | 'fixo'
export interface IncomeSource extends PjConfig { id: string; name: string; kind: SourceKind; grossCents: Cents | null /* pj e clt */; netCents: Cents | null /* fixo */; dependents: number /* clt, para o IRRF */; sourceKey: string | null }
// meta vale do mês dela em diante; amountCents null desliga a meta dali para frente
export interface Goal { month: Month; key: string /* 'investir', 'variaveis' ou 'cat:<categoria>' */; amountCents: Cents | null }
export interface OrcamentoData { months: Month[]; lines: BudgetLine[]; dismissed: { month: Month; key: string }[]; sources: IncomeSource[]; goals: Goal[]; fixedCategories: string[] }

// categorias de gasto que contam como custo fixo no orçamento; as outras (e as que o usuário cria) são variáveis
export const FIXAS_PADRAO = ['moradia', 'contas', 'saude', 'educacao', 'impostos-e-taxas', 'assinaturas']

export async function loadOrcamento(db: Db): Promise<OrcamentoData> {
  const [months, lines, dismissed, sources, goals, fixas] = await Promise.all([
    db.select<{ month: Month }>('SELECT month FROM budget_months ORDER BY month'),
    db.select<BudgetLine>(`SELECT id, month, kind, name, amount_cents AS amountCents, recurring, position, category_id AS categoryId,
      installment_current AS installmentCurrent, installment_total AS installmentTotal, source_id AS sourceId, source_key AS sourceKey, grupo
      FROM budget_lines ORDER BY month, position`),
    db.select<{ month: Month; key: string }>('SELECT month, key FROM budget_dismissals ORDER BY month, key'),
    db.select<IncomeSource>(`SELECT id, name, kind, gross_cents AS grossCents, pro_labore_pct AS proLaborePct, irpj_pct AS irpjPct, inss_pct AS inssPct,
      contabilidade_cents AS contabilidadeCents, outros_cents AS outrosCents, das_cents AS dasCents, net_cents AS netCents, source_key AS sourceKey, dependents FROM income_sources ORDER BY name`),
    db.select<Goal>('SELECT month, key, amount_cents AS amountCents FROM budget_goals ORDER BY month, key'),
    db.select<{ value: string }>("SELECT value FROM meta WHERE key = 'orcamento.fixas'"),
  ])
  return { months: months.map(m => m.month), lines: lines.map(l => ({ ...l, recurring: !!l.recurring })), dismissed, sources, goals, fixedCategories: fixas.length ? JSON.parse(fixas[0].value) as string[] : FIXAS_PADRAO }
}

const insertLine = (db: Db, id: string, l: Omit<BudgetLine, 'id'>) => db.execute(
  `INSERT INTO budget_lines (id, month, kind, name, amount_cents, recurring, position, category_id, installment_current, installment_total, source_id, source_key, grupo)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, l.month, l.kind, l.name, l.amountCents, l.recurring ? 1 : 0, l.position, l.categoryId, l.installmentCurrent, l.installmentTotal, l.sourceId, l.sourceKey, l.kind === 'saida' ? l.grupo ?? 'fixo' : null],
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
      `UPDATE budget_lines SET kind = ?, name = ?, amount_cents = ?, recurring = ?, position = ?, category_id = ?, installment_current = ?, installment_total = ?, source_id = ?, source_key = ?, grupo = ? WHERE id = ?`,
      [line.kind, line.name, line.amountCents, line.recurring ? 1 : 0, line.position, line.categoryId, line.installmentCurrent, line.installmentTotal, line.sourceId, line.sourceKey, line.kind === 'saida' ? line.grupo ?? 'fixo' : null, line.id],
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

export async function saveFixedCategories(db: Db, ids: string[]): Promise<void> {
  await db.execute("INSERT INTO meta (key, value) VALUES ('orcamento.fixas', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [JSON.stringify(ids)])
}

/** Grava as mudanças de meta valendo a partir de `month`; os meses anteriores continuam com o que tinham. */
export async function saveGoals(db: Db, month: Month, changes: { key: string; amountCents: Cents | null }[]): Promise<void> {
  for (const c of changes) await db.execute('INSERT OR REPLACE INTO budget_goals (month, key, amount_cents) VALUES (?, ?, ?)', [month, c.key, c.amountCents])
}

export async function dismissSuggestion(db: Db, month: Month, key: string): Promise<void> {
  await db.execute('INSERT OR IGNORE INTO budget_dismissals (month, key) VALUES (?, ?)', [month, key])
}

export async function saveSource(db: Db, s: Omit<IncomeSource, 'id'> & { id?: string }): Promise<string> {
  const f = [s.name, s.kind, s.grossCents, s.proLaborePct, s.irpjPct, s.inssPct, s.contabilidadeCents, s.outrosCents, s.netCents, s.dependents, s.dasCents]
  if (s.id) {
    await db.execute('UPDATE income_sources SET name = ?, kind = ?, gross_cents = ?, pro_labore_pct = ?, irpj_pct = ?, inss_pct = ?, contabilidade_cents = ?, outros_cents = ?, net_cents = ?, dependents = ?, das_cents = ? WHERE id = ?', [...f, s.id])
    return s.id
  }
  const id = crypto.randomUUID()
  await db.execute('INSERT INTO income_sources (name, kind, gross_cents, pro_labore_pct, irpj_pct, inss_pct, contabilidade_cents, outros_cents, net_cents, dependents, das_cents, source_key, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [...f, s.sourceKey, id])
  return id
}

// As linhas ligadas ficam com o último valor (FK ON DELETE SET NULL).
export async function deleteSource(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM income_sources WHERE id = ?', [id])
}

export async function applySource(db: Db, sourceId: string, fromMonth: Month, amountCents: Cents): Promise<number> {
  return (await db.execute('UPDATE budget_lines SET amount_cents = ? WHERE source_id = ? AND month >= ?', [amountCents, sourceId, fromMonth])).rowsAffected
}
