import { useModules } from '../../ui/prefs'
import { MODULES } from '../../ui/routes'

/** Liga e desliga as abas do menu; os dados continuam guardados, só a tela some. Pelo menos um módulo fica ligado. */
export function Modulos() {
  const { enabled, toggle, disabled } = useModules()
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h5 style={{ margin: 0 }}>Módulos <span className="muted">· quais abas aparecem no menu</span></h5>
      <div style={{ marginTop: 8, display: 'grid', gap: 10 }}>
        {MODULES.map(m => {
          const on = enabled(m.key), last = on && disabled.length >= MODULES.length - 1
          return (
            <label key={m.key} className="toggle-row" title={last ? 'Pelo menos um módulo fica ligado' : undefined}>
              <span>{m.label}<small>{m.hint}</small></span>
              <input type="checkbox" className="switch" role="switch" checked={on} disabled={last} onChange={() => toggle(m.key)} />
            </label>
          )
        })}
      </div>
      <div className="muted" style={{ marginTop: 8 }}>Desligar só esconde a aba: nada é apagado, e a sincronização continua.</div>
    </div>
  )
}
