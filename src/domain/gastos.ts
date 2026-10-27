import type { Account, Category, CategoryRule, Txn } from '../db/gastosRepo'
import type { Cents, ISODate, Month } from './types'

export function normalizeDescription(s: string): string {
  return s
    .toLowerCase()
    .replace(/^\s*(pg|pag|paypal|mp|ifd)\s*\*\s*/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\d/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function fingerprint(accountId: string, date: ISODate, amountCents: Cents, description: string, occurrence: number): string {
  return `${accountId}|${date}|${amountCents}|${normalizeDescription(description)}|#${occurrence}`
}

export function withFingerprints<T extends { date: ISODate; amountCents: Cents; description: string }>(accountId: string, rows: T[]): (T & { fingerprint: string })[] {
  const seen = new Map<string, number>()
  return rows.map(r => {
    const key = fingerprint(accountId, r.date, r.amountCents, r.description, 0)
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    return { ...r, fingerprint: fingerprint(accountId, r.date, r.amountCents, r.description, n) }
  })
}

// \b no fim: "pag fatima" é um Pix, não fatura
const FATURA_NA_CONTA = /pagamento.*fatura|pag(to)? fatura|fatura.*cart|\bpag(to|amento)?\s*(de\s*)?(fat|fatura|cart|cartao)\b/
const PAGAMENTO_NO_CARTAO = /pagamento|pgto|pag fatura|pagto/
const APLICACAO_NA_CONTA = /aplica|caixinha|guardad|rdb|cdb|invest/

export function categorize(t: Txn, account: Account, rules: CategoryRule[], overrides: Record<string, string>, categories: Category[]): Category | null {
  const byId = (id: string) => categories.find(c => c.id === id) ?? null
  const overridden = overrides[t.fingerprint] ? byId(overrides[t.fingerprint]) : null
  if (overridden) return overridden

  const desc = normalizeDescription(t.description)
  const matched = rules
    .filter(r => r.pattern && desc.includes(r.pattern.toLowerCase()) && byId(r.categoryId))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0]
  if (matched) return byId(matched.categoryId)

  if (t.operationType === 'PAGAMENTO_FATURA' || (account.kind === 'conta' && FATURA_NA_CONTA.test(desc))) return byId('pagamento-de-fatura')
  if (t.operationType === 'RENDIMENTO_APLIC_FINANCEIRA' || t.operationType === 'RESGATE_APLIC_FINANCEIRA') return byId('investimento')
  if (account.kind === 'conta' && t.amountCents < 0 && APLICACAO_NA_CONTA.test(desc)) return byId('investimento')
  // outra entrada no cartão (estorno) fica sem categoria e conta como receita
  if (account.kind === 'cartao' && t.amountCents > 0 && PAGAMENTO_NO_CARTAO.test(desc)) return byId('pagamento-de-fatura')
  return null
}

export interface MonthTotals { spentCents: Cents; incomeCents: Cents; byCategory: { category: Category | null; cents: Cents }[] }

export function monthTotals(txns: Txn[], _accounts: Account[], cat: (t: Txn) => Category | null, month: Month): MonthTotals {
  let spentCents = 0, incomeCents = 0
  const by = new Map<string | null, { category: Category | null; cents: Cents }>()
  for (const t of txns) {
    if (t.date.slice(0, 7) !== month) continue
    const c = cat(t)
    const spending = c === null || c.countsAsSpending
    if (t.amountCents < 0 && spending) {
      spentCents -= t.amountCents
      const b = by.get(c?.id ?? null) ?? { category: c, cents: 0 }
      b.cents -= t.amountCents
      by.set(c?.id ?? null, b)
    } else if (t.amountCents > 0 && (spending || c.id === 'receita')) {
      incomeCents += t.amountCents
    }
  }
  return { spentCents, incomeCents, byCategory: [...by.values()].sort((a, b) => b.cents - a.cents) }
}
