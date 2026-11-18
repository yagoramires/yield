import { describe, expect, it } from 'vitest'
import { BinanceError } from './binance'
import { binanceErrorText, costSummaryText, historyFailText } from './mensagens'

describe('binanceErrorText', () => {
  it('chave, rede e o resto', () => {
    expect(binanceErrorText(new BinanceError('x', 'chave'))).toBe('Binance: chave inválida ou sem permissão de leitura')
    expect(binanceErrorText(new BinanceError('x', 'rede'))).toBe('Sem conexão com a Binance')
    expect(binanceErrorText(new Error('HTTP 500'))).toBe('Binance: HTTP 500')
  })

  it('historyFailText diz qual fonte do histórico ficou de fora', () => {
    expect(historyFailText([])).toBeNull()
    expect(historyFailText([{ source: 'Convert', error: new BinanceError('x', 'chave') }, { source: 'negociações spot', error: new BinanceError('x', 'rede') }, { source: 'dólar do mês', error: new Error('Yahoo BRL=X: HTTP 500') }]))
      .toBe('Não lido: Convert (a chave não tem acesso); negociações spot (sem conexão); dólar do mês (Yahoo BRL=X: HTTP 500).')
  })
})

it('costSummaryText: diz o que achou em cada fonte e o que ficou sem histórico', () => {
  expect(costSummaryText({ failed: [], found: { 'compras com PIX/cartão': 3, Convert: 0, 'negociações à vista': 1 }, computed: ['BTC'], missing: ['BNB'] }))
    .toBe('Histórico da Binance: 3 compras com PIX/cartão, 0 Convert, 1 negociações à vista. Aportado calculado: BTC. Sem compra no histórico: BNB (informe à mão).')
  expect(costSummaryText({ failed: [], found: { 'compras com PIX/cartão': 0, Convert: 0, 'negociações à vista': 0 }, computed: [], missing: ['BTC'] }))
    .toBe('Histórico da Binance: nenhuma compra encontrada. Sem compra no histórico: BTC (informe à mão).')
})

it('costSummaryText: com fonte não lida, não manda informar à mão o que pode estar nela', () => {
  expect(costSummaryText({ failed: [{ source: 'Convert', error: new BinanceError('x', 'rede') }], found: { 'compras com PIX/cartão': 1, Convert: 0, 'negociações à vista': 0 }, computed: ['BTC'], missing: ['ETH'] }))
    .toBe('Histórico da Binance: 1 compras com PIX/cartão, 0 Convert, 0 negociações à vista. Aportado calculado: BTC. Sem compra no histórico lido: ETH (alguma fonte não foi lida; tente de novo antes de informar à mão). Não lido: Convert (sem conexão).')
})
