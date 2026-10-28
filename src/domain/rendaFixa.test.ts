import { describe } from 'vitest'
import type { RfMove, RfPosition } from '../db/rendaFixaRepo'
import { rfHoldings, rfJurosByMonth } from './rendaFixa'

let n = 0
const mv = (key: string, kind: RfMove['kind'], qty: number, valueCents: number | null, date = '2025-01-10', product = 'Tesouro Prefixado 2099'): RfMove =>
  ({ id: String(++n), key, product, date, kind, qty, valueCents, sourceKey: String(n) })
const pos = (key: string, valueCents: number, over: Partial<RfPosition> = {}): RfPosition =>
  ({ key, family: 'tesouro', product: 'Tesouro Prefixado 2099', issuer: null, indexer: 'Prefixado', maturity: '2099-01-01', qty: 6, appliedCents: null, valueCents, asOf: '2026-10-27', ...over })
const TD = 'td:tesouro prefixado 2099'
const CDB = 'rf:CDB0000AA00'
const CDB_PROD = 'CDB - CDB0000AA00 - BANCO LARANJA S/A'

test('aplicado por custo médio, recebido e rendimento', () => {
  const [h] = rfHoldings([mv(TD, 'aplicacao', 10, 100000), mv(TD, 'saida', 4, 45000), mv(TD, 'juros', 6, 3000)], [pos(TD, 70000)])
  expect(h).toMatchObject({ key: TD, name: 'Tesouro Prefixado 2099', qty: 6, appliedCents: 60000, investedCents: 100000, receivedCents: 48000, valueCents: 70000, gainCents: 18000, closed: false, asOf: '2026-10-27' })
  expect(h.gainPct).toBeCloseTo(0.18)
})

test('vencimento sem valor na B3: encerrado e rendimento desconhecido', () => {
  const [h] = rfHoldings([mv(CDB, 'aplicacao', 1, 50000, '2022-01-01', CDB_PROD), mv(CDB, 'saida', 1, null, '2023-01-01', CDB_PROD)], [])
  expect(h).toMatchObject({ closed: true, valueCents: 0, gainCents: null, gainPct: null, needsNewerPosicao: false })
})

test('resgate com valor: encerrado com rendimento final', () => {
  const [h] = rfHoldings([mv(CDB, 'aplicacao', 1, 50000, '2025-01-01', CDB_PROD), mv(CDB, 'saida', 1, 56000, '2026-01-01', CDB_PROD)], [])
  expect(h).toMatchObject({ closed: true, appliedCents: 0, investedCents: 50000, receivedCents: 56000, gainCents: 6000 })
})

test('só na Posição: CDB sem aplicado, Tesouro usa o aplicado da Posição', () => {
  const list = rfHoldings([], [pos(CDB, 105000, { family: 'rf', product: 'CDB - BANCO LARANJA S/A', issuer: 'BANCO LARANJA S/A', indexer: 'CDI', qty: 1 }), pos(TD, 55000, { appliedCents: 50000 })])
  const cdb = list.find(h => h.key === CDB)!
  expect(cdb).toMatchObject({ name: 'CDB BANCO LARANJA S/A', issuer: 'BANCO LARANJA S/A', investedCents: null, appliedCents: null, gainCents: null, valueCents: 105000 })
  expect(list.find(h => h.key === TD)).toMatchObject({ investedCents: 50000, appliedCents: 50000, gainCents: 5000 })
})

test('quantidade em aberto sem Posição pede uma Posição mais recente', () => {
  const [h] = rfHoldings([mv(TD, 'aplicacao', 1, 10000)], [])
  expect(h).toMatchObject({ closed: false, valueCents: null, gainCents: null, needsNewerPosicao: true })
})

test('abertos primeiro, por valor; encerrados depois', () => {
  const list = rfHoldings([mv(CDB, 'aplicacao', 1, 100, '2022-01-01', CDB_PROD), mv(CDB, 'saida', 1, 200, '2023-01-01', CDB_PROD)], [pos(TD, 100), pos('td:outro', 900, { product: 'Tesouro Selic 2098' })])
  expect(list.map(h => h.key)).toEqual(['td:outro', TD, CDB])
})

