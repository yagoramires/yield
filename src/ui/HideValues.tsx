import { Eye, EyeOff } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { formatBRL, formatCents, setMasked } from '../domain/money'
import { shortBRL } from './charts'
import { scoped } from '../profiles/active'

const KEY = scoped('yield.ocultarValores')
let hidden = (() => { try { return localStorage.getItem(KEY) === '1' } catch { return false } })()
setMasked(hidden)
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** Liga ou desliga o modo olhinho no app todo: os formatadores de dinheiro passam a devolver bolinhas e quem usa o hook redesenha. */
export function toggleHideValues() {
  hidden = !hidden
  setMasked(hidden)
  try { localStorage.setItem(KEY, hidden ? '1' : '0') } catch { /* sem storage: vale até fechar o app */ }
  listeners.forEach(l => l())
}

/** Modo olhinho: com `hidden` os formatadores devolvem bolinhas no lugar do valor (texto, gráficos e leitor de tela). */
export function useHideValues() {
  const h = useSyncExternalStore(subscribe, () => hidden)
  return { hidden: h, toggle: toggleHideValues, brl: formatBRL, cents: formatCents, short: shortBRL }
}

export function EyeToggle() {
  const { hidden: h, toggle } = useHideValues()
  return (
    <button className="icon-btn sq" aria-label={h ? 'Mostrar valores' : 'Ocultar valores'} aria-pressed={h} title={h ? 'Mostrar valores' : 'Ocultar valores'} onClick={toggle}>
      {h ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
    </button>
  )
}
