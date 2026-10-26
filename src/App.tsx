import { useState } from 'react'
import { Sidebar } from './ui/Sidebar'
import { Carteira } from './pages/Carteira'
import { Notas } from './pages/Notas'
import { Proventos } from './pages/Proventos'
import { ROUTES, type Route } from './ui/routes'

const TITLES = Object.fromEntries(
  ROUTES.flatMap(p => p.items).flatMap(i => (i.route ? [[i.route, i.label]] : [])),
) as Record<Route, string>

export default function App() {
  const [route, setRoute] = useState<Route>('carteira')
  return (
    <div className="app">
      <Sidebar route={route} onNavigate={setRoute} />
      <main className="main">
        {route === 'carteira' ? <Carteira /> : route === 'notas' ? <Notas /> : route === 'proventos' ? <Proventos /> : (
          <>
            <h1>{TITLES[route]}</h1>
            <div className="muted">Em construção.</div>
          </>
        )}
      </main>
    </div>
  )
}
