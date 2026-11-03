import { useState } from 'react'
import type { BankInvestmentRow } from '../../db/repo'
import { formatCents } from '../../domain/money'

/**
 * Quais investimentos do banco são a reserva: fechado, um resumo de uma linha; aberto, a lista com caixa de marcar.
 * Investimentos com o mesmo nome (várias aplicações no mesmo CDB) viram uma linha só.
 */
export function ReservaLink({ invs, linked, manual, busy, onChange }: {
  invs: BankInvestmentRow[]; linked: string[]; manual: boolean; busy: boolean
  onChange(ids: string[] | null /* null: volta ao automático */): void
}) {
  const [open, setOpen] = useState(false)
  const byName = new Map<string, BankInvestmentRow[]>()
  for (const i of invs) byName.set(i.name, [...(byName.get(i.name) ?? []), i])
  const groups = [...byName].map(([name, items]) => ({ name, items, cents: items.reduce((s, i) => s + i.balanceCents, 0) })).sort((a, b) => b.cents - a.cents)
  const count = (g: typeof groups[number]) => g.items.filter(i => linked.includes(i.id)).length
  const chosen = groups.filter(g => count(g) > 0)
  const toggle = (g: typeof groups[number]) => {
    const ids = g.items.map(i => i.id)
    onChange(count(g) === ids.length ? linked.filter(id => !ids.includes(id)) : [...new Set([...linked, ...ids])])
  }

  return (
    <div className="rl">
      <div className="rl-sum">
        <span className="muted">{chosen.length ? 'Ligada a' : 'Qual investimento do banco é esta reserva?'}</span>
        {chosen.length > 0 && <span className="rl-names" title={chosen.map(g => g.name).join('\n')}>{chosen.map(g => (count(g) > 1 ? `${g.name} (${count(g)})` : g.name)).join(', ')}</span>}
        {chosen.length > 0 && !manual && <span className="muted">· achado pelo nome</span>}
        <button type="button" className="link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'fechar' : chosen.length ? 'alterar' : 'escolher'}</button>
      </div>
      {open && (
        <div className="rl-list">
          {groups.map(g => {
            const n = count(g)
            return (
              <label key={g.name} className="rl-row">
                <input type="checkbox" disabled={busy} checked={n === g.items.length} ref={el => { if (el) el.indeterminate = n > 0 && n < g.items.length }} onChange={() => toggle(g)} />
                <span className="rl-name" title={g.name}>{g.name}</span>
                {g.items.length > 1 && <span className="muted">{g.items.length} aplicações</span>}
                <span className="rl-v">{formatCents(g.cents)}</span>
              </label>
            )
          })}
          <div className="rl-foot">
            {manual && <button type="button" className="link muted" disabled={busy} onClick={() => onChange(null)}>voltar ao automático</button>}
            <button type="button" className="b" onClick={() => setOpen(false)}>Pronto</button>
          </div>
        </div>
      )}
    </div>
  )
}
