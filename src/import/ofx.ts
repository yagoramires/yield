import type { AccountKind } from '../db/gastosRepo'
import type { Cents, ISODate } from '../domain/types'

export interface ParsedStatement {
  institution: string
  externalId: string
  kind: AccountKind
  number: string | null
  rows: { date: ISODate; description: string; amountCents: Cents; fitid: string | null; sourceKey?: string }[]
}

export function decodeStatement(data: ArrayBuffer): string {
  const head = new TextDecoder('latin1').decode(data.slice(0, 500))
  if (/CHARSET:\s*(1252|ISO-8859-1)|encoding="(windows-1252|iso-8859-1)"/i.test(head)) return new TextDecoder('windows-1252').decode(data)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(data) } catch { return new TextDecoder('windows-1252').decode(data) }
}

// Não usa parseBRL: ele tira os pontos (milhar) e '-12.50' viraria -1250,00.
export function parseAmount(s: string): Cents {
  const m = /^([+-]?)(\d+)(?:[.,](\d+))?$/.exec(s.trim())
  if (!m) throw new Error(`Valor inválido: "${s}"`)
  return Math.round(Number(`${m[1]}${m[2]}.${m[3] ?? '0'}e2`)) + 0
}

const tag = (block: string, name: string) => new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block)?.[1].trim() || null
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

export function parseOfx(text: string): ParsedStatement {
  const kind: AccountKind = /<CREDITCARDMSGSRSV1>/i.test(text) ? 'cartao' : 'conta'
  const bankId = tag(text, 'BANKID')
  const org = tag(text, 'ORG')
  const acct = tag(text, 'ACCTID')
  if (!acct) throw new Error('Arquivo OFX sem número de conta (ACCTID)')
  const rows = [...text.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi)].map(([, b]) => {
    const dt = tag(b, 'DTPOSTED')
    const amt = tag(b, 'TRNAMT')
    if (!dt || !/^\d{8}/.test(dt) || amt == null) throw new Error('Lançamento OFX sem data ou valor válidos')
    return {
      date: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`,
      description: unescape(tag(b, 'MEMO') ?? tag(b, 'NAME') ?? ''),
      amountCents: parseAmount(amt),
      fitid: tag(b, 'FITID'),
    }
  })
  return { institution: org ?? bankId ?? 'OFX', externalId: `ofx:${bankId ?? org ?? (kind === 'cartao' ? 'cartao' : 'conta')}:${acct}`, kind, number: acct.replace(/\D/g, '').slice(-4), rows }
}
