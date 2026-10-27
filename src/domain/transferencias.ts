import type { Account, Txn } from '../db/gastosRepo'
import { normalizeDescription } from './gastos'

export interface TransferLink { otherAccountId: string; outgoing: boolean }

const MAX_DAYS = 3
const NOT_TRANSFER = new Set(['PAGAMENTO_FATURA', 'RENDIMENTO_APLIC_FINANCEIRA', 'RESGATE_APLIC_FINANCEIRA'])
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5

/**
 * Transferências entre as suas contas: saída de R$ X numa conta e entrada de R$ X noutra, até 3 dias de diferença.
 * Só contas (cartão tem a fatura); lançamento com categoria escolhida à mão fica de fora, liberando o outro lado.
 * Com vários candidatos vale o mais próximo na data, e cada lançamento entra em um par só.
 */
export function pairTransfers(txns: Txn[], accounts: Account[], overrides: Record<string, string>): Map<string, TransferLink> {
  const contas = new Set(accounts.filter(a => a.kind === 'conta').map(a => a.id))
  const eligible = txns.filter(t => contas.has(t.accountId) && t.amountCents !== 0 && !overrides[t.fingerprint] && !NOT_TRANSFER.has(t.operationType ?? ''))
  const ins = new Map<number, Txn[]>()
  for (const t of eligible) if (t.amountCents > 0) ins.set(t.amountCents, [...(ins.get(t.amountCents) ?? []), t])
  const out = new Map<string, TransferLink>()
  const outs = eligible.filter(t => t.amountCents < 0).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  for (const o of outs) {
    const match = (ins.get(-o.amountCents) ?? [])
      .filter(i => !out.has(i.id) && i.accountId !== o.accountId && days(i.date, o.date) <= MAX_DAYS)
      .sort((a, b) => days(a.date, o.date) - days(b.date, o.date) || a.id.localeCompare(b.id))[0]
    if (!match) continue
    out.set(o.id, { otherAccountId: match.accountId, outgoing: true })
    out.set(match.id, { otherAccountId: o.accountId, outgoing: false })
  }
  return out
}

/** Pix/TED com o seu nome na descrição: dinheiro indo ou vindo de uma conta sua que não está no app. */
export function mentionsOwner(description: string, names: string[]): boolean {
  const desc = normalizeDescription(description)
  return names.some(n => desc.includes(normalizeDescription(n)))
}

/** "Yago Ramires, YAGO R M" → variações; cada uma precisa de nome e sobrenome para não pegar Pix de outras pessoas. */
export function validOwnerNames(text: string): { names: string[] } | { error: string } {
  const names = text.split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
  const short = names.find(n => normalizeDescription(n).split(' ').length < 2)
  return short ? { error: `Use nome e sobrenome em cada variação ("${short}" é curto demais e pegaria Pix de outras pessoas).` } : { names }
}
