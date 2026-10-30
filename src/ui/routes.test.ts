import { moduleOf, ROUTES } from './routes'

test('todas as subseções estão ativas, inclusive o Mês atual do orçamento', () => {
  const inv = ROUTES.find(p => p.page === 'Investimentos')!
  expect(inv.items.map(i => i.label)).toEqual(['Resumo', 'Carteira', 'Notas', 'Proventos', 'Imposto', 'Declaração IR'])
  expect(inv.items.every(i => !i.disabled)).toBe(true)
  const gastos = ROUTES.find(p => p.page === 'Últimos gastos')!
  expect(gastos.items.map(i => [i.route, i.label])).toEqual([
    ['gastos-resumo', 'Resumo'], ['lancamentos', 'Lançamentos'], ['assinaturas', 'Assinaturas'], ['categorias', 'Categorias'],
  ])
  expect(gastos.items.every(i => !i.disabled)).toBe(true)
  const orc = ROUTES.find(p => p.page === 'Orçamento mensal')!
  expect(orc.items.map(({ icon: _, ...i }) => i)).toEqual([{ route: 'orcamento', label: 'Mês atual', disabled: false }])
  expect({ ...ROUTES.at(-2)!, items: ROUTES.at(-2)!.items.map(({ icon: _, ...i }) => i) }).toEqual({ page: 'Assistente', module: null, items: [{ route: 'assistente', label: 'Assistente', disabled: false }] })
  expect(ROUTES.at(-1)!.items[0]).toMatchObject({ route: 'configuracoes', label: 'Configurações' })
})

test('cada tela pertence a um módulo; Configurações a nenhum (fica sempre)', () => {
  expect([moduleOf('lancamentos'), moduleOf('orcamento'), moduleOf('carteira'), moduleOf('configuracoes')]).toEqual(['gastos', 'orcamento', 'investimentos', null])
})
