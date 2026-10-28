import { normalizeDescription } from '../domain/gastos'
import type { Cents, ISODate } from '../domain/types'
import { parseBRDate, parseBRL } from './parse'
import { parseAmount, type ParsedStatement } from './ofx'

export type CsvPreset = 'nubank-conta' | 'mercadopago'
// atalhos do mapeador genérico: só preenchem as colunas
export type MapPreset = 'nubank-cartao'

// Presets montados só com cabeçalhos públicos: pendentes de validação com um arquivo real.
const clean = (t: string) => t.replace(/^﻿/, '')
const lines = (t: string) => clean(t).split(/\r?\n/)

export function detectCsvPreset(text: string): CsvPreset | null {
  const ls = lines(text)
  if (/^Data,Valor,Identificador,Descri/.test(ls[0])) return 'nubank-conta'
  return ls.some(l => l.startsWith('RELEASE_DATE;')) ? 'mercadopago' : null
}

export function splitRow(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true
    else if (c === sep) { out.push(cur); cur = '' }
    else cur += c
  }
  return [...out, cur].map(s => s.trim())
}

// shortcut: campo entre aspas com quebra de linha não é suportado; extratos reais não trazem.
function table(ls: string[], sep: string, offset: number): { r: Record<string, string>; line: number }[] {
  const head = splitRow(ls[0], sep)
  return ls.flatMap((l, i) => i && l.trim() ? [{ r: Object.fromEntries(splitRow(l, sep).map((v, j) => [head[j], v])), line: offset + i + 1 }] : [])
}

function mpDate(s: string): ISODate {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return parseBRDate(s.replace(/-/g, '/'))
}

export function parseExtratoCsv(text: string, preset: CsvPreset, accountLabel: string): ParsedStatement {
  const nu = preset === 'nubank-conta'
  const all = lines(text)
  const start = nu ? 0 : all.findIndex(l => l.startsWith('RELEASE_DATE'))
  if (start < 0) throw new Error('Cabeçalho RELEASE_DATE não encontrado: este não parece um extrato do Mercado Pago')
  const seen = new Map<string, number>() // linhas idênticas no mesmo arquivo ganham #n
  const rows = table(all.slice(start), nu ? ',' : ';', start).map(({ r, line }) => {
    const col = (k: string) => r[Object.keys(r).find(h => h.startsWith(k)) ?? k]?.trim() ?? ''
    const [dateK, amtK] = nu ? ['Data', 'Valor'] : ['RELEASE_DATE', 'TRANSACTION_NET_AMOUNT']
    if (!col(dateK) || !col(amtK)) throw new Error(`Linha ${line}: data ou valor ausente`)
    try {
      const date = nu ? parseBRDate(col(dateK)) : mpDate(col(dateK))
      const amountCents = nu ? parseAmount(col(amtK)) : parseBRL(col(amtK))
      const id = col(nu ? 'Identificador' : 'REFERENCE_ID')
      const description = col(nu ? 'Descri' : 'TRANSACTION_TYPE')
      let sourceKey: string | undefined
      if (nu) sourceKey = id ? `csv:nubank:${id}` : undefined
      else if (id) {
        const base = `csv:mp:${id}:${normalizeDescription(description)}:${amountCents}`
        const n = seen.get(base) ?? 0
        seen.set(base, n + 1)
        sourceKey = `${base}#${n}`
      }
      return { date, description, amountCents, fitid: null, sourceKey }
    } catch (e) { throw new Error(`Linha ${line}: ${(e as Error).message}`) }
  })
  return { institution: nu ? 'Nubank' : 'Mercado Pago', name: accountLabel, externalId: `csv:${preset}:${normalizeDescription(accountLabel)}`, kind: 'conta', number: null, rows }
}

/** Colunas pelo índice no cabeçalho; -1 = sem. Valor numa coluna só ou em débito e crédito separados. */
export interface CsvMapping { date: number; description: number; amount: number; debit: number; credit: number; expensesPositive: boolean /* fatura de cartão */ }
export interface CsvSniff { sep: string; start: number /* linha do cabeçalho */; header: string[]; preset: MapPreset | null; mapping: CsvMapping }

