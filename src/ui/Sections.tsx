import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GripHorizontal, Maximize2, Minimize2 } from 'lucide-react'
import { useSectionOrder } from './prefs'
import { insertBefore, moveId, orderIds, SPLIT } from './sectionOrder'

// wide: começa ocupando a linha inteira; sem ele, meia linha. A pessoa troca a largura de cada um.
type Item = { id: string; label: string; wide?: boolean; node: ReactNode }

/**
 * Blocos de uma tela que a pessoa arruma do jeito dela: arrastando a alça (ponteiro, não o drag do HTML5, que o webview do Tauri atrapalha) ou com as setas nela.
 * Sem `split`: grade de duas colunas, cada bloco em meia linha ou na linha toda. Com `split`: duas colunas soltas (os `split` primeiros começam na esquerda) e o bloco passa de uma para a outra.
 */
export function Sections({ page, items, split }: { page: string; items: Item[]; split?: number }) {
  const cols = split !== undefined
  const [saved, save] = useSectionOrder(page)
  const [flipped, saveFlipped] = useSectionOrder(`${page}.largura`) // ids com a largura trocada em relação à de fábrica
  const [drag, setDrag] = useState<string | null>(null)
  // grade: o bloco que cede o lugar; colunas: o que fica logo depois (SPLIT = fim da esquerda, null = fim da direita)
  const [over, setOver] = useState<{ target: string | null } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const refocus = useRef<string | null>(null)
  const base = items.map(i => i.id)
  // a ordem vale para todos os ids; some da tela quem não tem o que mostrar (bloco condicional), mas guarda o lugar
  const order = orderIds(cols ? [...base.slice(0, split), SPLIT, ...base.slice(split)] : base, saved)
  const byId = new Map(items.map(i => [i.id, i]))
  const seq = order.filter(id => id === SPLIT || byId.get(id)?.node)
  const reset = () => { setDrag(null); setOver(null) }
  // o bloco troca de lugar no DOM e a alça perde o foco: devolve a quem usa o teclado
  useEffect(() => { if (refocus.current) { root.current?.querySelector<HTMLElement>(`[data-grip="${refocus.current}"]`)?.focus(); refocus.current = null } })

  const place = (id: string, target: string | null) => save(cols ? insertBefore(order, id, target) : target ? moveId(order, id, target) : order)
  const pick = (x: number, y: number): { target: string | null } | null => {
    const el = document.elementFromPoint(x, y)
    if (!el || !root.current?.contains(el)) return null
    const sec = el.closest<HTMLElement>('[data-sec]')
    if (!cols) return sec ? { target: sec.dataset.sec! } : null
    if (sec) {
      const id = sec.dataset.sec!, r = sec.getBoundingClientRect()
      return { target: y < r.top + r.height / 2 ? id : seq[seq.indexOf(id) + 1] ?? null }
    }
    const col = el.closest<HTMLElement>('[data-col]')
    return col ? { target: col.dataset.col === '0' ? SPLIT : null } : null
  }
  // setas: na grade anda um lugar; nas colunas ↑ ↓ andam (passando de uma coluna para a outra) e ← → trocam de coluna
  const keyTarget = (id: string, key: string): string | null | undefined => {
    const i = seq.indexOf(id)
    if (!cols) return seq[i + ({ ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[key] ?? NaN)]
    const s = seq.indexOf(SPLIT)
    if (key === 'ArrowUp') return i > 0 ? seq[i - 1] : undefined
    if (key === 'ArrowDown') return i < seq.length - 1 ? seq[i + 2] ?? null : undefined
    if (key === 'ArrowRight' && i < s) return seq[s + 1] ?? null
    if (key === 'ArrowLeft' && i > s) return SPLIT
    return undefined
  }

  const card = (id: string) => {
    const { label, node, wide } = byId.get(id)!
    const isWide = !!wide !== flipped.includes(id)
    const target = drag && drag !== id && over?.target === id
    return (
      <div key={id} data-sec={id} className={`sec${!cols && isWide ? ' wide' : ''}${drag === id ? ' dragging' : ''}${target ? (cols ? ' drop-before' : ' drop') : ''}`}>
        <div className="sec-tools">
          <button
            className="sec-grip" data-grip={id}
            aria-label={`Mover ${label}`} title="Arraste para mudar de lugar (ou use as setas)"
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(id) }}
            onPointerMove={e => { if (drag) setOver(pick(e.clientX, e.clientY)) }}
            onPointerUp={() => { if (drag && over) place(drag, over.target); reset() }}
            onPointerCancel={reset}
            onKeyDown={e => {
              const t = keyTarget(id, e.key)
              if (t === undefined || t === id) return
              e.preventDefault(); refocus.current = id; place(id, t)
            }}
          ><GripHorizontal size={14} aria-hidden /></button>
          {!cols && (
            <button aria-label={isWide ? `Deixar ${label} em meia largura` : `Deixar ${label} na largura toda`} title={isWide ? 'Meia largura' : 'Largura toda'}
              onClick={() => saveFlipped(flipped.includes(id) ? flipped.filter(x => x !== id) : [...flipped, id])}
            >{isWide ? <Minimize2 size={12} aria-hidden /> : <Maximize2 size={12} aria-hidden />}</button>
          )}
        </div>
        {node}
      </div>
    )
  }

  if (!cols) return <div ref={root} className="sections">{seq.map(card)}</div>
  const s = seq.indexOf(SPLIT)
  return (
    <div ref={root} className="grid2 sec-cols">
      {[seq.slice(0, s), seq.slice(s + 1)].map((col, n) => (
        <div key={n} data-col={n} className={`sections one${drag && over?.target === (n === 0 ? SPLIT : null) ? ' drop-end' : ''}`}>{col.map(card)}</div>
      ))}
    </div>
  )
}
