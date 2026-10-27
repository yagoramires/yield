import { normalizeDescription } from '../domain/gastos'
import type { ISODate } from '../domain/types'
import { parseBRDate, parseBRL } from './parse'
import { parseAmount, type ParsedStatement } from './ofx'

export type CsvPreset = 'nubank-conta' | 'mercadopago'

// Presets montados só com cabeçalhos públicos: pendentes de validação com um arquivo real.
const clean = (t: string) => t.replace(/^﻿/, '')
const lines = (t: string) => clean(t).split(/\r?\n/)

export function detectCsvPreset(text: string): CsvPreset | null {
  const ls = lines(text)
  if (/^Data,Valor,Identificador,Descri/.test(ls[0])) return 'nubank-conta'
  return ls.some(l => l.startsWith('RELEASE_DATE;')) ? 'mercadopago' : null
}

function splitRow(line: string, sep: string): string[] {
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