const SEPS = [';', '\t', ',']
const findCol = (header: string[], re: RegExp) => header.findIndex(h => re.test(h))

/** Separador pela contagem de colunas mais repetida (a vírgula decimal num arquivo com ";" dá contagens desencontradas). */
export function sniffCsv(text: string): CsvSniff {
  const all = lines(text)
  const sample = all.slice(0, 40)
  let best = { sep: ',', n: 0, score: 0 }
  for (const sep of SEPS) {
    const counts = new Map<number, number>()
    for (const l of sample) if (l.trim()) { const n = splitRow(l, sep).length; if (n >= 2) counts.set(n, (counts.get(n) ?? 0) + 1) }
    const [n, score] = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [0, 0]
    if (score > best.score) best = { sep, n, score }
  }
  if (!best.score) throw new Error('Não encontrei colunas neste CSV (separador ; , ou tabulação)')
  const start = all.findIndex(l => l.trim() && splitRow(l, best.sep).length === best.n)
  const header = splitRow(all[start], best.sep)
  const preset: MapPreset | null = header.join(',').toLowerCase() === 'date,title,amount' ? 'nubank-cartao' : null
  const amount = findCol(header, /^(valor|amount|value|quantia)/i)
  return {
    sep: best.sep, start, header, preset,
    mapping: {
      date: findCol(header, /^(data|date|dt\b)/i),
      description: findCol(header, /descri|hist[oó]rico|^title$|t[ií]tulo|lan[cç]amento|estabelecimento|memo/i),
      amount,
      debit: amount < 0 ? findCol(header, /d[eé]bito|sa[ií]da|debit/i) : -1,
      credit: amount < 0 ? findCol(header, /cr[eé]dito|entrada|credit/i) : -1,
      expensesPositive: preset === 'nubank-cartao',
    },
  }
}

function anyDate(s: string): ISODate {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s)
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : br ? [br[3].length === 2 ? `20${br[3]}` : br[3], br[2], br[1]] : ['', '', '']
  if (!y || +m < 1 || +m > 12 || +d < 1 || +d > 31) throw new Error(`Data inválida: "${s}"`)
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export function parseMappedCsv(text: string, layout: Pick<CsvSniff, 'sep' | 'start' | 'preset'>, m: CsvMapping, accountLabel: string): ParsedStatement {
  if (m.date < 0) throw new Error('Escolha a coluna da data')
  if (m.description < 0) throw new Error('Escolha a coluna da descrição')
  if (m.amount < 0 && m.debit < 0 && m.credit < 0) throw new Error('Escolha a coluna do valor (ou as de débito e crédito)')
  const body = lines(text).map((l, i) => ({ cells: splitRow(l, layout.sep), line: i + 1 })).slice(layout.start + 1).filter((_, i, a) => a[i].cells.some(Boolean))
  const cols = (m.amount >= 0 ? [m.amount] : [m.debit, m.credit]).filter(c => c >= 0)
  // vírgula decimal se algum valor termina em ",dd"; senão ponto ("45.90", "1,234.56")
  const comma = body.some(r => cols.some(c => /,\d{1,2}$/.test(r.cells[c] ?? '')))
  const num = (v: string): Cents => (comma ? parseBRL(v) : parseBRL(v.replace(/,/g, '').replace('.', ',')))
  const rows = body.flatMap(({ cells, line }) => {
    const cell = (c: number) => (c >= 0 ? cells[c] ?? '' : '')
    if (cols.every(c => !cell(c))) return [] // saldo do dia, linha informativa
    try {
      let amountCents = m.amount >= 0 ? num(cell(m.amount)) : Math.abs(num(cell(m.credit))) - Math.abs(num(cell(m.debit)))
      if (m.expensesPositive) amountCents = -amountCents + 0
      return [{ date: anyDate(cell(m.date)), description: cell(m.description), amountCents, fitid: null }]
    } catch (e) { throw new Error(`Linha ${line}: ${(e as Error).message}`) }
  })
  return { institution: accountLabel, name: accountLabel, externalId: `csv:${layout.preset ?? 'mapa'}:${normalizeDescription(accountLabel)}`, kind: m.expensesPositive ? 'cartao' : 'conta', number: null, rows }
}
