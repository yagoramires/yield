import type { BankInvestmentRow, ManualAsset } from '../db/repo'
import { fold } from './gastos'
import { investDest } from './orcamento'

// produtos que a Posição da B3 também mostra: com renda fixa importada da B3, vindos da Pluggy contariam duas vezes
const NA_B3 = /^(cdb|lci|lca|lc|lf|lig|treasury|tesouro|debenture|debentures|corporate_debt|cri|cra)$/i

/**
 * Investimento do banco de cada reserva, um investimento para uma reserva só: primeiro os ligados à mão; depois, para quem não tem,
 * o único que tem o nome da reserva como palavra inteira ("rdb" → "RDB Banco Exemplo") e que ninguém pegou.
 */
export function reservaInvestments(keys: string[], invs: BankInvestmentRow[], links: Record<string, string>): Map<string, BankInvestmentRow[]> {
  const taken = new Set<string>()
  const out = new Map<string, BankInvestmentRow[]>(keys.map(k => [k, []]))
  for (const k of keys) {
    const inv = links[k] ? invs.find(i => i.id === links[k] && !taken.has(i.id)) : undefined
    if (inv) { out.set(k, [inv]); taken.add(inv.id) }
  }
  for (const k of keys) {
    if (links[k] || !k) continue
    const word = new RegExp(`(^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`)
    // só liga sozinho quando um investimento só bate: com dois CDBs, "cdb" fica para a pessoa escolher no seletor
    const found = invs.filter(i => !taken.has(i.id) && (word.test(fold(i.name)) || investDest(i.name).key === k))
    if (found.length !== 1) continue
    taken.add(found[0].id)
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
