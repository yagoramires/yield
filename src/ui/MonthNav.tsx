import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { addMonths } from '../domain/money'
import type { Month } from '../domain/types'

const SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const label = (m: Month) => { const n = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 15)).toLocaleString('pt-BR', { month: 'long', timeZone: 'UTC' }); return `${n[0].toUpperCase()}${n.slice(1)} ${m.slice(0, 4)}` }
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

/** Mês do cabeçalho: setas para o anterior e o próximo, e o nome do mês abre a grade do ano para pular direto. */
export function MonthNav({ month, onChange, disabled }: { month: Month; onChange(m: Month): void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(Number(month.slice(0, 4)))
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    // abriu: o foco vai para o mês escolhido, para seguir no teclado
    box.current?.querySelector<HTMLButtonElement>('.month-grid .sel, .month-grid button')?.focus()
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [open])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled]) // salvando: nada de trocar de mês pelo popover
  const close = () => { setOpen(false); trigger.current?.focus() }
  const pick = (m: Month) => { close(); if (m !== month) onChange(m) }
  const now = thisMonth()

  return (
    // Esc fecha só o popover (não chega aos atalhos da tela)
    <div className="month-nav" ref={box} onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); close() } }}>
      <button className="icon-btn sq" aria-label="Mês anterior" disabled={disabled} onClick={() => onChange(addMonths(month, -1))}><ChevronLeft size={14} aria-hidden /></button>
      <button ref={trigger} className="month-btn" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => { setYear(Number(month.slice(0, 4))); setOpen(!open) }}>
        {label(month)}<ChevronDown size={12} aria-hidden />
      </button>
      <button className="icon-btn sq" aria-label="Próximo mês" disabled={disabled} onClick={() => onChange(addMonths(month, 1))}><ChevronRight size={14} aria-hidden /></button>
      {open && (
        <div className="date-pop month-pop" role="dialog" aria-label="Escolher mês">
          <div className="date-head">
            <button type="button" aria-label="Ano anterior" onClick={() => setYear(y => y - 1)}><ChevronLeft size={14} aria-hidden /></button>
            <b>{year}</b>
            <button type="button" aria-label="Próximo ano" onClick={() => setYear(y => y + 1)}><ChevronRight size={14} aria-hidden /></button>
          </div>
          <div className="month-grid">
            {SHORT.map((n, i) => {
              const m = `${year}-${String(i + 1).padStart(2, '0')}`
              return <button key={m} type="button" className={[m === month && 'sel', m === now && 'today'].filter(Boolean).join(' ')} aria-current={m === month ? 'date' : undefined} onClick={() => pick(m)}>{n}</button>
            })}
          </div>
          {now !== month && <div className="date-foot"><button type="button" className="link" onClick={() => pick(now)}>Ir para este mês</button></div>}
        </div>
      )}
    </div>
  )
}
