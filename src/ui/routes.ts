export type Route = 'carteira' | 'notas' | 'proventos' | 'imposto' | 'configuracoes'

export const ROUTES: {
  page: 'Últimos gastos' | 'Orçamento mensal' | 'Investimentos' | 'Sistema'
  items: { route: Route | null; label: string; disabled: boolean }[]
}[] = [
  {
    page: 'Últimos gastos',
    items: ['Lançamentos', 'Assinaturas', 'Categorias'].map(label => ({ route: null, label, disabled: true })),
  },
  { page: 'Orçamento mensal', items: [{ route: null, label: 'Mês atual', disabled: true }] },
  {
    page: 'Investimentos',
    items: [
      { route: 'carteira', label: 'Carteira', disabled: false },
      { route: 'notas', label: 'Notas', disabled: false },
      { route: 'proventos', label: 'Proventos', disabled: false },
      { route: 'imposto', label: 'Imposto', disabled: false },
    ],
  },
  { page: 'Sistema', items: [{ route: 'configuracoes', label: 'Configurações', disabled: false }] },
]
