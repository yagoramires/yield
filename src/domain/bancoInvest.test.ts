import { expect, it } from 'vitest'
import type { BankInvestmentRow } from '../db/repo'
import { bankAssets, reservaInvestments } from './bancoInvest'

const inv = (id: string, name: string, type: string, subtype: string | null, balanceCents = 1000): BankInvestmentRow => ({ id, itemId: 'it', name, type, subtype, balanceCents, costCents: null, fetchedAt: '2026-10-30T12:00:00Z' })
const invs = [inv('a', 'RDB Banco Exemplo', 'FIXED_INCOME', 'RDB'), inv('b', 'CDB Banco Azul', 'FIXED_INCOME', 'CDB'), inv('c', 'Fundo Exemplo DI', 'MUTUAL_FUND', null), inv('d', 'Caixinha Viagem', 'FIXED_INCOME', 'RDB')]

it('reserva acha o investimento pelo nome, ou o ligado à mão', () => {
  const m = reservaInvestments(['rdb', 'dinheiro guardado'], invs, { 'dinheiro guardado': 'd' })
  expect([m.get('rdb')!.map(i => i.id), m.get('dinheiro guardado')!.map(i => i.id)]).toEqual([['a'], ['d']])
})

it('um investimento é de uma reserva só; ligado à mão vence; nome genérico com dois candidatos não liga sozinho; prefixo não conta', () => {
  const xs = [inv('a', 'RDB Caixinha Viagem', 'FIXED_INCOME', 'RDB'), inv('b', 'CDB Banco Azul', 'FIXED_INCOME', 'CDB'), inv('c', 'CDB Banco Laranja', 'FIXED_INCOME', 'CDB'), inv('n', 'Nubankrdb', 'FIXED_INCOME', 'RDB')]
  const m = reservaInvestments(['rdb', 'caixinha', 'cdb', 'nu'], xs, { caixinha: 'a' })
  expect([...m].map(([k, v]) => [k, v.map(i => i.id)])).toEqual([['rdb', []], ['caixinha', ['a']], ['cdb', []], ['nu', []]])
})

it('carteira leva o que a B3 não mostra e o que não é reserva; sem renda fixa da B3, leva o CDB também', () => {
  expect(bankAssets(invs, new Set(['a']), true).map(a => [a.id, a.assetClass])).toEqual([['pluggy:c', 'outro'], ['pluggy:d', 'renda_fixa']])
  expect(bankAssets(invs, new Set(), false).map(a => a.id)).toEqual(['pluggy:a', 'pluggy:b', 'pluggy:c', 'pluggy:d'])
})
