import { plainBRL, setMasked } from '../domain/money'
import { maskMoney, moneyTokens, unverified } from './check'

test('lê R$ e % do jeito que o modelo escreve', () => {
  expect(moneyTokens('R$ 1.234,56, R$1.234, -R$ 10, R$ 5 mil, −12,3% e 7 %').map(t => [t.kind, t.value, t.decimals])).toEqual([
    ['brl', 123456, 2], ['brl', 123400, 0], ['brl', -1000, 0], ['brl', 500000, 0], ['pct', -12.3, 1], ['pct', 7, 0],
  ])
  expect(moneyTokens(plainBRL(123456))[0].value).toBe(123456) // espaço sem quebra depois do R$
})

test('arredondar e tirar os centavos ainda confere; valor inventado não', () => {
  expect(unverified('Gastou R$ 1.235, R$1.234 e 12%', ['R$ 1.234,56', '12,3%'])).toEqual([])
  expect(unverified('R$ 1.300 e R$ 5 mil', ['R$ 1.234,56'])).toEqual(['R$ 1.300', 'R$ 5 mil'])
  expect(unverified('caiu 12,4%', ['12,3%'])).toEqual(['12,4%'])
})

test('olhinho ligado esconde os valores no texto da IA', () => {
  const text = `Sobrou ${plainBRL(123456)} no mês`
  setMasked(true)
  expect(maskMoney(text)).toBe('Sobrou R$ ••••• no mês')
  setMasked(false)
  expect(maskMoney(text)).toBe(text)
})
