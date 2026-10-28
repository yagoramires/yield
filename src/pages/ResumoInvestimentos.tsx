import { Coins, Landmark, RefreshCw, Sprout, TrendingUp, Wallet } from 'lucide-react'
import { DARF_CODE } from '../domain/darf'
import { portfolioResult } from '../domain/portfolio'
import { addMonths, monthOf } from '../domain/money'
import { todayISO, useData } from '../state/DataProvider'
import { BarChart, LineChart } from '../ui/charts'
import { EyeToggle, useHideValues } from '../ui/HideValues'
import { summary, yieldOnCost } from './proventos/build'
import { spentByMonth } from './lancamentos/build'
import { brDay, monthName } from './lancamentos/GastosHeader'
import { Rentabilidade } from './resumoInvestimentos/Rentabilidade'
import { rfJurosByMonth } from '../domain/rendaFixa'
import { classColor, classLabel, dividendsByMonth, investedByMonth, passiveCoverage, topPositions } from './resumoInvestimentos/build'

const sign = (c: number, s: string) => (c > 0 ? `+${s}` : c < 0 ? `−${s.replace('-', '')}` : s)
const tone = (c: number | null) => (c === null || c === 0 ? '' : c > 0 ? 'up' : 'dn')
const pct1 = (p: number) => sign(p, `${(p * 100).toFixed(1).replace('.', ',')}%`)
const when = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}`
}
const monLabel = (m: string) => `${monthName(m).toLowerCase()}/${m.slice(2, 4)}`


export function ResumoInvestimentos({ onOpenCarteira, onOpenImposto, onOpenNotas, onOpenProventos, onOpenSettings }: {
  onOpenCarteira(): void; onOpenImposto(): void; onOpenNotas(): void; onOpenProventos(month: string): void; onOpenSettings(): void
}) {
  const { data, derived, refreshing, refreshQuotesNow, gastos } = useData()
  const { portfolio: p, darfs } = derived
  const { hidden, toggle, brl, cents, short } = useHideValues()
  const today = todayISO()
  const thisMonth = monthOf(today)
  const lastQuote = data.quotes.filter(q => q.source === 'yahoo').map(q => q.fetchedAt).sort().at(-1)

  const header = (
    <div className="bar">
      <div>
        <h1>Resumo</h1>
        <div className="muted">{lastQuote ? `Cotações do Yahoo de ${when(lastQuote)} (atraso de ~15 min)` : 'Sem cotações do Yahoo ainda'}</div>
      </div>
      <div className="btns"><EyeToggle hidden={hidden} toggle={toggle} /><button className="b ghost with-ico" disabled={refreshing} onClick={() => void refreshQuotesNow()}><RefreshCw size={13} aria-hidden />{refreshing ? 'Atualizando…' : 'Atualizar cotações'}</button></div>
    </div>
  )
  if (!data.trades.length && !data.manualAssets.length && !data.dividends.length && !data.rfMoves.length && !data.rfPositions.length && !data.cryptoBalances.length) {
    return (
      <>
        {header}
        <div className="card" style={{ marginTop: 12 }}>
          <b style={{ color: '#fff' }}>Ainda não há investimentos por aqui</b>
          <div className="muted" style={{ margin: '4px 0 10px' }}>Importe os relatórios da B3 em Configurações ou lance suas compras em Notas.</div>
          <div className="btns"><button className="b pri" onClick={onOpenSettings}>Ir para Configurações</button><button className="b ghost" onClick={onOpenNotas}>Abrir Notas</button></div>
        </div>
      </>
    )
  }

  // Mesmo cálculo da Carteira, para as duas telas nunca divergirem.
  const { gainCents: varTotal, baseCents: costQuoted } = portfolioResult(p)
  const avg12 = Math.round(p.dividends12mCents / 12)

  const due = darfs.rows.filter(r => r.status === 'a_vencer' || r.status === 'em_aberto' || r.status === 'pago_a_menor')
  const dueCents = (r: (typeof due)[number]) => (r.status === 'pago_a_menor' ? r.complementCents : r.darfCents)
  const dueTotal = due.reduce((s, r) => s + dueCents(r), 0)
  const nextDue = due.find(r => r.status !== 'pago_a_menor' && r.dueDate)
  const incomplete = darfs.rows.filter(r => r.incomplete)

  const invested = investedByMonth(data.trades, data.events, thisMonth, 24)
  const allQuoted = p.rows.length > 0 && p.missingQuotes.length === 0
  const todayValue = p.rows.reduce((s, r) => s + (r.valueCents ?? 0), 0)
  const lineLabels = invested.map(m => `${monthName(m.month).slice(0, 3).toLowerCase()}/${m.month.slice(2, 4)}`)
  const classes = [...p.byClass].sort((a, b) => b.valueCents - a.valueCents)
  const divs = dividendsByMonth(data.dividends, thisMonth, 12)
  const juros = rfJurosByMonth(data.rfMoves, thisMonth, 12)
  const juros12m = juros.reduce((s, m) => s + m.cents, 0)
  const top = topPositions(p, 5)
  // Meses fechados: o mês atual pela metade puxaria a média do gasto para baixo.
  const coverage = gastos.data.txns.length ? passiveCoverage(p.dividends12mCents + juros12m, spentByMonth(gastos.data.txns, gastos.categorize, addMonths(thisMonth, -1), 12).map(m => m.cents)) : null
  const yoc = yieldOnCost(summary(data.dividends, today).last12, p.rows.map(r => ({ ticker: r.ticker, costCents: r.costCents }))).total

  return (
    <>
      {header}
      {due.map(r => (
        <div key={r.month} className="alert-bad"><Landmark size={15} aria-hidden />
          <span>DARF de {monLabel(r.month)} {r.status === 'a_vencer' ? 'a vencer' : 'em aberto'}: {brl(dueCents(r))}{r.dueDate && ` · vence ${brDay(r.dueDate)}/${r.dueDate.slice(0, 4)}`} · código {DARF_CODE}</span>
          <button className="link" onClick={onOpenImposto}>Abrir Imposto</button>
        </div>
      ))}
      {incomplete.length > 0 && <div className="note" style={{ marginTop: 10 }}>Imposto incompleto em {incomplete.map(r => monLabel(r.month)).join(', ')}: faltam notas antes destas datas. <button className="link" onClick={onOpenImposto}>Abrir Imposto</button></div>}

      <div className="kpis">
        <div className="k"><div className="muted k-l"><Wallet size={12} aria-hidden />Patrimônio</div><div className="v">{brl(p.totalValueCents)}</div>
          <div className="s muted">aportado {brl(p.totalCostCents)}{p.missingQuotes.length > 0 && ` · sem cotação: ${p.missingQuotes.length} ${p.missingQuotes.length === 1 ? 'ativo' : 'ativos'}`}{p.noCostCount > 0 && ` · ${p.noCostCount} ${p.noCostCount === 1 ? 'item sem aportado' : 'itens sem aportado'}`}</div></div>
        <div className="k"><div className="muted k-l"><TrendingUp size={12} aria-hidden />Resultado</div><div className={`v ${tone(varTotal)}`}>{sign(varTotal, brl(varTotal))}</div>
          <div className={`s ${tone(varTotal)}`}>{costQuoted > 0 ? `${pct1(varTotal / costQuoted)} sobre o aportado` : '—'}</div></div>
        <div className="k"><div className="muted k-l"><Coins size={12} aria-hidden />Proventos 12 meses</div><div className="v">{brl(p.dividends12mCents)}</div>
          <div className="s muted">média {brl(avg12)}/mês{yoc !== null && ` · ${(yoc * 100).toFixed(1).replace('.', ',')}% sobre o custo`}</div></div>
        <div className="k"><div className="muted k-l"><Landmark size={12} aria-hidden />Imposto</div>
          <div className={`v ${dueTotal > 0 ? 'dn' : ''}`}>{dueTotal > 0 ? brl(dueTotal) : 'nada a pagar'}</div>
          <div className="s muted">{dueTotal > 0 ? (nextDue?.dueDate ? `DARF · vence ${brDay(nextDue.dueDate)}` : `DARF · código ${DARF_CODE}`) : 'nenhum DARF a vencer ou em aberto'}</div></div>
      </div>

      {coverage && (
        <div className="card coverage">
          <div className="bar"><h5 style={{ margin: 0 }} className="k-l"><Sprout size={14} aria-hidden style={{ color: 'var(--accent)' }} />Renda passiva</h5><span className="muted">últimos 12 meses</span></div>
          <div className="coverage-v"><b>{Math.round(coverage.pct * 100)}%</b> <span className="muted">do seu gasto médio já é pago pelos proventos{juros12m > 0 ? ' e juros da renda fixa' : ''}</span></div>
          <div className="meter big" aria-hidden><i style={{ width: `${Math.min(100, coverage.pct * 100)}%` }} /></div>
          <div className="muted">proventos {brl(coverage.avgDividendsCents)}/mês · gasto {brl(coverage.avgSpentCents)}/mês · {coverage.gapCents > 0 ? `faltam ${brl(coverage.gapCents)}/mês para cobrir tudo` : 'os proventos já cobrem todo o gasto'}</div>
        </div>
      )}

      <Rentabilidade trades={data.trades} events={data.events} dividends={data.dividends} thisMonth={thisMonth} />

      <div className="grid2">
        <div className="card">
          <h5 style={{ margin: 0 }}>Aportado × valor de hoje</h5>
          <LineChart
            series={[
              { label: 'aportado', values: invested.map(m => m.cents) },
              ...(allQuoted ? [{ label: 'valor de hoje', values: invested.map((_, i) => (i === invested.length - 1 ? todayValue : null)) }] : []),
            ]}
            xLabels={lineLabels} xTicks={[0, 6, 12, 18, 23]} tipTitle={i => lineLabels[i]} format={cents} tickFormat={short}
            ariaLabel={`Aportado em ações, FIIs, ETFs e BDRs: ${brl(invested[invested.length - 1].cents)} hoje${allQuoted ? `; valor de mercado ${brl(todayValue)}` : ''}`} />
          <div className="muted">
            A linha é o que você aportou em ações, FIIs, ETFs e BDRs (custo das compras menos o das vendas). O Yield não guarda cotações antigas, então o valor de mercado aparece só para hoje. Ativos manuais ficam de fora deste gráfico.
            {!allQuoted && p.missingQuotes.length > 0 && ` ${p.missingQuotes.length} ${p.missingQuotes.length === 1 ? 'ativo' : 'ativos'} sem cotação: o ponto de hoje não é mostrado.`}
          </div>
        </div>
        <div className="card">
          <div className="bar"><h5 style={{ margin: 0 }}>Por classe</h5><span className="muted">clique para abrir a Carteira</span></div>
          {classes.length === 0 ? <div className="muted" style={{ marginTop: 6 }}>Nenhum ativo com valor ainda.</div> : <>
            <div className="class-stack" aria-hidden>{classes.map(c => <i key={c.cls} style={{ width: `${(c.valueCents / p.totalValueCents) * 100}%`, background: classColor(c.cls) }} />)}</div>
            <div className="sum-rows">
              {classes.map(c => {
                const gain = c.costCents ? (c.valueCents - c.costCents) / c.costCents : null
                return (
                  <button key={c.cls} className="sum-row" onClick={onOpenCarteira}>
                    <span className="class-dot" style={{ background: classColor(c.cls) }} />
                    <span className="lmid"><span className="sum-name">{classLabel(c.cls)} <span className="muted">{pct1(c.valueCents / p.totalValueCents).replace('+', '')}</span></span></span>
                    <span className="sum-val">{cents(c.valueCents)}<small className={tone(gain)}>{gain === null ? 'sem aportado' : pct1(gain)}</small></span>
                  </button>
                )
              })}
            </div>
          </>}
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="bar"><h5 style={{ margin: 0 }}>Proventos por mês</h5><span className="muted">clique num mês para abrir em Proventos</span></div>
          <BarChart onSelect={i => onOpenProventos(divs[i].month)} selected={null} series={['Rendimento', 'Dividendo', 'JCP', 'Juros RF']} format={brl} valueLabel={short}
            ariaLabel={`Proventos por mês: ${divs.map((m, i) => `${monthName(m.month).toLowerCase()} ${brl(m.byKind.Rendimento + m.byKind.Dividendo + m.byKind.JCP + juros[i].cents)}`).join('; ')}`}
            bars={divs.map((m, i) => ({
              label: monthName(m.month).slice(0, 3).toLowerCase(), values: [m.byKind.Rendimento, m.byKind.Dividendo, m.byKind.JCP, juros[i].cents],
              partial: m.month === thisMonth, tip: `${monthName(m.month)} ${m.month.slice(0, 4)}${m.month === thisMonth ? ' até hoje' : ''}`,
            }))} />
        </div>
        <div className="card">
          <div className="bar"><h5 style={{ margin: 0 }}>Maiores posições</h5><span className="muted">clique para abrir a Carteira</span></div>
          {top.length === 0 ? <div className="muted" style={{ marginTop: 6 }}>Nenhuma posição com valor ainda.</div> : (
            <div className="sum-rows">
              {top.map(t => (
                <button key={`${t.manual}-${t.name}`} className="sum-row" onClick={onOpenCarteira}>
                  <span className="tk-av" style={{ background: `${classColor(t.clsKey)}22`, color: classColor(t.clsKey) }} aria-hidden>{t.name.slice(0, 4).toUpperCase()}</span>
                  <span className="lmid"><span className="sum-name">{t.name}</span><span className="muted">{t.manual ? t.cls : classLabel(t.cls)} · {pct1(t.pct).replace('+', '')} do patrimônio</span></span>
                  <span className="sum-val">{cents(t.valueCents)}<small className={tone(t.varPct)}>{t.varPct === null ? (t.manual ? 'à mão' : '—') : pct1(t.varPct)}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
