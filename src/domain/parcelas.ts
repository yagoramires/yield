import type { Txn } from '../db/gastosRepo'
import type { BudgetLine } from '../db/orcamentoRepo'
import { normalizeDescription } from './gastos'
import { monthOf, monthsBetween } from './money'
import type { Cents, ISODate, Month } from './types'

/**
 * Compra parcelada no cartão, montada das parcelas que a Pluggy trouxe. Cada banco manda de um jeito:
 * - XP: a 1ª com a data da compra e as outras com a do dia seguinte, mesmo cobradas mês a mês; antecipando, as que faltam chegam todas juntas.
 * - Nubank: cada parcela com a data da fatura; antecipando, as restantes caem no mesmo dia.
 * - Mercado Pago: mês a mês, com a do mês seguinte já pendente; a descrição pode encurtar no meio ("…*MERCADOLIVRE" → "…*MERC").
 * Em todos, a 1ª parcela pode ter centavos a mais (arredondamento).
 */
export interface Purchase {
  accountId: string; norm: string; name: string; total: number; amountCents: Cents /* da parcela mais recente */
  members: { n: number; date: ISODate; amountCents: Cents; txnId: string }[]; maxN: number
  open: boolean // ainda falta parcela: a última não apareceu, ou há parcela com data futura
  keys: Set<string> // chaves de sugestão de todas as variações ("parc:conta|descrição|total|valor"), para achar as linhas do plano
}

const nOf = (t: Txn) => t.installment?.match(/^(\d+)\/(\d+)$/)
// centavos de arredondamento entre a 1ª parcela e as outras
const near = (a: Cents, b: Cents) => Math.abs(a - b) <= Math.max(5, Math.round(Math.max(a, b) * 0.01))
const sameDesc = (a: string, b: string) => a === b || a.startsWith(b) || b.startsWith(a)
export const parcKey = (accountId: string, norm: string, total: number, amountCents: Cents) => `parc:${accountId}|${norm}|${total}|${amountCents}`

export function purchases(txns: Txn[], today: ISODate): Purchase[] {
  const out: Purchase[] = []
  for (const t of [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const m = nOf(t)
    if (!m || t.amountCents >= 0) continue
    const n = Number(m[1]), total = Number(m[2]), amountCents = -t.amountCents, norm = normalizeDescription(t.description)
    if (total <= 1 || n < 1 || n > total) continue
    // duas compras iguais no mesmo lugar: a parcela que já existe na primeira vai para outra
    const p = out.find(p => p.accountId === t.accountId && p.total === total && near(p.amountCents, amountCents) && sameDesc(p.norm, norm) && !p.members.some(x => x.n === n))
    const key = parcKey(t.accountId, norm, total, amountCents)
    if (p) {
      p.members.push({ n, date: t.date, amountCents, txnId: t.id }); p.keys.add(key)
      if (n >= p.maxN) { p.maxN = n; p.name = t.description; p.amountCents = amountCents }
    } else out.push({ accountId: t.accountId, norm, name: t.description, total, amountCents, members: [{ n, date: t.date, amountCents, txnId: t.id }], maxN: n, open: true, keys: new Set([key]) })
  }
  // pelo calendário já teria terminado (ex.: a 1ª repetida pela XP, sozinha meses depois da compra ter fechado): fechada
  for (const p of out) p.open = (p.maxN < p.total && rawInstallment(p, monthOf(today)) <= p.total) || p.members.some(x => x.date > today)
  return out
}

/**
 * Número da parcela que cai no mês. Banco que data cada parcela pela fatura (as datas andam de mês em mês): conta a partir da mais recente
 * até o mês; banco que data todas pela compra (datas coladas, como a XP): conta a partir da menor parcela.
 */
export function installmentIn(p: Purchase, month: Month): number | null {
  const n = rawInstallment(p, month)
  return n >= 1 && n <= p.total ? n : null
}

function rawInstallment(p: Purchase, month: Month): number {
  const ms = [...p.members].sort((a, b) => a.n - b.n)
  const glued = ms.some((x, i) => i > 0 && Math.abs(Date.parse(x.date) - Date.parse(ms[i - 1].date)) < 5 * 86_400_000)
  const until = ms.filter(x => monthOf(x.date) <= month)
  const anchor = glued || !until.length ? ms[0] : until[until.length - 1]
  if (monthOf(anchor.date) > month) return 0
  return anchor.n + monthsBetween(monthOf(anchor.date), month).length - 1
}

/** A compra de uma linha do plano aceita das sugestões (chave "parc:…@mês"); null para linha à mão ou compra que sumiu dos lançamentos. */
export const purchaseOfKey = (ps: Purchase[], sourceKey: string | null): Purchase | null =>
  sourceKey?.startsWith('parc:') ? ps.find(p => p.keys.has(sourceKey.replace(/@\d{4}-\d{2}$/, ''))) ?? null : null

/**
 * Linhas de parcela do plano (aceitas das sugestões), do mês `from` em diante, que não deveriam estar lá: compra já quitada no cartão
 * (antecipada ou terminada antes) e linha repetida da mesma compra no mesmo mês (fica a de número menor). A última parcela de verdade fica:
 * a que veio no cartão naquele mês ou, no banco que data tudo pela compra (1ª e 2ª coladas, como a XP), o mês em que o calendário fecha a compra.
 */
export function staleInstallmentLines(lines: BudgetLine[], ps: Purchase[], from: Month): BudgetLine[] {
  const out: BudgetLine[] = []
  const kept = new Set<string>()
  const ls = lines.filter(l => l.month >= from && l.installmentTotal !== null).sort((a, b) => (a.installmentCurrent ?? 0) - (b.installmentCurrent ?? 0))
  for (const l of ls) {
    const p = purchaseOfKey(ps, l.sourceKey)
    if (!p) continue
    if (!p.open) {
      const first = p.members.find(x => x.n === 1), second = p.members.find(x => x.n === 2)
      const byPurchase = !!first && !!second && Math.abs(Date.parse(second.date) - Date.parse(first.date)) < 5 * 86_400_000
      const real = p.members.some(x => x.n === l.installmentCurrent && monthOf(x.date) === l.month) || (byPurchase && installmentIn(p, l.month) === p.total)
      if (!real) { out.push(l); continue }
    }
    const k = `${l.month}|${ps.indexOf(p)}`
    if (kept.has(k)) out.push(l); else kept.add(k)
  }
  return out
}
