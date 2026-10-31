import { BriefcaseBusiness, CalendarRange, ChartLine, Coins, FileCheck2, FileText, Landmark, LayoutDashboard, ReceiptText, Repeat, Settings, Sparkles, Tags, type LucideIcon } from 'lucide-react'

export type Route = 'investimentos-resumo' | 'gastos-resumo' | 'lancamentos' | 'assinaturas' | 'categorias' | 'orcamento' | 'carteira' | 'notas' | 'proventos' | 'imposto' | 'declaracao' | 'assistente' | 'configuracoes'
// módulo que a pessoa pode desligar em Configurações; Sistema fica sempre
export type Module = 'gastos' | 'orcamento' | 'investimentos'

export const ROUTES: {
  page: 'Últimos gastos' | 'Orçamento mensal' | 'Investimentos' | 'Assistente' | 'Sistema'
  module: Module | null
  items: { route: Route | null; label: string; disabled: boolean; icon: LucideIcon }[]
}[] = [
  {
    page: 'Últimos gastos', module: 'gastos',
    items: [
      { route: 'gastos-resumo', label: 'Resumo', disabled: false, icon: LayoutDashboard },
      { route: 'lancamentos', label: 'Lançamentos', disabled: false, icon: ReceiptText },
      { route: 'assinaturas', label: 'Assinaturas', disabled: false, icon: Repeat },
      { route: 'categorias', label: 'Categorias', disabled: false, icon: Tags },
    ],
  },
  { page: 'Orçamento mensal', module: 'orcamento', items: [{ route: 'orcamento', label: 'Mês atual', disabled: false, icon: CalendarRange }] },
  {
    page: 'Investimentos', module: 'investimentos',
    items: [
      { route: 'investimentos-resumo', label: 'Resumo', disabled: false, icon: ChartLine },
      { route: 'carteira', label: 'Carteira', disabled: false, icon: BriefcaseBusiness },
      { route: 'notas', label: 'Notas', disabled: false, icon: FileText },
      { route: 'proventos', label: 'Proventos', disabled: false, icon: Coins },
      { route: 'imposto', label: 'Imposto', disabled: false, icon: Landmark },
      { route: 'declaracao', label: 'Declaração IR', disabled: false, icon: FileCheck2 },
    ],
  },
  // fora dos módulos: quem liga e desliga é a escolha de usar IA (primeira abertura ou Configurações › Assistente (IA))
  { page: 'Assistente', module: null, items: [{ route: 'assistente', label: 'Assistente', disabled: false, icon: Sparkles }] },
  { page: 'Sistema', module: null, items: [{ route: 'configuracoes', label: 'Configurações', disabled: false, icon: Settings }] },
]

export const MODULES: { key: Module; label: string; hint: string }[] = [
  { key: 'gastos', label: 'Últimos gastos', hint: 'resumo, lançamentos, assinaturas e categorias' },
  { key: 'orcamento', label: 'Orçamento mensal', hint: 'ganhos, custos, metas e reserva' },
  { key: 'investimentos', label: 'Investimentos', hint: 'carteira, notas, proventos, imposto e declaração' },
]

export const moduleOf = (r: Route): Module | null => ROUTES.find(g => g.items.some(i => i.route === r))?.module ?? null
