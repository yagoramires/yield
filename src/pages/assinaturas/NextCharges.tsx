import type { Subscription } from '../../domain/assinaturas'
import { formatCents } from '../../domain/money'
import { cleanDescription } from '../lancamentos/build'
import { brDay } from '../lancamentos/GastosHeader'

const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** Cartões das próximas cobranças (Assinaturas e Resumo de gastos); a de hoje ou atrasada fica destacada. */
export function NextCharges({ list, today, three }: { list: Subscription[]; today: string; three?: boolean }) {
  return (
    <div className={`next-strip ${three ? 'three' : ''}`}>
      {list.map(s => (
        <div key={s.merchantKey} className={`next-c ${s.nextDate <= today ? 'now' : ''}`}>
          <div className="d">{s.nextDate === today ? 'Hoje' : s.nextDate < today ? 'Atrasada' : WEEKDAY[new Date(`${s.nextDate}T12:00:00`).getDay()]} · {brDay(s.nextDate)}</div>
          <div className="n">{cleanDescription(s.name).name}</div>
          <div className="v">{formatCents(s.amountCents)}</div>
        </div>
      ))}
    </div>
  )
}
