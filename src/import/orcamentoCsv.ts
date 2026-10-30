import type { Db } from '../db/client'
import { createMonth, saveGoals, saveLine, type BudgetLine, type Grupo, type LineKind } from '../db/orcamentoRepo'
import { fold, normalizeDescription } from '../domain/gastos'
import type { Month } from '../domain/types'
import { splitRow } from './extratoCsv'
import { parseBRL, parseDecimal } from './parse'

type CsvLine = Omit<BudgetLine, 'id' | 'month' | 'position'>
// identidade da linha: ao contrário de normalizeDescription, mantém os números ("Cartão 1234" ≠ "Cartão 5678", "Parcela 1" ≠ "Parcela 2")
const nameKey = (s: string) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim()

export const ORCAMENTO_CSV_EXEMPLO = `mes;tipo;nome;valor
2026-01;receita;Salário;5.000,00
2026-01;fixa;Aluguel;1.800,00
2026-01;variavel;Mercado;900,00
2026-01;meta;Reserva de emergência;500,00
`

const KINDS: Record<string, LineKind> = {
  entrada: 'entrada', receita: 'entrada', renda: 'entrada', salario: 'entrada',
  saida: 'saida', despesa: 'saida', gasto: 'saida', fixa: 'saida', fixo: 'saida', variavel: 'saida', meta: 'saida', investimento: 'saida',
}
const GRUPOS: Record<string, Grupo> = { fixa: 'fixo', fixo: 'fixo', variavel: 'variavel', meta: 'meta', investimento: 'meta' }
const COLS = ['mes', 'tipo', 'nome', 'valor']

/** Colunas mes;tipo;nome;valor (qualquer ordem; ; , ou tabulação). Mesmo nome e tipo em 2+ meses vira linha recorrente. */
export function parseOrcamentoCsv(text: string): { month: Month; lines: CsvLine[] }[] {
  const ls = text.replace(/^﻿/, '').split(/\r?\n/)
  const head = (sep: string) => splitRow(ls[0], sep).map(normalizeDescription)
  const sep = [';', '\t', ','].find(s => COLS.every(c => head(s).includes(c)))
  if (!sep) throw new Error('A primeira linha precisa ter as colunas mes;tipo;nome;valor')
  const at = COLS.map(c => head(sep).indexOf(c))
  const byMonth = new Map<Month, CsvLine[]>()
  const seen = new Map<string, number>()
  ls.forEach((l, i) => {
    if (!i || !l.trim()) return
    const [mes, tipo, name, valor] = at.map(j => splitRow(l, sep)[j] ?? '')
    const fail = (msg: string) => { throw new Error(`Linha ${i + 1}: ${msg}`) }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) fail(`mês "${mes}" inválido, use AAAA-MM`)
    const kind = KINDS[normalizeDescription(tipo)] ?? fail(`tipo "${tipo}" inválido (use receita, fixa, variavel ou meta)`)
    if (!name) fail('nome vazio')
    const v = valor.replace(/R\$|\s/g, '')
    if (v.startsWith('-')) fail('valor negativo; o tipo já diz se é entrada ou saída')
    let amountCents = 0
    try { amountCents = parseBRL(parseDecimal(v)) } catch (e) { fail((e as Error).message) }
    if (!amountCents) return
    // chave pelo nome: reimportar o mesmo arquivo pula as linhas já gravadas
    const key = `csv:${mes}:${kind}:${nameKey(name)}`, dup = seen.get(key) ?? 0
    seen.set(key, dup + 1)
    byMonth.set(mes, [...(byMonth.get(mes) ?? []), { kind, name, amountCents, recurring: false, categoryId: null, installmentCurrent: null, installmentTotal: null, sourceId: null, grupo: kind === 'saida' ? GRUPOS[normalizeDescription(tipo)] ?? 'fixo' : null, sourceKey: dup ? `${key}#${dup}` : key }])
  })
  const id = (l: CsvLine) => `${l.kind}:${nameKey(l.name)}`
  const monthsOf = new Map<string, number>()
  for (const lines of byMonth.values()) for (const k of new Set(lines.map(id))) monthsOf.set(k, (monthsOf.get(k) ?? 0) + 1)
  return [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, lines]) => ({ month, lines: lines.map(l => ({ ...l, recurring: monthsOf.get(id(l))! >= 2 })) }))
}

// meta e variável da planilha são planos, não gastos: viram a meta de investir e o limite dos variáveis do mês
const GOAL_OF: Partial<Record<Grupo, string>> = { meta: 'investir', variavel: 'variaveis' }

/** Mês novo é criado inteiro; num mês que já existe só entra o que não tem a mesma chave nem o mesmo tipo e nome. */
export async function importOrcamentoCsv(db: Db, months: { month: Month; lines: CsvLine[] }[]): Promise<{ months: number; lines: number; goals: number; skipped: number }> {
  let created = 0, lines = 0, goals = 0, skipped = 0
  for (const { month, lines: all } of months) {
    const sums = new Map<string, number>()
    const ls = all.filter(l => {
      const key = l.grupo ? GOAL_OF[l.grupo] : undefined
      if (key) sums.set(key, (sums.get(key) ?? 0) + l.amountCents)
      return !key
    })
    const had = await db.select<{ key: string; c: number | null }>('SELECT key, amount_cents AS c FROM budget_goals WHERE month = ?', [month])
    const changed = [...sums].filter(([key, c]) => had.find(h => h.key === key)?.c !== c)
    skipped += sums.size - changed.length
    goals += changed.length
    await saveGoals(db, month, changed.map(([key, amountCents]) => ({ key, amountCents })))
    if (await createMonth(db, month, ls.map((l, position) => ({ ...l, position }))) === 'criado') { created++; lines += ls.length; continue }
    const old = await db.select<{ kind: string; name: string; k: string | null }>('SELECT kind, name, source_key AS k FROM budget_lines WHERE month = ?', [month])
    const keys = new Set(old.map(o => o.k)), names = new Set(old.map(o => `${o.kind}:${nameKey(o.name)}`))
    for (const l of ls) {
      if (keys.has(l.sourceKey) || names.has(`${l.kind}:${nameKey(l.name)}`)) { skipped++; continue }
      await saveLine(db, { ...l, month, position: 0 })
      lines++
    }
  }
  return { months: created, lines, goals, skipped }
}
