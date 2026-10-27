import { expect, it } from 'vitest'
import { pluggyCategoryId } from './categoriasPluggy'

it('traduz as categorias da Pluggy para as do app', () => {
  const out = (c: string, cents = -1000) => pluggyCategoryId(c, cents)
  expect([
    out('Same person transfer'), out('Same person transfer - PIX'), out('Credit card payment'), out('Fixed income'),
    out('Gas stations'), out('Gas'), out('Groceries'), out('Food delivery'), out('Eating out'), out('Video streaming'),
    out('Airport and airlines'), out('Rent'), out('Electricity'), out('Pharmacy'), out('Education'), out('Cinema, theater and concerts'),
    out('Clothing'), out('Bank fees'), out('Taxi and ride-hailing'),
  ]).toEqual([
    'transferencia', 'transferencia', 'pagamento-de-fatura', 'investimento',
    'transporte', 'contas', 'mercado', 'alimentacao', 'alimentacao', 'assinaturas',
    'viagem', 'moradia', 'contas', 'saude', 'educacao', 'lazer',
    'compras', 'impostos-e-taxas', 'transporte',
  ])
})

it('salário entra como Receita; Pix para outra pessoa e categoria desconhecida ficam sem categoria', () => {
  expect(pluggyCategoryId('Salary', 500000)).toBe('receita')
  expect(pluggyCategoryId('Transfer - PIX', -5000)).toBeNull()
  expect(pluggyCategoryId('Third party transfers', -5000)).toBeNull()
  expect(pluggyCategoryId('Algo novo', -5000)).toBeNull()
  expect(pluggyCategoryId(null, -5000)).toBeNull()
})
