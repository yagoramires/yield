import { CircleHelp, Pencil, Plus } from 'lucide-react'
import { goalsFor } from '../domain/orcamento'
import { useState } from 'react'
import type { Category, Txn } from '../db/gastosRepo'
import { monthTotals } from '../domain/gastos'
import { addMonths, formatBRL, formatCents, monthOf } from '../domain/money'
import { todayISO, useData } from '../state/DataProvider'
import { categoryLook, CategoryIcon } from '../ui/CategoryIcon'
import { barInfo, budgetByCategory, monthDelta, spentByCategory } from './categorias/build'
import { CategoriaPanel } from './categorias/CategoriaPanel'
import { RegrasPanel } from './categorias/RegrasPanel'
import { cutToDay, NO_FILTER } from './lancamentos/build'
import { GastosHeader, monthName } from './lancamentos/GastosHeader'

type Side = { mode: 'regras' } | { mode: 'editar'; id: string } | { mode: 'criar' }

function Delta({ d, prev }: { d: number | null; prev: string }) {
  if (d === null) return null
  if (d === 0) return <span className="delta eq">= {prev}</span>
  return <span className={`delta ${d > 0 ? 'up' : 'dn'}`}>{d > 0 ? '▲' : '▼'} {Math.abs(d)}%</span>
}

export function Categorias({ onOpenLancamentos }: { onOpenLancamentos(): void }) {
  const { gastos, orcamento } = useData()
  const { data, categorize: cat, month, setFilter } = gastos
  const [side, setSide] = useState<Side>({ mode: 'regras' })

  const prev = addMonths(month, -1)
  const prevShort = monthName(prev).slice(0, 3).toLowerCase()
  const rows = spentByCategory(data.txns, data.accounts, cat, data.categories, month)
  // no mês atual, o anterior entra só até o mesmo dia; senão o mês pela metade pareceria sempre mais barato
  const today = todayISO()
  const prevTxns = month === monthOf(today) ? cutToDay(data.txns, prev, Number(today.slice(8, 10))) : data.txns
  const before = new Map(spentByCategory(prevTxns, data.accounts, cat, data.categories, prev).map(r => [r.category?.id ?? null, r.cents]))
  const spent = monthTotals(data.txns, data.accounts, cat, month).spentCents
  const spentBefore = monthTotals(prevTxns, data.accounts, cat, prev).spentCents
  const budget = budgetByCategory(orcamento.data.lines, goalsFor(orcamento.data.goals, orcamento.data.months, month, data.categories), month)
  const isSem = (t: Txn) => monthOf(t.date) === month && t.amountCents < 0 && cat(t) === null
  const sem = { cents: rows.find(r => !r.category)?.cents ?? 0, count: data.txns.filter(isSem).length }
  const spending = rows.filter((r): r is typeof r & { category: Category } => !!r.category && r.countsAsSpending)
    .sort((a, b) => b.cents - a.cents || (before.get(b.category.id) ?? 0) - (before.get(a.category.id) ?? 0))
  // sem gasto neste mês nem no anterior: viram etiquetas, para a grade mostrar só o que mexeu
  const idle = (r: { category: Category; cents: number }) => r.cents === 0 && !before.get(r.category.id)
  const tiles = spending.filter(r => !idle(r))
  const off = rows.filter((r): r is typeof r & { category: Category } => !!r.category && !r.countsAsSpending)
  const editing = side.mode === 'editar' ? data.categories.find(c => c.id === side.id) ?? null : null

  const openTxns = (categoryId: string) => { setFilter({ ...NO_FILTER, categoryId }); onOpenLancamentos() }
  const edit = (id: string) => setSide({ mode: 'editar', id })

  const tile = ({ category: c, cents }: { category: Category; cents: number }) => {
    const { pct, over, caption } = barInfo(cents, budget.get(c.id), spent)
    return (
      <div key={c.id} className={`cat-tile ${editing?.id === c.id ? 'picked' : ''}`}>
        <button className="tile-main" onClick={() => openTxns(c.id)} aria-label={`${c.name}: ${formatBRL(cents)} em ${monthName(month).toLowerCase()}, ${caption}. Abrir lançamentos`}>
          <span className="tile-h"><CategoryIcon category={c} size={28} /><span className="tile-name">{c.name}</span>{!c.builtin && <span className="badge">sua</span>}</span>
          <span className="tile-v"><b>{cents ? formatCents(cents) : '—'}</b><Delta d={monthDelta(cents, before.get(c.id) ?? 0)} prev={prevShort} /></span>
          <span className="tile-bar"><i style={{ width: `${pct}%`, background: over ? 'var(--negative)' : categoryLook(c).color }} /></span>
          <span className={`tile-cap ${over ? 'over' : ''}`}>{caption}</span>
        </button>
        <button className="icon-btn sq tile-edit" aria-label={`Editar ${c.name}`} onClick={() => edit(c.id)}><Pencil size={12} aria-hidden /></button>
      </div>
    )
  }

  const chipRow = (label: string, list: { category: Category; cents: number }[]) => list.length > 0 && (
    <div className="off-chips"><span className="muted">{label}</span>
      {list.map(({ category: c, cents }) => (
        <span key={c.id} className={`off-chip ${editing?.id === c.id ? 'picked' : ''}`}>
          <button className="off-main" onClick={() => openTxns(c.id)}><CategoryIcon category={c} size={13} bare />{c.name}{cents > 0 && <b>{formatCents(cents)}</b>}</button>
          <button className="off-edit" aria-label={`Editar ${c.name}`} onClick={() => edit(c.id)}><Pencil size={11} aria-hidden /></button>
        </span>
      ))}
    </div>
  )

  return (
    <>
      <GastosHeader title="Categorias" />
      <div className="cat-summary">
        <span>Gasto do mês <b>{formatBRL(spent)}</b> <Delta d={monthDelta(spent, spentBefore)} prev={prevShort} />{monthDelta(spent, spentBefore) !== null && monthDelta(spent, spentBefore) !== 0 && <span className="muted"> vs {monthName(prev).toLowerCase()}</span>}</span>
        <button className="b pri with-ico" onClick={() => setSide({ mode: 'criar' })}><Plus size={13} aria-hidden />Nova categoria</button>
      </div>
      <div className={`cat-cols ${side.mode !== 'regras' ? 'editing' : ''}`}>
        <div className="cat-main">
          {sem.cents > 0 && (
            <div className="sem-alert"><CircleHelp size={15} aria-hidden />
              <span>{formatBRL(sem.cents)} em {sem.count === 1 ? '1 compra' : `${sem.count} compras`} sem categoria</span>
              <button className="link" onClick={() => openTxns('sem')}>Categorizar</button>
            </div>
          )}
          <div className="cat-tiles">{tiles.map(tile)}</div>
          {chipRow(`Sem gasto em ${monthName(month).toLowerCase()}:`, spending.filter(idle))}
          {chipRow('Fora dos gastos:', off)}
        </div>
        <div className="cat-side">
          {side.mode === 'regras' ? <RegrasPanel />
            : <CategoriaPanel key={side.mode === 'editar' ? side.id : 'nova'} category={side.mode === 'editar' ? editing : null} onClose={() => setSide({ mode: 'regras' })} />}
        </div>
      </div>
    </>
  )
}
