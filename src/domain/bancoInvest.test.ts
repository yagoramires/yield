import { expect, it } from 'vitest'
import type { BankInvestmentRow } from '../db/repo'
import { bankAssets, reservaInvestments } from './bancoInvest'

const inv = (id: string, name: string, type: string, subtype: string | null, balanceCents = 1000): BankInvestmentRow => ({ id, itemId: 'it', name, type, subtype, balanceCents, costCents: null, fetchedAt: '2026-10-30T12:00:00Z' })
const invs = [inv('a', 'RDB Banco Exemplo', 'FIXED_INCOME', 'RDB'), inv('b', 'CDB Banco Azul', 'FIXED_INCOME', 'CDB'), inv('c', 'Fundo Exemplo DI', 'MUTUAL_FUND', null), inv('d', 'Caixinha Viagem', 'FIXED_INCOME', 'RDB')]

it('reserva acha o investimento pelo nome, ou o ligado à mão', () => {
  const m = reservaInvestments(['rdb', 'dinheiro guardado'], invs, { 'dinheiro guardado': ['d'] })
  expect([m.get('rdb')!.map(i => i.id), m.get('dinheiro guardado')!.map(i => i.id)]).toEqual([['a'], ['d']])
})

it('um investimento é de uma reserva só; ligado à mão vence; nome com dois candidatos leva os dois; prefixo não conta', () => {
  const xs = [inv('a', 'RDB Caixinha Viagem', 'FIXED_INCOME', 'RDB'), inv('b', 'CDB Banco Azul', 'FIXED_INCOME', 'CDB'), inv('c', 'CDB Banco Laranja', 'FIXED_INCOME', 'CDB'), inv('n', 'Nubankrdb', 'FIXED_INCOME', null)]
  const m = reservaInvestments(['rdb', 'caixinha', 'cdb', 'nu'], xs, { caixinha: ['a'] })
  expect([...m].map(([k, v]) => [k, v.map(i => i.id)])).toEqual([['rdb', []], ['caixinha', ['a']], ['cdb', ['b', 'c']], ['nu', []]])
})

it('sem nome que bata, liga todos do tipo do produto (subtipo da Pluggy): o saldo da reserva é a soma', () => {
  const um = [inv('x', 'Caixinha Viagem', 'FIXED_INCOME', 'RDB'), inv('y', 'CDB Banco Azul', 'FIXED_INCOME', 'CDB')]
  expect(reservaInvestments(['rdb'], um, {}).get('rdb')!.map(i => i.id)).toEqual(['x'])
  const dois = [...um, inv('z', 'Caixinha Casa', 'FIXED_INCOME', 'RDB')]
  expect(reservaInvestments(['rdb'], dois, {}).get('rdb')!.map(i => i.id)).toEqual(['x', 'z'])
  expect(reservaInvestments(['rdb'], dois, { rdb: ['z'] }).get('rdb')!.map(i => i.id)).toEqual(['z']) // escolhido à mão, só ele
  expect(reservaInvestments(['rdb'], dois, { rdb: [] }).get('rdb')).toEqual([]) // desmarcou todos: nenhum, sem voltar ao automático
  expect(reservaInvestments(['rdb'], [...dois, inv('w', 'RDB Banco Exemplo', 'FIXED_INCOME', 'RDB')], {}).get('rdb')!.map(i => i.id)).toEqual(['w']) // o nome vence o tipo
})

it('carteira leva o que a B3 não mostra e o que não é reserva; sem renda fixa da B3, leva o CDB também', () => {
  expect(bankAssets(invs, new Set(['a']), true).map(a => [a.id, a.assetClass])).toEqual([['pluggy:c', 'outro'], ['pluggy:d', 'renda_fixa']])
  expect(bankAssets(invs, new Set(), false).map(a => a.id)).toEqual(['pluggy:a', 'pluggy:b', 'pluggy:c', 'pluggy:d'])
})
