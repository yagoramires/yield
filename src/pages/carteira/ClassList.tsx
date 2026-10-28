import { formatCents } from '../../domain/money'
import { classColor } from '../resumoInvestimentos/build'
import type { ClassKey, ClassSummary } from './build'
import { pct, tone } from './fmt'

/** Coluna das classes: % do patrimônio, total e resultado; clicar escolhe a classe do painel. */
export function ClassList({ list, selected, onSelect }: { list: ClassSummary[]; selected: ClassKey | null; onSelect(k: ClassKey): void }) {
  const max = Math.max(1, ...list.map(c => c.valueCents))
  return (
    <div className="card cls-list" role="listbox" aria-label="Classes da carteira">
      {list.map(c => (
        <button key={c.key} role="option" aria-selected={c.key === selected} className={`cls-item ${c.key === selected ? 'on' : ''}`} onClick={() => onSelect(c.key)}>
          <span className="class-dot" style={{ background: classColor(c.key) }} />
          <span className="cls-name">{c.label} <span className="muted">{Math.round(c.pct * 100)}%</span></span>
          <span className="cls-tot">{formatCents(c.valueCents)}
            <small className={c.gainPct === null ? 'muted' : tone(c.gainPct)}>{c.gainPct === null ? (c.missingQuotes === c.count ? 'sem cotação' : 'sem aportado') : `${c.usdGain ? 'US$ ' : ''}${pct(c.gainPct)}`}</small></span>
          <span className="cls-bar" aria-hidden><i style={{ width: `${(c.valueCents / max) * 100}%`, background: classColor(c.key) }} /></span>
        </button>
      ))}
    </div>
  )
}
