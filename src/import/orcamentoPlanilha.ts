import { read, utils, type CellObject, type WorkSheet } from 'xlsx'
import type { Db } from '../db/client'
import { createMonth, saveLine, savePjConfig, type BudgetLine, type PjConfig } from '../db/orcamentoRepo'
import { normalizeDescription } from '../domain/gastos'
import type { Cents, Month } from '../domain/types'

type ImportLine = Omit<BudgetLine, 'id' | 'month' | 'position'>
export interface OrcamentoImport { months: { month: Month; lines: ImportLine[] }[]; pj: (PjConfig & { grossCents: Cents }) | null; warnings: string[] }

const SALDO_RE = /^\s*SUM\(\s*[A-Z]+(\d+)\s*:\s*[A-Z]+(\d+)\s*\)\s*-\s*SUM\(\s*[A-Z]+(\d+)\s*:\s*[A-Z]+(\d+)\s*\)\s*$/i
const PCT_RE = /^\s*([\d.]+)\s*\*\s*\$?([A-Z]+)\$?(\d+)\s*$/i
const cents = (v: number) => Math.round(v * 100)

export function parseOrcamentoPlanilha(data: ArrayBuffer): OrcamentoImport {
  const wb = read(data, { cellFormula: true, cellDates: true })
  const ws = wb.Sheets['Finanças']
  if (!ws) throw new Error('Aba "Finanças" não encontrada')
  const warnings: string[] = []
  const at = (c: number, r: number): CellObject | undefined => ws[utils.encode_cell({ c, r: r - 1 })]
  const label = (r: number) => String(at(0, r)?.v ?? '').trim()
  const range = utils.decode_range(ws['!ref'] ?? 'A1')
  const lastRow = range.e.r + 1

  // Colunas-mês: data na linha 2.
  const monthCols: { c: number; month: Month }[] = []
  for (let c = 1; c <= range.e.c; c++) {
    const v = at(c, 2)?.v
    if (v instanceof Date) monthCols.push({ c, month: v.toISOString().slice(0, 7) })
  }

  // A fórmula do Saldo diz quais linhas são entradas e quais são saídas.
  let rows: { kind: 'entrada' | 'saida'; row: number }[] | null = null
  for (let r = 1; r <= lastRow && !rows; r++) {
    if (normalizeDescription(label(r)) !== 'saldo') continue
    for (const { c } of monthCols) {
      const m = SALDO_RE.exec(String(at(c, r)?.f ?? ''))
      if (!m) continue
      const [a, b, x, y] = m.slice(1).map(Number)
      const range = (kind: 'entrada' | 'saida', from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ kind, row: from + i }))
      rows = [...range('entrada', a, b), ...range('saida', x, y)]
      break
    }
  }
  if (!rows) throw new Error('Linha "Saldo" não encontrada')

  const pj = parsePj(ws, warnings)
  const refRe = pj && new RegExp(`(?<![A-Z])\\$?${pj.netCol}\\$?${pj.netRow}(?!\\d)`, 'i')

  const months: OrcamentoImport['months'] = []
  const rowCount = new Map<number, number>()
  for (const { c, month } of monthCols) {
    const lines: (ImportLine & { row: number })[] = []
    for (const { kind, row } of rows) {
      const name = label(row)
      const cell = at(c, row)
      if (!name || !cell) continue
      if (cell.t !== 'n') {
        if (cell.f) warnings.push(`${month}, linha ${row}: fórmula sem valor calculado; linha ignorada`)
        continue
      }
      const v = cell.v as number
      if (v === 0) continue
      if (v < 0) { warnings.push(`${month}, linha ${row}: valor negativo; linha ignorada`); continue }
      const pjGrossCents = refRe && cell.f && refRe.test(cell.f) ? pj.grossCents : null
      lines.push({ row, kind, name, amountCents: cents(v), recurring: false, categoryId: null, installmentCurrent: null, installmentTotal: null, pjGrossCents, sourceKey: `planilha:${month}:${row}` })
      rowCount.set(row, (rowCount.get(row) ?? 0) + 1)
    }
    if (lines.length) months.push({ month, lines })
  }
  for (const m of months) m.lines = (m.lines as (ImportLine & { row: number })[]).map(({ row, ...l }) => ({ ...l, recurring: rowCount.get(row)! >= 2 }))
  return { months, pj: pj && { proLaborePct: pj.proLaborePct, irpjPct: pj.irpjPct, inssPct: pj.inssPct, contabilidadeCents: pj.contabilidadeCents, outrosCents: pj.outrosCents, grossCents: pj.grossCents }, warnings }
}

