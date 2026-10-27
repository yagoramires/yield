import { ROUTES } from './routes'

test('Últimos gastos e Investimentos têm as subseções ativas e o orçamento fica em breve', () => {
  const inv = ROUTES.find(p => p.page === 'Investimentos')!
  expect(inv.items.map(i => i.label)).toEqual(['Carteira', 'Notas', 'Proventos', 'Imposto'])
  expect(inv.items.every(i => !i.disabled)).toBe(true)
  const gastos = ROUTES.find(p => p.page === 'Últimos gastos')!
  expect(gastos.items.map(i => [i.route, i.label])).toEqual([
    ['gastos-resumo', 'Resumo'], ['lancamentos', 'Lançamentos'], ['assinaturas', 'Assinaturas'], ['categorias', 'Categorias'],
  ])
  expect(gastos.items.every(i => !i.disabled)).toBe(true)
  const orc = ROUTES.find(p => p.page === 'Orçamento mensal')!
  expect(orc.items.map(i => i.label)).toEqual(['Mês atual'])
  expect(ROUTES.at(-1)!.items[0]).toMatchObject({ route: 'configuracoes', label: 'Configurações' })
})
