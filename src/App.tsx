import { useState } from 'react'
import { Sidebar } from './ui/Sidebar'
import { Carteira } from './pages/Carteira'
import { Notas } from './pages/Notas'
import { Imposto } from './pages/Imposto'
import { Proventos } from './pages/Proventos'
import { Configuracoes } from './pages/Configuracoes'
import { ResumoGastos } from './pages/ResumoGastos'
import { ResumoInvestimentos } from './pages/ResumoInvestimentos'
import { Lancamentos } from './pages/Lancamentos'
import { Assinaturas } from './pages/Assinaturas'
import { Categorias } from './pages/Categorias'
import { Orcamento } from './pages/Orcamento'
import { ROUTES, type Route } from './ui/routes'
import { UpdateBanner } from './ui/Atualizacao'

const TITLES = Object.fromEntries(
  ROUTES.flatMap(p => p.items).flatMap(i => (i.route ? [[i.route, i.label]] : [])),
) as Record<Route, string>

export default function App() {
  const [route, setRoute] = useState<Route>('carteira')
  return (
    <div className="app">
      <Sidebar route={route} onNavigate={setRoute} />
      <main className="main">
        <UpdateBanner />
        {route === 'investimentos-resumo' ? <ResumoInvestimentos onOpenCarteira={() => setRoute('carteira')} onOpenImposto={() => setRoute('imposto')} onOpenNotas={() => setRoute('notas')} onOpenSettings={() => setRoute('configuracoes')} /> : route === 'gastos-resumo' ? <ResumoGastos onOpenLancamentos={() => setRoute('lancamentos')} onOpenSettings={() => setRoute('configuracoes')} /> : route === 'lancamentos' ? <Lancamentos onOpenSettings={() => setRoute('configuracoes')} /> : route === 'assinaturas' ? <Assinaturas /> : route === 'categorias' ? <Categorias /> : route === 'orcamento' ? <Orcamento onOpenGastos={() => setRoute('gastos-resumo')} onOpenSettings={() => setRoute('configuracoes')} /> : route === 'carteira' ? <Carteira onOpenSettings={() => setRoute('configuracoes')} /> : route === 'notas' ? <Notas /> : route === 'proventos' ? <Proventos /> : route === 'imposto' ? <Imposto /> : route === 'configuracoes' ? <Configuracoes /> : (
          <>
            <h1>{TITLES[route]}</h1>
            <div className="muted">Em construção.</div>
          </>
        )}
      </main>
    </div>
  )
}
