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
function table(ls: string[], sep: string): Record<string, string>[] {
  const head = splitRow(ls[0], sep)
  return ls.slice(1).filter(l => l.trim()).map(l => Object.fromEntries(splitRow(l, sep).map((v, i) => [head[i], v])))
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
  const recs = table(all.slice(start), nu ? ',' : ';')
  const rows = recs.map(r => {
    const id = (nu ? r['Identificador'] : r['REFERENCE_ID']) || undefined
    return nu
      ? { date: parseBRDate(r['Data']), description: r['Descrição'], amountCents: parseAmount(r['Valor']), fitid: null, sourceKey: id && `csv:nubank:${id}` }
      : { date: mpDate(r['RELEASE_DATE']), description: r['TRANSACTION_TYPE'], amountCents: parseBRL(r['TRANSACTION_NET_AMOUNT']), fitid: null, sourceKey: id && `csv:mp:${id}` }
  })
  return { institution: nu ? 'Nubank' : 'Mercado Pago', externalId: `csv:${preset}:${normalizeDescription(accountLabel)}`, kind: 'conta', number: null, rows }
}
