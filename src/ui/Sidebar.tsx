import { useAiSettings } from '../ai/settings'
import { EyeToggle } from './HideValues'
import { SyncStatus } from './SyncStatus'
import { ROUTES, type Route } from './routes'

export function Sidebar({ route, onNavigate, open = false }: { route: Route; onNavigate: (r: Route) => void; open?: boolean }) {
  const { off } = useAiSettings() // "Desligar o Assistente" em Configurações tira o item do menu
  return (
    <nav id="app-navigation" aria-label="Navegação principal" className={`sidebar${open ? ' is-open' : ''}`}>
      <div className="logo-row"><div className="logo">yield<b>.</b></div><EyeToggle /></div>
      {ROUTES.filter(g => !(off && g.page === 'Assistente')).map(({ page, items }) => (
        <div key={page} style={{ display: 'contents' }}>
          <div className={items.some(i => i.route === route) ? 'group on' : 'group'}>{page}</div>
          {items.map(({ route: r, label, disabled }) => (
            <button
              key={label}
              className={r === route ? 'item on' : 'item'}
              aria-current={r === route ? 'page' : undefined}
              disabled={disabled}
              onClick={() => r && onNavigate(r)}
            >
              {label}
              {disabled && <small>em breve</small>}
            </button>
          ))}
        </div>
      ))}
      <SyncStatus />
    </nav>
  )
}
