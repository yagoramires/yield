import { Monitor, Moon, Sun } from 'lucide-react'
import { useSyncExternalStore } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'

/** O tema que vale: "sistema" segue o claro/escuro do macOS ou do Windows. */
export const effectiveTheme = (mode: ThemeMode, prefersLight: boolean): 'light' | 'dark' => (mode === 'system' ? (prefersLight ? 'light' : 'dark') : mode)

const KEY = 'yield.tema'
// começa no escuro (o visual de sempre); quem quiser escolhe claro ou "igual ao sistema"
let mode: ThemeMode = (() => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'system' ? v : 'dark' } catch { return 'dark' } })()
const listeners = new Set<() => void>()
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null
const apply = () => { if (typeof document !== 'undefined') document.documentElement.dataset.theme = effectiveTheme(mode, !!media?.matches) }
apply() // no import, antes da primeira tela: não pisca o tema errado
media?.addEventListener('change', apply)

export function setTheme(next: ThemeMode) {
  mode = next
  try { localStorage.setItem(KEY, next) } catch { /* sem storage: vale até fechar */ }
  apply()
  listeners.forEach(l => l())
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useTheme = (): ThemeMode => useSyncExternalStore(subscribe, () => mode)

export const THEME_LABEL: Record<ThemeMode, string> = { system: 'Igual ao sistema', light: 'Claro', dark: 'Escuro' }
const NEXT: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' }

/** Botão do menu: alterna sistema → claro → escuro; o ícone mostra o modo atual. */
export function ThemeToggle() {
  const m = useTheme()
  const Icon = m === 'system' ? Monitor : m === 'light' ? Sun : Moon
  const label = `Tema: ${THEME_LABEL[m].toLowerCase()} (trocar para ${THEME_LABEL[NEXT[m]].toLowerCase()})`
  return <button className="icon-btn sq" aria-label={label} title={label} onClick={() => setTheme(NEXT[m])}><Icon size={14} aria-hidden /></button>
}
