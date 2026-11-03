import type { BankInvestmentRow, ManualAsset } from '../db/repo'
import { fold } from './gastos'
import { investDest } from './orcamento'

// produtos que a Posição da B3 também mostra: com renda fixa importada da B3, vindos da Pluggy contariam duas vezes
const NA_B3 = /^(cdb|lci|lca|lc|lf|lig|treasury|tesouro|debenture|debentures|corporate_debt|cri|cra)$/i

/**
 * Investimentos do banco de cada reserva (o saldo dela é a soma), cada investimento numa reserva só: primeiro os ligados à mão; depois,
 * para quem não tem, os que têm o nome da reserva como palavra inteira ("rdb" → "RDB Banco Exemplo") e que ninguém pegou; sem nome que
 * bata, os do tipo de produto com o nome da reserva (subtipo "RDB" da Pluggy em investimentos chamados "Caixinha").
 */
export function reservaInvestments(keys: string[], invs: BankInvestmentRow[], links: Record<string, string[]>): Map<string, BankInvestmentRow[]> {
  const taken = new Set<string>()
  const out = new Map<string, BankInvestmentRow[]>(keys.map(k => [k, []]))
  for (const k of keys) {
    const mine = invs.filter(i => links[k]?.includes(i.id) && !taken.has(i.id))
    mine.forEach(i => taken.add(i.id))
    if (mine.length) out.set(k, mine)
  }
  for (const k of keys) {
    if (Object.hasOwn(links, k) || !k) continue // escolhida à mão, mesmo sem nenhum
    const word = new RegExp(`(^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`)
    const byName = invs.filter(i => !taken.has(i.id) && (word.test(fold(i.name)) || investDest(i.name).key === k))
    const found = byName.length ? byName : invs.filter(i => !taken.has(i.id) && fold(i.subtype ?? '') === k)
    found.forEach(i => taken.add(i.id))
    out.set(k, found)
  }
  return out
}

/** Investimentos do banco que entram na Carteira como itens só de leitura: fora os de uma reserva e os que a B3 já mostra. */
export function bankAssets(invs: BankInvestmentRow[], reserved: Set<string>, hasB3Rf: boolean): ManualAsset[] {
  return invs.filter(i => !reserved.has(i.id) && !(hasB3Rf && i.type === 'FIXED_INCOME' && NA_B3.test(i.subtype ?? '')))
    .map(i => ({
      id: `pluggy:${i.id}`, name: i.name, assetClass: i.type === 'FIXED_INCOME' ? 'renda_fixa' : 'outro', currency: 'BRL', costCents: i.costCents,
      quoteSymbol: null, quantity: null, valueCents: i.balanceCents, updatedAt: i.fetchedAt.slice(0, 10), sourceKey: `pluggy:${i.id}`,
    }))
}
