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

// Depois do nome do titular, uma destas palavras indica a empresa dele ("ANA SOUZA DESENVOLVIMENTO DE SOFTWARE"), não ele.
const COMPANY = /\b(ltda|me|mei|eireli|epp|s a|sa|desenvolvimento|servicos|software|consultoria|tecnologia|comercio|representacoes|solucoes|sistemas|holding|participacoes|negocios|digital)\b/

/**
 * Pix/TED com o seu nome na descrição. `pessoa`: você mesmo, numa conta que não está no app (Transferência);
 * `empresa`: uma empresa com o seu nome, como a sua PJ (o que ela paga é Receita).
 */
export function ownerMention(description: string, names: string[]): 'pessoa' | 'empresa' | null {
  const desc = keepSeparators(description)
  for (const n of names) {
    const name = keepSeparators(n).replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()
    const at = name ? desc.indexOf(name) : -1
    // só o trecho colado ao nome conta: o banco depois de um " - " (ex. "BCO EXEMPLO S.A.") não é a sua empresa
    if (at >= 0) return COMPANY.test(desc.slice(at + name.length).split('|')[0]) ? 'empresa' : 'pessoa'
  }
  return null
}

// minúsculas sem acento; hífen, barra vertical, marcador e números viram o separador "|", o resto da pontuação vira espaço
const keepSeparators = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[^a-z\s]/g, c => (/[-|•(\d]/.test(c) ? ' | ' : ' ')).replace(/\s+/g, ' ')

/** "Ana Souza, ANA S" → variações; cada uma precisa de nome e sobrenome para não pegar Pix de outras pessoas. */
export function validOwnerNames(text: string): { names: string[] } | { error: string } {
  const names = text.split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
  const short = names.find(n => normalizeDescription(n).split(' ').length < 2)
  return short ? { error: `Use nome e sobrenome em cada variação ("${short}" é curto demais e pegaria Pix de outras pessoas).` } : { names }
}
