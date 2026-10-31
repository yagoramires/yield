import { useAiSettings } from '../ai/settings'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { EyeToggle } from './HideValues'
import { ThemeToggle } from './theme'
import { useModules, useSidebarMini } from './prefs'
import { SyncStatus } from './SyncStatus'
import { ROUTES, type Route } from './routes'

export function Sidebar({ route, onNavigate, open = false }: { route: Route; onNavigate: (r: Route) => void; open?: boolean }) {
  const { enabled } = useModules()
  const ai = useAiSettings() // Assistente só aparece para quem escolheu usar IA
  const { mini: saved, toggle } = useSidebarMini()
  const mini = saved && !open // o menu aberto no celular é sempre o completo
  return (
    <nav id="app-navigation" aria-label="Navegação principal" className={`sidebar${open ? ' is-open' : ''}${mini ? ' mini' : ''}`}>
      {/* aberto: recolher ao lado do olho; recolhido: o botão de expandir fica no topo (order no CSS) */}
      <div className="logo-row"><div className="logo">{mini ? 'y' : 'yield'}<b>.</b></div><ThemeToggle /><EyeToggle /><button className="icon-btn sq menu-collapse" aria-label={mini ? 'Expandir menu' : 'Recolher menu'} title={mini ? 'Expandir menu' : 'Recolher menu'} onClick={toggle}>
        {mini ? <PanelLeftOpen size={14} aria-hidden /> : <PanelLeftClose size={14} aria-hidden />}
      </button></div>
      {ROUTES.filter(g => enabled(g.module) && (g.page !== 'Assistente' || ai.off === false)).map(({ page, items }) => (
        <div key={page} style={{ display: 'contents' }}>
          <div className={items.some(i => i.route === route) ? 'group on' : 'group'}>{page}</div>
          {items.map(({ route: r, label, disabled, icon: Icon }) => (
            <button
              key={label}
              className={r === route ? 'item on' : 'item'}
              aria-current={r === route ? 'page' : undefined}
              aria-label={mini ? `${page}: ${label}` : undefined}
              title={mini ? `${page} · ${label}` : undefined}
              disabled={disabled}
              onClick={() => r && onNavigate(r)}
            >
              <Icon size={15} aria-hidden /><span className="lbl">{label}</span>
              {disabled && <small>em breve</small>}
            </button>
          ))}
        </div>
      ))}
      <SyncStatus mini={mini} />
    </nav>
  )
}
