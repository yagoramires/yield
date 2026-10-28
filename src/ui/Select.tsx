import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

export interface Option { value: string; label: string }

/**
 * Lista suspensa no visual do app (o <select> nativo abre o menu do sistema do macOS).
 * Teclado: ↓/↑ abrem e andam, Enter/Espaço escolhem, Esc fecha; clique fora fecha.
 */
export function Select({ value, onChange, options, ariaLabel, disabled, small }: {
  value: string; onChange(value: string): void; options: Option[]; ariaLabel?: string; disabled?: boolean; small?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const current = options.find(o => o.value === value)

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', down)
    list.current?.children[hi]?.scrollIntoView({ block: 'nearest' })
    return () => document.removeEventListener('mousedown', down)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) list.current?.children[hi]?.scrollIntoView({ block: 'nearest' }) }, [hi, open])

  const show = () => { setHi(Math.max(0, options.findIndex(o => o.value === value))); setOpen(true) }
  const choose = (v: string) => { setOpen(false); if (v !== value) onChange(v) }
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false) }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return show()
      setHi(h => Math.min(options.length - 1, Math.max(0, h + (e.key === 'ArrowDown' ? 1 : -1))))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (open && options[hi]) choose(options[hi].value)
      else show()
    }
  }

  return (
    <div ref={box} className={`sel-field ${small ? 'small' : ''}`}>
      <button type="button" className="in sel-btn" disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={key}>
        <span>{current?.label ?? '—'}</span><ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <ul ref={list} className="sel-pop" role="listbox" aria-label={ariaLabel}>
          {options.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value} className={`${i === hi ? 'hi' : ''} ${o.value === value ? 'on' : ''}`}
              onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); choose(o.value) }}>
              <span>{o.label}</span>{o.value === value && <Check size={13} aria-hidden />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
