import { useEffect, useState } from 'react'
import { Sidebar } from './ui/Sidebar'
import { Carteira } from './pages/Carteira'
import { Notas } from './pages/Notas'
import { Imposto } from './pages/Imposto'
import { Proventos } from './pages/Proventos'
import { Declaracao } from './pages/Declaracao'
import { Configuracoes } from './pages/Configuracoes'
import { ResumoGastos } from './pages/ResumoGastos'
import { ResumoInvestimentos } from './pages/ResumoInvestimentos'
import { Lancamentos } from './pages/Lancamentos'
import { Assinaturas } from './pages/Assinaturas'
import { Categorias } from './pages/Categorias'
import { Orcamento } from './pages/Orcamento'
import { Assistente } from './pages/Assistente'
import { useAiSettings } from './ai/settings'
import { AiPergunta } from './pages/assistente/Pergunta'
import { moduleOf, ROUTES, type Route } from './ui/routes'
import { useModules } from './ui/prefs'
import { EyeToggle, useHideValues } from './ui/HideValues'
import { UpdateBanner } from './ui/Atualizacao'

const TITLES = Object.fromEntries(
  ROUTES.flatMap(p => p.items).flatMap(i => (i.route ? [[i.route, i.label]] : [])),
) as Record<Route, string>

export default function App() {
  // abre na última tela usada; storage pode falhar (modo privado, dados limpos) e aí cai na Carteira
  const [route, setRoute] = useState<Route>(() => {
    try {
      const saved = localStorage.getItem('yield.route')
      return ROUTES.some(g => g.items.some(i => i.route === saved && !i.disabled)) ? (saved as Route) : 'carteira'
    } catch { return 'carteira' }
  })
  useEffect(() => { try { localStorage.setItem('yield.route', route) } catch { /* sem storage, só não lembra */ } }, [route])
  // módulo desligado em Configurações: a tela dele sai do menu e o app vai para a primeira tela de um módulo ligado
  const { enabled } = useModules()
  const ai = useAiSettings()
  useEffect(() => {
    // Assistente desligado (ou ainda sem resposta) também sai, como um módulo desligado
    if (!enabled(moduleOf(route)) || (route === 'assistente' && ai.off !== false)) setRoute(ROUTES.find(g => g.module && enabled(g.module))?.items[0].route ?? 'configuracoes')
  }, [route, enabled, ai.off])
  const [provMonth, setProvMonth] = useState('') // mês clicado no Resumo, para Proventos abrir filtrado
  const [carteiraClass, setCarteiraClass] = useState<string | null>(null) // classe clicada no Resumo, para a Carteira abrir nela
  const [menuOpen, setMenuOpen] = useState(false)
  useHideValues() // o olhinho vale para o app todo: ligar ou desligar redesenha as telas com os valores ocultos ou não
  const navigate = (next: Route) => { setProvMonth(''); setCarteiraClass(null); setRoute(next); setMenuOpen(false) }
  return (
    <div className="app">
      <header className="mobile-header">
        <div className="logo">yield<b>.</b></div>
        <span className="t2">{TITLES[route]}</span>
        <EyeToggle />
        <button className="b ghost" aria-controls="app-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? 'Fechar menu' : 'Menu'}</button>
      </header>
      <Sidebar route={route} onNavigate={navigate} open={menuOpen} />
      {ai.off === null && <AiPergunta onUse={() => navigate('assistente')} />}
      <main className="main">
        <UpdateBanner />
        {route === 'investimentos-resumo' ? <ResumoInvestimentos onNavigate={navigate} onOpenProventos={m => { setProvMonth(m); setRoute('proventos') }} onOpenCarteira={(cls?: string) => { setCarteiraClass(cls ?? null); setRoute('carteira') }} onOpenImposto={() => setRoute('imposto')} onOpenNotas={() => setRoute('notas')} onOpenSettings={() => setRoute('configuracoes')} /> : route === 'gastos-resumo' ? <ResumoGastos onNavigate={navigate} onOpenLancamentos={() => setRoute('lancamentos')} onOpenAssinaturas={() => setRoute('assinaturas')} onOpenSettings={() => setRoute('configuracoes')} /> : route === 'lancamentos' ? <Lancamentos onOpenSettings={() => setRoute('configuracoes')} /> : route === 'assinaturas' ? <Assinaturas onOpenLancamentos={() => setRoute('lancamentos')} /> : route === 'categorias' ? <Categorias onOpenLancamentos={() => setRoute('lancamentos')} /> : route === 'orcamento' ? <Orcamento onNavigate={navigate} onOpenGastos={() => setRoute('gastos-resumo')} onOpenSettings={() => setRoute('configuracoes')} /> : route === 'carteira' ? <Carteira key={carteiraClass ?? ''} initialClass={carteiraClass} onOpenSettings={() => setRoute('configuracoes')} /> : route === 'notas' ? <Notas /> : route === 'proventos' ? <Proventos key={provMonth} initialMonth={provMonth} onNavigate={navigate} /> : route === 'imposto' ? <Imposto /> : route === 'declaracao' ? <Declaracao /> : route === 'assistente' ? <Assistente /> : route === 'configuracoes' ? <Configuracoes /> : (
          <>
            <h1>{TITLES[route]}</h1>
            <div className="muted">Em construção.</div>
          </>
        )}
      </main>
    </div>
  )
}
