import { useEffect, useRef, useState } from 'react'
import type { Category } from '../../db/gastosRepo'
import { CategoryIcon } from '../../ui/CategoryIcon'

/**
 * Grade de categorias aberta a partir de um lançamento; escolher já salva. Fecha com Esc ou clique fora da linha
 * (o botão que abriu fica na linha, então ele mesmo alterna sem reabrir).
 */
export function CategoryPicker({ categories, current, pattern, reach, busy, error, onPick, onClose }: {
  categories: Category[]; current: string | null; pattern: string; reach: number; busy: boolean; error: string | null
  onPick(categoryId: string, always: boolean): void; onClose(): void
}) {
  const [always, setAlways] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) close.current() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    document.addEventListener('mousedown', down)
    window.addEventListener('keydown', esc)
    ref.current?.scrollIntoView?.({ block: 'nearest' })
    ref.current?.querySelector<HTMLButtonElement>('button.on, button')?.focus({ preventScroll: true })
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', esc) }
  }, [])

  return (
    <div ref={ref} className="cat-pop" role="dialog" aria-label="Escolher categoria">
      <div className="cat-grid">
        {categories.map(c => (
          <button key={c.id} className={c.id === current ? 'on' : ''} disabled={busy} onClick={() => onPick(c.id, always)}>
            <CategoryIcon category={c} size={22} />{c.name}
          </button>
        ))}
      </div>
      {pattern && (
        <label className="cat-always">
          <input type="checkbox" checked={always} onChange={e => setAlways(e.target.checked)} />
          <span>Fazer isso sempre com “{pattern}”{reach > 0 && <span className="muted"> (também {reach === 1 ? 'na 1 compra antiga' : `nas ${reach} compras antigas`})</span>}</span>
        </label>
      )}
      {error && <div className="note" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  )
}
