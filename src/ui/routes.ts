export type Route = 'investimentos-resumo' | 'gastos-resumo' | 'lancamentos' | 'assinaturas' | 'categorias' | 'orcamento' | 'carteira' | 'notas' | 'proventos' | 'imposto' | 'declaracao' | 'configuracoes'

export const ROUTES: {
  page: 'Últimos gastos' | 'Orçamento mensal' | 'Investimentos' | 'Sistema'
  items: { route: Route | null; label: string; disabled: boolean }[]
}[] = [
  {
    page: 'Últimos gastos',
    items: [
      { route: 'gastos-resumo', label: 'Resumo', disabled: false },
      { route: 'lancamentos', label: 'Lançamentos', disabled: false },
      { route: 'assinaturas', label: 'Assinaturas', disabled: false },
      { route: 'categorias', label: 'Categorias', disabled: false },
    ],
  },
  { page: 'Orçamento mensal', items: [{ route: 'orcamento', label: 'Mês atual', disabled: false }] },
  {
    page: 'Investimentos',
    items: [
      { route: 'investimentos-resumo', label: 'Resumo', disabled: false },
      { route: 'carteira', label: 'Carteira', disabled: false },
      { route: 'notas', label: 'Notas', disabled: false },
      { route: 'proventos', label: 'Proventos', disabled: false },
      { route: 'imposto', label: 'Imposto', disabled: false },
      { route: 'declaracao', label: 'Declaração IR', disabled: false },
    ],
  },
  { page: 'Sistema', items: [{ route: 'configuracoes', label: 'Configurações', disabled: false }] },
]
