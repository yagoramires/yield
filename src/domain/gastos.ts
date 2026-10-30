import type { Account, Category, CategoryRule, Txn } from '../db/gastosRepo'
import { pluggyCategoryId } from './categoriasPluggy'
import { ownerMention } from './transferencias'
import type { Cents, ISODate, Month } from './types'

/** Minúsculas, sem acento e sem espaço nas pontas: para comparar nomes. */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

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

const SMALL = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

/** Descrição do extrato para mostrar: sem o prefixo da maquininha (MP*, PG *…), sem a parcela do fim e sem o caixa alta. */
export function displayName(s: string): string {
  let n = s.trim().replace(/^Transfer[eê]ncia enviada pelo Pix\s*\|\s*/i, 'Pix para ')
    .replace(/^\s*(pg|pag|paypal|mp|ifd|asaas|ebn|pagseguro|picpay)\s*\*\s*/i, '').replace(/\s+\d{1,2}\/\d{1,2}$/, '')
  const parts = n.split('*').map(p => p.trim()).filter(Boolean)
  n = [...new Set(parts.map(p => p.toLowerCase()))].length === 1 ? parts[0] : parts.join(' · ')
  if (!n) return s.trim()
  if (/\p{Ll}/u.test(n)) return n // já tem minúscula: alguém escreveu assim
  return n.toLowerCase().split(' ').map((w, i) => (i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
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

/** `paired`: o lançamento casou com outro de uma conta sua (`pairTransfers`); `ownerNames`: variações do nome do titular; `companyNames`: nome ou CNPJ da empresa dele. */
export function categorize(t: Txn, account: Account, rules: CategoryRule[], overrides: Record<string, string>, categories: Category[], ctx: { paired?: boolean; ownerNames?: string[]; companyNames?: string[] } = {}): Category | null {
  const byId = (id: string) => categories.find(c => c.id === id) ?? null
  const overridden = overrides[t.fingerprint] ? byId(overrides[t.fingerprint]) : null
  if (overridden) return overridden

  const desc = normalizeDescription(t.description)
  const matched = rules
    .filter(r => r.pattern && desc.includes(r.pattern.toLowerCase()) && byId(r.categoryId))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0]
  if (matched) return byId(matched.categoryId)

  if (ctx.paired) return byId('transferencia')
  const owner = account.kind === 'conta' ? ownerMention(t.description, ctx.ownerNames ?? [], ctx.companyNames) : null
  if (owner === 'pessoa') return byId('transferencia')
  if (owner === 'empresa') return byId(t.amountCents > 0 ? 'receita' : 'transferencia')

  if (t.operationType === 'PAGAMENTO_FATURA' || (account.kind === 'conta' && FATURA_NA_CONTA.test(desc))) return byId('pagamento-de-fatura')
  if (t.operationType === 'RENDIMENTO_APLIC_FINANCEIRA' || t.operationType === 'RESGATE_APLIC_FINANCEIRA') return byId('investimento')
  if (account.kind === 'conta' && t.amountCents < 0 && APLICACAO_NA_CONTA.test(desc)) return byId('investimento')
  // outra entrada no cartão (estorno) fica sem categoria e conta como receita
  if (account.kind === 'cartao' && t.amountCents > 0 && PAGAMENTO_NO_CARTAO.test(desc)) return byId('pagamento-de-fatura')
  const fromPluggy = pluggyCategoryId(t.pluggyCategory, t.amountCents)
  return fromPluggy ? byId(fromPluggy) : null
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
