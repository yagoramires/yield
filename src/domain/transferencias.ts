import type { Account, Category, Txn } from '../db/gastosRepo'
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

const words = (s: string) => ` ${s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z]+/g, ' ').trim()} `
const digits = (s: string) => s.replace(/\D/g, '')

/**
 * Pix/TED com o seu nome na descrição. `pessoa`: você mesmo, numa conta que não está no app (Transferência);
 * `empresa`: uma das empresas que você configurou, pelo nome ou CNPJ (o que ela paga é Receita).
 */
export function ownerMention(description: string, names: string[], companies: string[] = []): 'pessoa' | 'empresa' | null {
  const plain = words(description), num = digits(description)
  // antes do titular: o nome da PJ costuma conter o dele ("ANA TESTE ODONTOLOGIA")
  if (companies.some(c => (digits(c).length === 14 ? num.includes(digits(c)) : plain.includes(words(c))))) return 'empresa'
  const desc = keepSeparators(description)
  return names.some(n => { const name = keepSeparators(n).replace(/\|/g, ' ').replace(/\s+/g, ' ').trim(); return name && desc.includes(name) }) ? 'pessoa' : null
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

/** "Ana Teste Odontologia, 11.222.333/0001-81" → nomes (duas palavras ou mais) ou CNPJs completos. */
export function validCompanyNames(text: string): { names: string[] } | { error: string } {
  const names = text.split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
  const short = names.find(n => digits(n).length !== 14 && words(n).trim().split(' ').length < 2)
  return short ? { error: `Use o nome com pelo menos duas palavras ou o CNPJ completo ("${short}" pegaria Pix de outras empresas).` } : { names }
}

const PIX_TED = / (pix|ted|doc|transf\w*) /
const PJ = /\b(ltda|eireli|mei|me)\b|\bs[/.]a\b|(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/i

/**
 * Sem "sua empresa" configurada, Pix/TED recebido de uma PJ (LTDA, ME, EIRELI, S/A, MEI ou CNPJ na descrição)
 * que caiu em Transferência: provável pagamento da empresa do titular, que seria Receita. Para a dica em Lançamentos.
 */
export function companyCreditHints(txns: Txn[], accounts: Account[], cat: (t: Txn) => Category | null, companyNames: string[]): Txn[] {
  if (companyNames.length) return []
  const contas = new Set(accounts.filter(a => a.kind === 'conta').map(a => a.id))
  return txns.filter(t => t.amountCents > 0 && contas.has(t.accountId) && PIX_TED.test(words(t.description)) && PJ.test(t.description) && cat(t)?.id === 'transferencia')
}
