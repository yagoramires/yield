import { monthTotals } from '../domain/gastos'
import { addMonths, formatBRL, formatCents, monthOf } from '../domain/money'
import { todayISO, useData } from '../state/DataProvider'
import { BarChart, HBars, LineChart } from '../ui/charts'
import { categoryBars, comparePreviousMonth, cumulativeByDay, NO_FILTER, spentByMonth, topSpending } from './lancamentos/build'
import { accountLabel, brDay, GastosHeader, GastosVazio, monthName } from './lancamentos/GastosHeader'

export function ResumoGastos({ onOpenLancamentos, onOpenSettings }: { onOpenLancamentos(): void; onOpenSettings(): void }) {
  const { gastos } = useData()
  const { data, categorize: cat, month, filter, setFilter } = gastos
  if (!data.txns.length) return <><GastosHeader title="Resumo" /><GastosVazio onOpenSettings={onOpenSettings} /></>

  const today = todayISO()
  const isCurrent = month === monthOf(today)
  const prev = addMonths(month, -1)
  const [cur, prevName] = [monthName(month).toLowerCase(), monthName(prev).toLowerCase()]
  const totals = monthTotals(data.txns, data.accounts, cat, month)
  const cmp = comparePreviousMonth(data.txns, cat, month, today)
  const diff = cmp.currentCents - cmp.previousSameDayCents
  const left = totals.incomeCents - totals.spentCents

  const curLine = cumulativeByDay(data.txns, cat, month)
  const prevLine = cumulativeByDay(data.txns, cat, prev)
  const n = Math.max(curLine.length, prevLine.length)
  const curShown = isCurrent ? curLine.map((v, i) => (i < cmp.day ? v : null)) : curLine
  const accounts = new Map(data.accounts.map(a => [a.id, a]))
  const open = (f: Partial<typeof NO_FILTER>) => { setFilter({ ...NO_FILTER, ...f }); onOpenLancamentos() }
  const months = spentByMonth(data.txns, cat, month, 6)
  const top = topSpending(data.txns, cat, month, 5)

  return (
    <>
      <GastosHeader title="Resumo" />
      <div className="kpis">
        <div className="k"><div className="muted">Gasto no mês</div><div className="v">{formatBRL(totals.spentCents)}</div>
          <div className="s muted">{diff === 0 ? `igual a ${prevName}` : `${formatBRL(Math.abs(diff))} a ${diff > 0 ? 'mais' : 'menos'} que ${prevName}`} até o dia {cmp.day}</div></div>
        <div className="k"><div className="muted">Entradas</div><div className="v">{formatBRL(totals.incomeCents)}</div></div>
        <div className="k"><div className="muted">Sobrou</div><div className={`v ${left > 0 ? 'up' : left < 0 ? 'dn' : ''}`}>{formatBRL(left)}</div><div className="s muted">entradas − gasto</div></div>
      </div>

      <div className="grid2" style={{ gridTemplateColumns: '1.15fr 1fr' }}>
        <div className="card">
          <h5 style={{ margin: 0 }}>Gasto acumulado no mês</h5>
          <LineChart
            series={[{ label: cur, values: curShown }, { label: prevName, values: prevLine, dashed: true }]}
            xLabels={Array.from({ length: n }, (_, i) => String(i + 1))} xTicks={[0, 10, 20, n - 1]} tipTitle={i => `dia ${i + 1}`}
            marker={isCurrent ? cmp.day - 1 : undefined} format={formatCents}
            ariaLabel={`Gasto acumulado: ${cur} ${formatBRL(cmp.currentCents)} até o dia ${cmp.day}; ${prevName} ${formatBRL(cmp.previousSameDayCents)} no mesmo dia e ${formatBRL(prevLine[prevLine.length - 1])} no fim do mês`} />
          <div className="muted">Passe o mouse para ver cada dia. A linha tracejada é {prevName}.</div>
        </div>
        <div className="card">
          <div className="bar"><h5 style={{ margin: 0 }}>Por categoria</h5><span className="muted">clique para filtrar a lista</span></div>
          <div style={{ marginTop: 6 }}>
            {totals.byCategory.length === 0 ? <div className="muted">Nenhum gasto neste mês.</div> : (
              <HBars ariaLabel={`Gasto por categoria em ${cur}`} format={formatCents}
                rows={categoryBars(totals.byCategory, 6).map(b => ({
                  label: b.label, cents: b.cents, striped: b.categoryId === 'sem', warn: b.categoryId === 'sem',
                  selected: b.categoryId !== null && filter.categoryId === b.categoryId,
                  onClick: b.categoryId === null ? undefined : () => open({ categoryId: b.categoryId }),
                }))} />
            )}
          </div>
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="bar"><h5 style={{ margin: 0 }}>Gasto por mês</h5>{months.some(m => m.month === monthOf(today)) && <span className="muted">{monthName(monthOf(today)).toLowerCase()} até hoje (listrado)</span>}</div>
          <BarChart format={formatBRL} ariaLabel={`Gasto por mês: ${months.map(m => `${monthName(m.month).toLowerCase()} ${formatBRL(m.cents)}`).join('; ')}`}
            bars={months.map(m => {
              const partial = m.month === monthOf(today)
              return { label: monthName(m.month).slice(0, 3).toLowerCase(), values: [m.cents], partial, tip: `${monthName(m.month)} ${m.month.slice(0, 4)}${partial ? ' até hoje' : ''}` }
            })} />
        </div>
        <div className="card">
          <div className="bar"><h5 style={{ margin: 0 }}>Maiores gastos do mês</h5><span className="muted">clique para ver em Lançamentos</span></div>
          {top.length === 0 ? <div className="muted" style={{ marginTop: 6 }}>Nenhum gasto neste mês.</div> : (
            <table className="txn" style={{ marginTop: 4 }}>
              <tbody>
                {top.map(t => (
                  <tr key={t.id} className="clk" tabIndex={0} onClick={() => open({ search: t.description })} onKeyDown={e => e.key === 'Enter' && open({ search: t.description })}>
                    <td><div className="d1">{t.description}</div>
                      <div className="d2">{[brDay(t.date), accountLabel(accounts.get(t.accountId)), cat(t)?.name ?? 'Sem categoria', t.pending && 'pendente'].filter(Boolean).join(' · ')}</div></td>
                    <td className="r">−{formatCents(-t.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="muted" style={{ marginTop: 8 }}>Pagamento de fatura, transferências e investimentos não entram no gasto.</div>
    </>
  )
}
