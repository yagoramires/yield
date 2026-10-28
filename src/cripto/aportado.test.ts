import { averageCosts, type Swap } from './aportado'

const T = (iso: string) => Date.parse(`${iso}T12:00:00Z`)
const buy = (date: string, asset: string, qty: number, pay: string, payQty: number): Swap => ({ time: T(date), get: asset, getQty: qty, pay, payQty })
const sell = (date: string, asset: string, qty: number, get: string, getQty: number): Swap => ({ time: T(date), get, getQty, pay: asset, payQty: qty })
const usdBrl = new Map([['2024-03', 500], ['2024-04', 550]])

test('compra em real soma custo; venda tira custo proporcional, fora de ordem é ordenado', () => {
  const r = averageCosts([sell('2024-05-01', 'BTC', 0.5, 'BRL', 99_999), buy('2024-01-01', 'BTC', 0.4, 'BRL', 400), buy('2024-02-01', 'BTC', 0.6, 'BRL', 800)], usdBrl)
  expect(r.get('BTC')).toEqual({ costCents: 60_000, partial: false })
  expect(r.has('BRL')).toBe(false) // o real não tem aportado a calcular
})

test('dólar digital vale o fechamento do dólar no mês da operação', () => {
  const r = averageCosts([buy('2024-03-10', 'BTC', 0.1, 'USDT', 100), buy('2024-04-02', 'ETH', 1, 'FDUSD', 10)], usdBrl)
  expect(r.get('BTC')).toEqual({ costCents: 50_000, partial: false })
  expect(r.get('ETH')).toEqual({ costCents: 5_500, partial: false })
})

test('vender cripto por USDT dá ao USDT o custo dele mesmo no mês', () => {
  const r = averageCosts([buy('2024-03-01', 'BTC', 1, 'BRL', 1000), sell('2024-03-20', 'BTC', 1, 'USDT', 300)], usdBrl)
  expect(r.get('BTC')).toEqual({ costCents: 0, partial: false })
  expect(r.get('USDT')).toEqual({ costCents: 150_000, partial: false })
})

test('cripto por cripto, outra moeda fiduciária ou mês sem dólar: custo desconhecido, ativo parcial', () => {
  const r = averageCosts([
    buy('2024-03-01', 'BTC', 1, 'BRL', 1000),
    buy('2024-03-02', 'ETH', 10, 'BTC', 0.25), // ETH pago com BTC: o BTC sai com 1/4 do custo
    buy('2024-03-03', 'SOL', 5, 'EUR', 100),
    buy('2023-01-01', 'ADA', 5, 'USDT', 100),
  ], usdBrl)
  expect(r.get('BTC')).toEqual({ costCents: 75_000, partial: false })
  expect(r.get('ETH')).toEqual({ costCents: 0, partial: true })
  expect(r.get('SOL')).toEqual({ costCents: 0, partial: true })
  expect(r.get('ADA')).toEqual({ costCents: 0, partial: true })
})

test('vender mais do que o histórico mostra (moeda depositada de fora) zera o custo e marca parcial', () => {
  const r = averageCosts([buy('2024-01-01', 'BTC', 0.1, 'BRL', 100), sell('2024-02-01', 'BTC', 0.3, 'BRL', 300), buy('2024-03-01', 'BTC', 0.1, 'BRL', 200)], usdBrl)
  expect(r.get('BTC')).toEqual({ costCents: 20_000, partial: true })
})
