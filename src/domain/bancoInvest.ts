import type { BankInvestmentRow, ManualAsset } from '../db/repo'
import { fold } from './gastos'
import { investDest } from './orcamento'

// produtos que a Posição da B3 também mostra: com renda fixa importada da B3, vindos da Pluggy contariam duas vezes
const NA_B3 = /^(cdb|lci|lca|lc|lig|treasury|tesouro|debenture|debentures|cri|cra)$/i

/** Investimento do banco de cada reserva: o ligado à mão; senão o que tem o nome da reserva ("RDB" → "RDB Banco Exemplo"). */
export function reservaInvestments(keys: string[], invs: BankInvestmentRow[], links: Record<string, string>): Map<string, BankInvestmentRow[]> {
  return new Map(keys.map(k => [k, links[k] ? invs.filter(i => i.id === links[k])
    : invs.filter(i => fold(i.name).split(/\s+/).includes(k) || fold(i.name).startsWith(k) || investDest(i.name).key === k)]))
}

/** Investimentos do banco que entram na Carteira como itens só de leitura: fora os de uma reserva e os que a B3 já mostra. */
export function bankAssets(invs: BankInvestmentRow[], reserved: Set<string>, hasB3Rf: boolean): ManualAsset[] {
  return invs.filter(i => !reserved.has(i.id) && !(hasB3Rf && i.type === 'FIXED_INCOME' && NA_B3.test(i.subtype ?? '')))
    .map(i => ({
      id: `pluggy:${i.id}`, name: i.name, assetClass: i.type === 'FIXED_INCOME' ? 'renda_fixa' : 'outro', currency: 'BRL', costCents: i.costCents,
      quoteSymbol: null, quantity: null, valueCents: i.balanceCents, updatedAt: i.fetchedAt.slice(0, 10), sourceKey: `pluggy:${i.id}`,
    }))
}