// Bloco PJ: acha o rótulo "Salário Líquido" e lê, na mesma coluna acima, as fórmulas dos demais itens.
function parsePj(ws: WorkSheet, warnings: string[]) {
  const miss = () => { warnings.push('Bloco PJ não encontrado ou incompleto; configure o PJ na aba Orçamento'); return null }
  for (const [ref, cell] of Object.entries(ws)) {
    if (ref[0] === '!' || normalizeDescription(String(cell.v ?? '')) !== 'salario liquido') continue
    const { c, r } = utils.decode_cell(ref)
    const cellAt = (col: number, row: number): CellObject | undefined => ws[utils.encode_cell({ c: col, r: row })]
    const find = (name: string) => {
      for (let i = r - 1; i >= 0; i--) if (normalizeDescription(String(cellAt(c, i)?.v ?? '')) === name) return cellAt(c + 1, i)
    }
    const pct = (name: string) => { const m = PCT_RE.exec(find(name)?.f ?? ''); return m && { pct: Math.round(+m[1] * 10000) / 100, ref: m[2] + m[3] } }
    const pro = pct('pro labore'), irpj = pct('irpj'), inss = pct('inss')
    const contab = find('contabilidade'), net = cellAt(c + 1, r)
    const gross = pro && ws[pro.ref]
    if (!pro || !irpj || !inss || typeof contab?.v !== 'number' || typeof net?.v !== 'number' || typeof gross?.v !== 'number') continue
    const grossCents = cents(gross.v), netCents = cents(net.v)
    const irpjCents = cents(gross.v * irpj.pct / 100)
    // O INSS é sobre o pró-labore; o valor calculado vem direto da célula.
    const inssCents = cents(Number(find('inss')!.v))
    let outrosCents = grossCents - irpjCents - inssCents - cents(contab.v) - netCents
    if (outrosCents < 0) { warnings.push('PJ: o líquido da planilha é maior que o calculado; outros descontos ficaram em zero'); outrosCents = 0 }
    return { proLaborePct: pro.pct, irpjPct: irpj.pct, inssPct: inss.pct, contabilidadeCents: cents(contab.v), outrosCents, grossCents, netCol: utils.encode_col(c + 1), netRow: r + 1 }
  }
  return miss()
}

export async function importOrcamento(db: Db, p: OrcamentoImport): Promise<{ months: number; lines: number; skipped: number }> {
  let months = 0, lines = 0, skipped = 0
  const existing = new Set((await db.select<{ month: Month }>('SELECT month FROM budget_months')).map(m => m.month))
  for (const { month, lines: ls } of p.months) {
    if (!existing.has(month)) {
      if (await createMonth(db, month, ls.map((l, position) => ({ ...l, position }))) === 'criado') { months++; lines += ls.length }
      continue
    }
    const keys = new Set((await db.select<{ k: string }>('SELECT source_key AS k FROM budget_lines WHERE month = ? AND source_key IS NOT NULL', [month])).map(r => r.k))
    for (const [position, l] of ls.entries()) {
      if (l.sourceKey && keys.has(l.sourceKey)) { skipped++; continue }
      await saveLine(db, { ...l, month, position })
      lines++
    }
  }
  if (p.pj && !(await db.select('SELECT 1 FROM meta WHERE key = ?', ['orcamento.pj'])).length) {
    const { grossCents: _, ...cfg } = p.pj
    await savePjConfig(db, cfg)
  }
  return { months, lines, skipped }
}
