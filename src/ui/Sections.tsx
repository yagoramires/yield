import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GripHorizontal, Maximize2, Minimize2 } from 'lucide-react'
import { useSectionOrder } from './prefs'
import { moveId, orderIds } from './sectionOrder'

// wide: começa ocupando a linha inteira; sem ele, meia linha. A pessoa troca a largura de cada um.
type Item = { id: string; label: string; wide?: boolean; node: ReactNode }

/**
 * Blocos de uma tela que a pessoa arruma do jeito dela, numa grade de duas colunas: cada bloco em meia linha ou na linha toda,
 * no lugar que ela quiser — arrastando a alça (ponteiro, não o drag do HTML5, que o webview do Tauri atrapalha) ou com as setas nela.
 */
export function Sections({ page, items }: { page: string; items: Item[] }) {
  const [saved, save] = useSectionOrder(page)
  const [flipped, saveFlipped] = useSectionOrder(`${page}.largura`) // ids com a largura trocada em relação à de fábrica
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null) // o bloco que cede o lugar
  const overRef = useRef<string | null>(null) // o pointerup pode chegar antes do render do último pointermove
  const root = useRef<HTMLDivElement>(null)
  const refocus = useRef<string | null>(null)
  // a ordem vale para todos os ids; some da tela quem não tem o que mostrar (bloco condicional), mas guarda o lugar
  const order = orderIds(items.map(i => i.id), saved)
  const byId = new Map(items.map(i => [i.id, i]))
  const seq = order.filter(id => byId.get(id)?.node)
  const reset = () => { setDrag(null); setOver(null); overRef.current = null }
  // bloco cujo componente não desenhou nada fica escondido pelo CSS: as setas pulam ele
  const shown = () => seq.filter(x => root.current?.querySelector<HTMLElement>(`[data-sec="${x}"]`)?.offsetParent != null)
  // o bloco troca de lugar no DOM e a alça perde o foco: devolve a quem usa o teclado
  useEffect(() => { if (refocus.current) { root.current?.querySelector<HTMLElement>(`[data-grip="${refocus.current}"]`)?.focus(); refocus.current = null } })

  const pick = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)
    return el && root.current?.contains(el) ? el.closest<HTMLElement>('[data-sec]')?.dataset.sec ?? null : null
  }

  const card = (id: string) => {
    const { label, node, wide } = byId.get(id)!
    const isWide = !!wide !== flipped.includes(id)
    return (
      <div key={id} data-sec={id} className={`sec${isWide ? ' wide' : ''}${drag === id ? ' dragging' : ''}${drag && drag !== id && over === id ? ' drop' : ''}`}>
        <div className="sec-tools">
          <button
            className="sec-grip" data-grip={id}
            aria-label={`Mover ${label}`} title="Arraste para mudar de lugar (ou use as setas)"
            onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(id) }}
            onPointerMove={e => { if (drag) setOver(overRef.current = pick(e.clientX, e.clientY)) }}
            onPointerUp={() => { if (drag && overRef.current) save(moveId(order, drag, overRef.current)); reset() }}
            onPointerCancel={reset}
            onLostPointerCapture={reset}
            onKeyDown={e => {
              const vis = shown()
              const t = vis[vis.indexOf(id) + ({ ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key] ?? NaN)]
              if (!t) return
              e.preventDefault(); refocus.current = id; save(moveId(order, id, t))
            }}
          ><GripHorizontal size={14} aria-hidden /></button>
          <button aria-label={isWide ? `Deixar ${label} em meia largura` : `Deixar ${label} na largura toda`} title={isWide ? 'Meia largura' : 'Largura toda'}
            onClick={() => saveFlipped(flipped.includes(id) ? flipped.filter(x => x !== id) : [...flipped, id])}
          >{isWide ? <Minimize2 size={12} aria-hidden /> : <Maximize2 size={12} aria-hidden />}</button>
        </div>
        {node}
      </div>
    )
  }

  return <div ref={root} className="sections">{seq.map(card)}</div>
}
