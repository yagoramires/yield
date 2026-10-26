import { ROUTES, type Route } from './routes'

export function Sidebar({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  return (
    <nav className="sidebar">
      <div className="logo"><b>●</b> Yield</div>
      {ROUTES.map(({ page, items }) => (
        <div key={page} style={{ display: 'contents' }}>
          <div className={items.some(i => i.route === route) ? 'group on' : 'group'}>{page}</div>
          {items.map(({ route: r, label, disabled }) => (
            <button
              key={label}
              className={r === route ? 'item on' : 'item'}
              disabled={disabled}
              onClick={() => r && onNavigate(r)}
            >
              {label}
              {disabled && <small>em breve</small>}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}