test('juros por mês, com os meses vazios', () => {
  expect(rfJurosByMonth([mv(TD, 'juros', 1, 3000, '2026-08-01'), mv(CDB, 'juros', 1, 1000, '2026-10-05'), mv(TD, 'aplicacao', 1, 9999, '2026-10-06')], '2026-10', 3))
    .toEqual([{ month: '2026-08', cents: 3000 }, { month: '2026-09', cents: 0 }, { month: '2026-10', cents: 1000 }])
})

test('fora da Posição e terminando numa saída: encerrado mesmo com quantidade diferente', () => {
  const list = rfHoldings([mv(CDB, 'aplicacao', 3, 30000, '2025-01-01', CDB_PROD), mv(CDB, 'saida', 1, 33000, '2026-01-01', CDB_PROD)], [pos(TD, 100, { asOf: '2026-02-01' })])
  expect(list.find(h => h.key === CDB)).toMatchObject({ closed: true, valueCents: 0, appliedCents: 0, gainCents: 3000, needsNewerPosicao: false })
})

test('venda parcial sem nenhuma Posição: continua aberto esperando a Posição', () => {
  const [h] = rfHoldings([mv(TD, 'aplicacao', 3, 30000, '2025-01-01'), mv(TD, 'saida', 1, 11000, '2026-01-01')], [])
  expect(h).toMatchObject({ closed: false, valueCents: null, needsNewerPosicao: true })
})

describe('revisão final', () => {
  test('título que sumiu da Posição mais recente não fica aberto com o valor antigo', () => {
    const list = rfHoldings([mv(CDB, 'aplicacao', 1, 1_000_000, '2025-01-01', CDB_PROD), mv(CDB, 'saida', 1, null, '2026-03-01', CDB_PROD)],
      [pos(CDB, 1_000_000, { family: 'rf', asOf: '2026-01-31' }), pos(TD, 5000, { asOf: '2026-04-30' })])
    expect(list.find(h => h.key === CDB)).toMatchObject({ closed: true, valueCents: 0 })
  })

  test('título vencido depois da data da Posição fecha em vez de ficar com o valor antigo', () => {
    const [h] = rfHoldings([mv(CDB, 'aplicacao', 1, 1_000_000, '2025-01-01', CDB_PROD), mv(CDB, 'saida', 1, 1_050_000, '2026-03-01', CDB_PROD)],
      [pos(CDB, 1_040_000, { family: 'rf', qty: 1, asOf: '2026-01-31' })])
    expect(h).toMatchObject({ closed: true, valueCents: 0, gainCents: 50_000 })
  })

  test('Movimentação sem o começo do histórico não inventa rendimento', () => {
    // 10 cotas compradas antes do período, 1 dentro; a Posição tem 11
    const [h] = rfHoldings([mv(TD, 'aplicacao', 1, 100_000)], [pos(TD, 1_300_000, { qty: 11, appliedCents: 1_100_000 })])
    expect(h).toMatchObject({ investedCents: 1_100_000, appliedCents: 1_100_000, gainCents: 200_000 })
    const [cdb] = rfHoldings([mv(CDB, 'aplicacao', 1, 100_000, '2025-01-01', CDB_PROD)], [pos(CDB, 1_300_000, { family: 'rf', qty: 11 })])
    expect(cdb).toMatchObject({ investedCents: null, gainCents: null })
  })

  test('resgate maior que o comprado no período: encerrado sem rendimento', () => {
    const [h] = rfHoldings([mv(CDB, 'aplicacao', 1, 30_000, '2025-01-01', CDB_PROD), mv(CDB, 'saida', 3, 99_000, '2026-01-01', CDB_PROD)], [])
    expect(h).toMatchObject({ closed: true, gainCents: null })
  })
})

test('aplicação depois da Posição pede uma Posição mais recente', () => {
  const [h] = rfHoldings([mv(TD, 'aplicacao', 1, 10000, '2026-10-28')], [pos(TD, 70000, { qty: 1 })])
  expect(h).toMatchObject({ valueCents: 70000, needsNewerPosicao: true })
})
