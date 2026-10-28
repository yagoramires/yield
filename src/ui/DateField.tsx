import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isoToBR, maskBR, monthGrid, parseBR } from './dateText'

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/**
 * Data em dd/mm/aaaa, digitável (as barras entram sozinhas) ou pelo calendário em português.
 * Troca o <input type="date"> do WebKit, que mostra a data de hoje em cinza com o campo vazio. `value`/`onChange` em ISO ('' = vazio).
 */
export function DateField({ value, onChange, ariaLabel }: { value: string; onChange(iso: string): void; ariaLabel: string }) {
  const [text, setText] = useState(isoToBR(value))
  const [open, setOpen] = useState(false)
  const base = value || localToday()
  const [view, setView] = useState({ y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) - 1 })
  const box = useRef<HTMLDivElement>(null)

  // valor trocado de fora (formulário limpo ou preenchido): o texto acompanha
  useEffect(() => { if (parseBR(text) !== value && !(value === '' && parseBR(text) === null)) setText(isoToBR(value)) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down)
    window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', esc) }
  }, [open])

  const pick = (iso: string) => { setText(isoToBR(iso)); onChange(iso); setOpen(false) }
  const move = (dm: number) => setView(v => { const t = v.y * 12 + v.m + dm; return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 } })
  const toggle = () => {
    if (!open) { const b = value || localToday(); setView({ y: Number(b.slice(0, 4)), m: Number(b.slice(5, 7)) - 1 }) }
    setOpen(!open)
  }
  const today = localToday()

  return (
    <div ref={box} className="date-field">
      <input className="in date-in" aria-label={ariaLabel} placeholder="dd/mm/aaaa" inputMode="numeric" value={text}
        onChange={e => { const t = maskBR(e.target.value); setText(t); onChange(parseBR(t) ?? '') }} />
      <button type="button" className="date-btn" aria-label={`Abrir calendário de ${ariaLabel}`} aria-expanded={open} onClick={toggle}><CalendarDays size={14} aria-hidden /></button>
      {open && (
        <div className="date-pop" role="dialog" aria-label={`Calendário de ${ariaLabel}`}>
          <div className="date-head">
            <button type="button" aria-label="Ano anterior" onClick={() => move(-12)}><ChevronsLeft size={14} aria-hidden /></button>
            <button type="button" aria-label="Mês anterior" onClick={() => move(-1)}><ChevronLeft size={14} aria-hidden /></button>
            <b>{MONTHS[view.m]} {view.y}</b>
            <button type="button" aria-label="Próximo mês" onClick={() => move(1)}><ChevronRight size={14} aria-hidden /></button>
            <button type="button" aria-label="Próximo ano" onClick={() => move(12)}><ChevronsRight size={14} aria-hidden /></button>
          </div>
          <div className="date-grid">
            {WEEK.map((w, i) => <span key={i} className="date-wd">{w}</span>)}
            {monthGrid(view.y, view.m).map(d => (
              <button type="button" key={d.iso} aria-label={isoToBR(d.iso)} aria-pressed={d.iso === value}
                className={`${d.inMonth ? '' : 'out'} ${d.iso === value ? 'sel' : ''} ${d.iso === today ? 'today' : ''}`} onClick={() => pick(d.iso)}>{Number(d.iso.slice(8))}</button>
            ))}
          </div>
          <div className="date-foot">
            <button type="button" className="link" onClick={() => pick(today)}>Hoje</button>
            <button type="button" className="link" onClick={() => { setText(''); onChange(''); setOpen(false) }}>Limpar</button>
          </div>
        </div>
      )}
    </div>
  )
}
