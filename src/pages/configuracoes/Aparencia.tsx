import { setTheme, THEME_LABEL, useTheme, type ThemeMode } from '../../ui/theme'
import { Select } from '../../ui/Select'

/** Tema do app: claro, escuro ou igual ao do sistema (o mesmo do botão do menu). */
export function Aparencia() {
  const mode = useTheme()
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h5 style={{ margin: 0 }}>Aparência <span className="muted">· tema do app</span></h5>
        <Select ariaLabel="Tema" value={mode} onChange={v => setTheme(v as ThemeMode)} options={(Object.keys(THEME_LABEL) as ThemeMode[]).map(m => ({ value: m, label: THEME_LABEL[m] }))} />
      </div>
    </div>
  )
}
