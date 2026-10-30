import { ArrowDownRight, ArrowUpRight, CircleHelp, PiggyBank, Target } from 'lucide-react'
import { Insights } from './assistente/Insights'
import type { Route } from '../ui/routes'
import { goalsFor } from '../domain/orcamento'
import { monthTotals } from '../domain/gastos'
import { addMonths, monthOf } from '../domain/money'
import { todayISO, useData } from '../state/DataProvider'
import { categoryLook, CategoryIcon, IconGlyph } from '../ui/CategoryIcon'
import { BarChart, LineChart } from '../ui/charts'
import { useHideValues } from '../ui/HideValues'
import { localStamp } from '../ui/SyncStatus'
import { barInfo, biggestChanges, budgetByCategory, nextCharges, spentByCategory } from './categorias/build'
import { categoryBars, cleanDescription, comparePreviousMonth, cutToDay, cumulativeByDay, monthForecast, NO_FILTER, spentByMonth, topSpending } from './lancamentos/build'
import { NextCharges } from './assinaturas/NextCharges'
import { brDay, GastosHeader, GastosVazio, monthName } from './lancamentos/GastosHeader'
import { monthProgress, spendingPlan } from './orcamento/build'
import { TINT } from '../ui/palette'

export function ResumoGastos({ onNavigate, onOpenLancamentos, onOpenAssinaturas, onOpenSettings }: { onNavigate(r: Route): void; onOpenLancamentos(): void; onOpenAssinaturas(): void; onOpenSettings(): void }) {
  const { gastos, orcamento } = useData()
  const { data, categorize: cat, month, setMonth, setFilter, subscriptions } = gastos
  const { brl, cents, short } = useHideValues()
  if (!data.txns.length) return <><GastosHeader title="Resumo" /><GastosVazio onOpenSettings={onOpenSettings} /></>

  const today = todayISO()
  const thisMonth = monthOf(today)
  const isCurrent = month === thisMonth
  const prev = addMonths(month, -1)
  const [cur, prevName] = [monthName(month).toLowerCase(), monthName(prev).toLowerCase()]
  const totals = monthTotals(data.txns, data.accounts, cat, month)
  const cmp = comparePreviousMonth(data.txns, cat, month, today)
  const diff = cmp.currentCents - cmp.previousSameDayCents
  const left = totals.incomeCents - totals.spentCents

  const lines = orcamento.data.lines.filter(l => l.month === month)
  const goalsOf = (m: string) => goalsFor(orcamento.data.goals, orcamento.data.months, m, data.categories)
  const planned = spendingPlan(lines, data.categories, goalsOf(month)).plannedCents
  const budget = budgetByCategory(orcamento.data.lines, goalsOf(month), month)
  const forecast = monthForecast(totals.spentCents, month, today)
  const progress = monthProgress(month, today)

  const curLine = cumulativeByDay(data.txns, cat, month)
  const prevLine = cumulativeByDay(data.txns, cat, prev)
  const n = Math.max(curLine.length, prevLine.length)
  const curShown = isCurrent ? curLine.map((v, i) => (i < cmp.day ? v : null)) : curLine
  const open = (f: Partial<typeof NO_FILTER>) => { setFilter({ ...NO_FILTER, ...f }); onOpenLancamentos() }
  // A janela fica nos 6 meses até hoje; só anda para trás quando o mês escolhido sai dela.
  const months = spentByMonth(data.txns, cat, month < addMonths(thisMonth, -5) ? addMonths(month, 5) : thisMonth, 6)
  const top = topSpending(data.txns, cat, month, 5)
  const sem = totals.byCategory.find(b => !b.category)
  const semCount = data.txns.filter(t => monthOf(t.date) === month && t.amountCents < 0 && cat(t) === null).length
  const soon = nextCharges(subscriptions, today).list.slice(0, 3)
  const byId = new Map(data.categories.map(c => [c.id, c]))
  const plannedFor = (m: string) => spendingPlan(orcamento.data.lines.filter(l => l.month === m), data.categories, goalsOf(m)).plannedCents
  // No mês atual compara com o anterior até o mesmo dia; senão um mês pela metade pareceria sempre mais barato.
  const prevTxns = isCurrent ? cutToDay(data.txns, prev, cmp.day) : data.txns
  const spendMap = (txns: typeof data.txns, m: string) => new Map(spentByCategory(txns, data.accounts, cat, data.categories, m).flatMap(r => (r.category && r.countsAsSpending ? [[r.category.id, r.cents] as const] : [])))
  const changes = biggestChanges(spendMap(data.txns, month), spendMap(prevTxns, prev), 2)

  return (
    <>
      <GastosHeader title="Resumo" />
      {sem && sem.cents > 0 && (
        <div className="sem-alert" style={{ marginTop: 12 }}><CircleHelp size={15} aria-hidden />
          <span>{brl(sem.cents)} em {semCount === 1 ? '1 compra' : `${semCount} compras`} sem categoria — os números ficam mais certos depois de categorizar</span>
          <button className="link" onClick={() => open({ categoryId: 'sem' })}>Categorizar</button>
        </div>
      )}
      <Insights area="gastos" month={month} onNavigate={onNavigate} />
      <div className="kpis">
        <div className="k"><div className="muted k-l"><ArrowDownRight size={12} aria-hidden />Gasto no mês</div><div className="v">{brl(totals.spentCents)}</div>
          <div className="s muted">{diff === 0 ? `igual a ${prevName}` : <><span className={diff > 0 ? 'dn' : 'up'}>{diff > 0 ? '▲' : '▼'} {brl(Math.abs(diff))}</span> a {diff > 0 ? 'mais' : 'menos'} que {prevName}</>} até o dia {cmp.day}</div></div>
        <div className="k"><div className="muted k-l"><ArrowUpRight size={12} aria-hidden />Entradas</div><div className="v up">{brl(totals.incomeCents)}</div><div className="s muted">receita do mês</div></div>
        <div className="k"><div className="muted k-l"><PiggyBank size={12} aria-hidden />Sobrou</div><div className={`v ${left < 0 ? 'dn' : ''}`}>{brl(left)}</div>
          <div className="s muted">{totals.incomeCents > 0 ? `${Math.round((left / totals.incomeCents) * 100)}% do que entrou` : 'entradas − gasto'}</div></div>
        <div className="k"><div className="muted k-l"><Target size={12} aria-hidden />Orçamento</div>
          {planned > 0 ? <>
            <div className="v">{brl(totals.spentCents)} <span className="k-of">de {cents(planned)}</span></div>
            <div className="meter" aria-hidden><i style={{ width: `${Math.min(100, (totals.spentCents / planned) * 100)}%`, background: totals.spentCents > planned ? 'var(--negative)' : undefined }} />{isCurrent && <b style={{ left: `${progress * 100}%` }} />}</div>
            <div className="s muted">{forecast !== null ? <>no ritmo atual fecha em <b className={forecast > planned ? 'dn' : ''}>{brl(forecast)}</b> · traço = hoje</> : totals.spentCents > planned ? `passou ${brl(totals.spentCents - planned)}` : `sobraram ${brl(planned - totals.spentCents)}`}</div>
          </> : <>
            <div className="v muted-v">sem orçamento</div>
            <div className="s muted">{forecast !== null ? <>no ritmo atual {cur} fecha em <b>{brl(forecast)}</b></> : `nenhum orçamento para ${cur}`}</div>
          </>}
        </div>
      </div>

      {(() => {
        // saldo como a Pluggy informou na última sincronização; conta importada por arquivo não tem saldo
        // só contas de bancos ainda conectados: as de um banco removido ficam no banco de dados com o saldo antigo
        const live = data.accounts.filter(a => a.source !== 'pluggy' || data.pluggyItems.some(i => i.itemId === a.itemId))
        const contas = live.filter(a => a.kind === 'conta'), cartoes = live.filter(a => a.kind === 'cartao' && a.balanceCents != null)
        const withBal = contas.filter(a => a.balanceCents != null)
        if (!withBal.length && !cartoes.length) return null
        const at = withBal.map(a => a.balanceAt).filter(Boolean).sort().at(-1)
        const row = (a: typeof data.accounts[number], cartao: boolean) => (
          <div key={a.id} className="bal-row">
            <IconGlyph name={cartao ? 'credit-card' : 'landmark'} color={cartao ? TINT.cinza : TINT.azul} size={26} />
            <span className="grow"><b>{a.institution}</b><small>{a.name}{cartao ? ' · fatura em aberto' : ''}</small></span>
            <span className={`r${cartao ? ' t2' : (a.balanceCents ?? 0) < 0 ? ' dn' : ''}`}>{a.balanceCents == null ? <span className="muted">sem saldo</span> : brl(cartao ? -a.balanceCents : a.balanceCents)}</span>
          </div>
        )
        return (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="bar"><h5 style={{ margin: 0 }}>Saldo nas contas</h5><span className="muted">{at ? `atualizado ${localStamp(at)}` : ''}</span></div>
            <div className="bal-total">{brl(withBal.reduce((s, a) => s + (a.balanceCents ?? 0), 0))}<span className="muted"> em {withBal.length === 1 ? '1 conta' : `${withBal.length} contas`}</span></div>
            <div className="bal-list">{contas.map(a => row(a, false))}{cartoes.map(a => row(a, true))}</div>
          </div>
        )
      })()}

      {changes.length > 0 && (
        <div className="card changes">
          <div className="bar"><h5 style={{ margin: 0 }}>O que mais mudou vs {prevName}{isCurrent ? ` até o dia ${cmp.day}` : ''}</h5><span className="muted">clique para ver os lançamentos</span></div>
          <div className="change-chips">
            {changes.map(ch => {
              const c = byId.get(ch.id) ?? null
              return (
                <button key={ch.id} className="change-chip" onClick={() => open({ categoryId: ch.id })}>
                  <CategoryIcon category={c} size={22} />{c?.name ?? ch.id}
                  <b className={ch.deltaCents > 0 ? 'dn' : 'up'}>{ch.deltaCents > 0 ? '▲' : '▼'} {brl(Math.abs(ch.deltaCents))}</b>
                  {ch.pct !== null && <span className="muted">{ch.pct > 0 ? '+' : '−'}{Math.round(Math.abs(ch.pct) * 100)}%</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid2">
        <div className="card stretch">
          <div className="bar"><h5 style={{ margin: 0 }}>Gasto acumulado no mês</h5><span className="muted">tracejado = {prevName}</span></div>
          <LineChart fill
            series={[{ label: cur, values: curShown }, { label: prevName, values: prevLine, dashed: true }]}
            xLabels={Array.from({ length: n }, (_, i) => String(i + 1))} xTicks={[0, 10, 20, n - 1]} tipTitle={i => `dia ${i + 1}`}
            marker={isCurrent ? cmp.day - 1 : undefined} format={cents} tickFormat={short}
            ariaLabel={`Gasto acumulado: ${cur} ${brl(cmp.currentCents)} até o dia ${cmp.day}; ${prevName} ${brl(cmp.previousSameDayCents)} no mesmo dia e ${brl(prevLine[prevLine.length - 1])} no fim do mês`} />
        </div>
        <div className="card">
          <div className="bar"><h5 style={{ margin: 0 }}>Por categoria</h5><span className="muted">clique para ver os lançamentos</span></div>
          {totals.byCategory.length === 0 ? <div className="muted" style={{ marginTop: 6 }}>Nenhum gasto neste mês.</div> : (
            <div className="sum-rows">
              {categoryBars(totals.byCategory, 5).map(b => {
                const c = b.categoryId && b.categoryId !== 'sem' ? byId.get(b.categoryId) ?? null : null
                const look = b.categoryId === null ? { id: 'outros', icon: null, color: null } : c
                const info = barInfo(b.cents, c ? budget.get(c.id) : undefined, totals.spentCents)
                const go = b.categoryId === null ? undefined : () => open({ categoryId: b.categoryId })
                return (
                  <button key={b.categoryId ?? 'outras'} className="sum-row" disabled={!go} onClick={go}>
                    <CategoryIcon category={look} size={28} />
                    <span className="lmid"><span className="sum-name">{b.label}</span>
                      <span className="tile-bar"><i style={{ width: `${info.pct}%`, background: info.over ? 'var(--negative)' : categoryLook(look).color }} /></span>
                      <span className={`sum-cap ${info.over ? 'dn' : ''}`}>{b.categoryId === 'sem' ? `${semCount} ${semCount === 1 ? 'compra' : 'compras'}` : info.caption}</span></span>
                    <span className="sum-val">{cents(b.cents)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="card stretch">
          <div className="bar"><h5 style={{ margin: 0 }}>Gasto por mês</h5><span className="muted">clique num mês para ver o resumo dele{months.some(m => plannedFor(m.month) > 0) ? ' · traço = orçamento' : ''}{months.some(m => m.month === thisMonth) ? ` · ${monthName(thisMonth).toLowerCase()} até hoje (listrado)` : ''}</span></div>
          <BarChart fill format={brl} valueLabel={short} selected={months.some(m => m.month === month) ? months.findIndex(m => m.month === month) : null} onSelect={i => setMonth(months[i].month)} ariaLabel={`Gasto por mês: ${months.map(m => `${monthName(m.month).toLowerCase()} ${brl(m.cents)}`).join('; ')}`}
            bars={months.map(m => {
              const partial = m.month === thisMonth
              const target = plannedFor(m.month) || undefined
              return { label: monthName(m.month).slice(0, 3).toLowerCase(), values: [m.cents], partial, target, tip: `${monthName(m.month)} ${m.month.slice(0, 4)}${partial ? ' até hoje' : ''}` }
            })} />
        </div>
        <div className="card">
          <div className="bar"><h5 style={{ margin: 0 }}>Maiores gastos do mês</h5><span className="muted">clique para ver em Lançamentos</span></div>
          {top.length === 0 ? <div className="muted" style={{ marginTop: 6 }}>Nenhum gasto neste mês.</div> : (
            <div className="sum-rows">
              {top.map(t => {
                const c = cat(t)
                return (
                  <button key={t.id} className="sum-row" onClick={() => open({ search: t.description })}>
                    <CategoryIcon category={c} size={28} />
                    <span className="lmid"><span className="sum-name" title={t.description}>{cleanDescription(t.description).name}</span><span className="muted">{c?.name ?? 'Sem categoria'} · {brDay(t.date)}{t.pending ? ' · pendente' : ''}</span></span>
                    <span className="sum-val">−{cents(-t.amountCents)}</span>
                  </button>
                )
              })}
            </div>
          )}
          {soon.length > 0 && <>
            <div className="bar" style={{ marginTop: 12 }}><h5 style={{ margin: 0 }}>Próximas cobranças</h5><button className="link muted" onClick={onOpenAssinaturas}>assinaturas</button></div>
            <NextCharges list={soon} today={today} three format={cents} />
          </>}
        </div>
      </div>
      <div className="muted" style={{ marginTop: 8 }}>Pagamento de fatura, transferências e investimentos não entram no gasto.</div>
    </>
  )
}
