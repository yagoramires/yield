import { describe, expect, it } from 'vitest'
import { parseCdi, parseYahooMonthly } from './historico'

describe('histórico de preços', () => {
  it('Yahoo mensal: mês pelo timestamp, ignora fechamento nulo', () => {
    const json = { chart: { result: [{ timestamp: [Date.UTC(2026, 0, 1, 3) / 1000, Date.UTC(2026, 1, 1, 3) / 1000, Date.UTC(2026, 2, 1, 3) / 1000], indicators: { quote: [{ close: [10.5, null, 12.25] }] } }] } }
    expect([...parseYahooMonthly(json)]).toEqual([['2026-01', 1050], ['2026-03', 1225]])
  })
  it('CDI do Banco Central: % do mês por mês', () => {
    expect([...parseCdi([{ data: '01/09/2026', valor: '1.05' }, { data: '01/10/2026', valor: '0.98' }])]).toEqual([['2026-09', 1.05], ['2026-10', 0.98]])
  })
})
