import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { formatBRL, formatCents } from '../domain/money'
import { shortBRL } from './charts'

const KEY = 'yield.ocultarValores'
const read = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }

/** Modo olhinho dos resumos: com `hidden` os formatadores devolvem bolinhas no lugar do valor (texto, gráficos e leitor de tela). */
export function useHideValues() {
  const [hidden, setHidden] = useState(read)
  const toggle = () => {
    const next = !hidden
    try { localStorage.setItem(KEY, next ? '1' : '0') } catch { /* sem storage: vale só nesta tela */ }
    setHidden(next)
  }
  return {
    hidden, toggle,
    brl: hidden ? () => 'R$ •••••' : formatBRL,
    cents: hidden ? () => '•••••' : formatCents,
    short: hidden ? () => '•••' : shortBRL,
  }
}

export function EyeToggle({ hidden, toggle }: { hidden: boolean; toggle(): void }) {
  return (
    <button className="icon-btn sq" aria-label={hidden ? 'Mostrar valores' : 'Ocultar valores'} aria-pressed={hidden} title={hidden ? 'Mostrar valores' : 'Ocultar valores'} onClick={toggle}>
      {hidden ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
    </button>
  )
}
