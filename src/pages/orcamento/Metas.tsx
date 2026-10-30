import { useState } from 'react'
import type { Category } from '../../db/gastosRepo'
import { formatCents } from '../../domain/money'
import { catGoal, GOAL_INVESTIR, GOAL_VARIAVEIS } from '../../domain/orcamento'
import type { Cents, Month } from '../../domain/types'
import { monthName } from '../lancamentos/GastosHeader'
import { goalChanges } from './build'
import { Select } from '../../ui/Select'

/** Metas do mês: valem dele em diante; os meses anteriores ficam com as que tinham. */
export function Metas({ month, categories, goals, averages, fixed, busy, onSave, onClose }: {
  month: Month; categories: Category[]; goals: Map<string, Cents>; averages: Map<string, Cents>; fixed: string[]; busy: boolean
  onSave(changes: { key: string; amountCents: Cents | null }[], fixed: string[] | null /* null: não mudou */): void; onClose(): void
}) {
  const spending = categories.filter(c => c.countsAsSpending)
  const keys = [GOAL_INVESTIR, GOAL_VARIAVEIS, ...spending.map(c => catGoal(c.id))]
  const [inputs, setInputs] = useState<Record<string, string>>(() => Object.fromEntries(keys.map(k => [k, goals.has(k) ? formatCents(goals.get(k)!) : ''])))
  const [error, setError] = useState<string | null>(null)
  const [fixas, setFixas] = useState(() => new Set(fixed))
  const field = (key: string, label: string, hint?: string, kind?: string) => (
    <div className="catrow" key={key} style={{ gridTemplateColumns: kind ? '1fr auto 92px 100px' : '1fr auto 100px' }}>
      <span style={{ color: '#fff' }}>{label}</span>
      <span className="muted r">{hint}</span>
      {kind && <Select small ariaLabel={`${label}: fixo ou variável`} value={fixas.has(kind) ? 'fixo' : 'variavel'} onChange={v => {
        const n = new Set(fixas); if (v === 'fixo') n.add(kind); else n.delete(kind); setFixas(n)
      }} options={[{ value: 'variavel', label: 'variável' }, { value: 'fixo', label: 'fixo' }]} />}
      <input className="in" aria-label={`Meta de ${label}`} placeholder="sem meta" style={{ width: '100%' }} value={inputs[key]} onChange={e => setInputs({ ...inputs, [key]: e.target.value })} />
    </div>
  )
  const save = () => {
    const next = [...fixas].sort(), changed = next.join() !== [...fixed].sort().join()
    try { setError(null); onSave(goalChanges(inputs, goals), changed ? next : null) } catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="card" style={{ marginBottom: 12, borderColor: '#2c3a14' }}>
      <div className="bar">
        <h5 style={{ margin: 0 }}>Metas</h5>
        <span className="muted">a partir de {monthName(month).toLowerCase()}; os meses anteriores não mudam</span>
      </div>
      <div className="grid2" style={{ marginTop: 8, columnGap: 28, rowGap: 0 }}>
        {field(GOAL_INVESTIR, 'Investir no mês')}
        {field(GOAL_VARIAVEIS, 'Limite dos variáveis', 'vazio = soma das categorias')}
      </div>
      <div className="muted" style={{ margin: '10px 0 2px' }}>Por categoria <span className="t2">· média dos últimos 3 meses ao lado; fixo ou variável escolhe a aba em Custos</span></div>
      <div className="grid2" style={{ columnGap: 28, rowGap: 0 }}>
        {spending.map(c => field(catGoal(c.id), c.name, averages.get(c.id) ? `média ${formatCents(averages.get(c.id)!)}` : undefined, c.id))}
      </div>
      {error && <div className="note" style={{ marginTop: 8 }}>{error}</div>}
      <div className="btns" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
        <button className="b ghost" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="b pri" disabled={busy} onClick={save}>Salvar metas</button>
      </div>
    </div>
  )
}
