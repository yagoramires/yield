import { Coins, Landmark, RefreshCw, Sprout, TrendingUp, Wallet } from 'lucide-react'
import { DARF_CODE } from '../domain/darf'
import { portfolioResult } from '../domain/portfolio'
import { addMonths, monthOf } from '../domain/money'
import { todayISO, useData } from '../state/DataProvider'
import { BarChart, LineChart } from '../ui/charts'
import { useHideValues } from '../ui/HideValues'
import { summary, yieldOnCost } from './proventos/build'
import { spentByMonth } from './lancamentos/build'
import { brDay, monthName } from './lancamentos/GastosHeader'
import { Rentabilidade } from './resumoInvestimentos/Rentabilidade'
import { rfAppliedByMonth, rfJurosByMonth } from '../domain/rendaFixa'
import { reinvested } from '../domain/reinvestimento'
import { carteiraClasses } from './carteira/build'
import { pct as pct1, sign, tone, when } from './carteira/fmt'
import { classColor, classLabel, dividendsByMonth, investedByMonth, moneyBuckets, passiveCoverage, topPositions } from './resumoInvestimentos/build'

const monLabel = (m: string) => `${monthName(m).toLowerCase()}/${m.slice(2, 4)}`


export function ResumoInvestimentos({ onOpenCarteira, onOpenImposto, onOpenNotas, onOpenProventos, onOpenSettings }: {
  onOpenCarteira(cls?: string): void; onOpenImposto(): void; onOpenNotas(): void; onOpenProventos(month: string): void; onOpenSettings(): void
}) {
  const { data, derived, refreshing, refreshQuotesNow, gastos } = useData()
  const { portfolio: p, darfs } = derived
  const { hidden, brl, cents, short } = useHideValues()
  const today = todayISO()
  const thisMonth = monthOf(today)
  const lastQuote = data.quotes.filter(q => q.source === 'yahoo').map(q => q.fetchedAt).sort().at(-1)

  const header = (
    <div className="bar">
      <div>
        <h1>Resumo</h1>
        <div className="muted">{lastQuote ? `Cotações do Yahoo de ${when(lastQuote)} (atraso de ~15 min)` : 'Sem cotações do Yahoo ainda'}</div>
      </div>
      <div className="btns"><button className="b ghost with-ico" disabled={refreshing} onClick={() => void refreshQuotesNow()}><RefreshCw size={13} aria-hidden />{refreshing ? 'Atualizando…' : 'Atualizar cotações'}</button></div>
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

  // Valorização: mesmo cálculo da Carteira; o Resultado daqui soma ainda os proventos dos ativos em carteira (abaixo).
  const { gainCents: varTotal, baseCents: costQuoted } = portfolioResult(p)
  const avg12 = Math.round(p.dividends12mCents / 12)

  const due = darfs.rows.filter(r => r.status === 'a_vencer' || r.status === 'em_aberto' || r.status === 'pago_a_menor')
  const dueCents = (r: (typeof due)[number]) => (r.status === 'pago_a_menor' ? r.complementCents : r.darfCents)
  const dueTotal = due.reduce((s, r) => s + dueCents(r), 0)
  const nextDue = due.find(r => r.status !== 'pago_a_menor' && r.dueDate)
  const incomplete = darfs.rows.filter(r => r.incomplete)

  // ETF de renda fixa sai da linha da bolsa e soma na da renda fixa
  // proventos reinvestidos (caixinha que paga as próximas compras) não saíram do bolso; o resultado conta todo provento recebido
  // Mesma base do custo (posições abertas hoje): o reinvestido nunca passa do custo cotado, e o resultado soma só os proventos
  // dos ativos ainda em carteira (o lucro ou prejuízo de quem já foi vendido não está aqui, então os proventos dele também não).
  const held = new Set(p.rows.filter(r => r.valueCents !== null).map(r => r.ticker))
  const rv = reinvested(data.trades, data.dividends, todayISO())
  const heldDividends = data.dividends.filter(d => held.has(d.ticker)).reduce((s, d) => s + d.amountCents, 0)
  const reinvest = data.proventos === 'reinvisto' ? Math.min(rv.reinvestedCents, costQuoted) : 0
  const fromPocket = Math.max(0, p.totalCostCents - reinvest)
  const gain = varTotal + heldDividends, gainBase = Math.max(0, costQuoted - reinvest)
  const invested = investedByMonth(data.trades.filter(t => t.assetType !== 'ETF RF'), data.events, thisMonth, 24)
    .map(m => ({ ...m, cents: data.proventos === 'reinvisto' ? Math.max(0, m.cents - Math.min(m.cents, reinvested(data.trades, data.dividends, `${m.month}-31`).reinvestedCents)) : m.cents }))
  const etfRf = investedByMonth(data.trades.filter(t => t.assetType === 'ETF RF'), data.events, thisMonth, 24)
  const rfApplied = rfAppliedByMonth(data.rfMoves, thisMonth, 24).map((m, i) => ({ ...m, cents: m.cents + etfRf[i].cents }))
  const hasRf = rfApplied.some(m => m.cents > 0)
  const allQuoted = p.totalValueCents > 0 && p.missingQuotes.length === 0
  // o ponto de hoje é o patrimônio inteiro (inclui exterior, cripto e dólar, que não têm histórico)
  const todayValue = p.totalValueCents
  const buckets = moneyBuckets(p, { cryptoAt: data.cryptoBalances.find(c => c.qty > 0)?.fetchedAt ?? null, dollarCents: data.quotes.find(q => q.symbol === 'BRL=X')?.priceCents ?? null })
  const lineLabels = invested.map(m => `${monthName(m.month).slice(0, 3).toLowerCase()}/${m.month.slice(2, 4)}`)
  // mesmas classes e contas da Carteira
  const classes = carteiraClasses(p).filter(c => c.valueCents > 0)
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
      {incomplete.length > 0 && <div className="note" style={{ marginTop: 10 }}>Imposto incompleto em {incomplete.map(r => monLabel(r.month)).join(', ')}: faltam notas antes destas datas. Compras de antes do relatório da B3 entram em <button className="link" onClick={onOpenNotas}>Notas › Operação sem nota</button>. <button className="link" onClick={onOpenImposto}>Abrir Imposto</button></div>}

      <div className="kpis">
        <div className="k"><div className="muted k-l"><Wallet size={12} aria-hidden />Patrimônio</div><div className="v">{brl(p.totalValueCents)}</div>
          <div className="s muted">{reinvest > 0 ? `do seu bolso ${brl(fromPocket)} · ${brl(reinvest)} de proventos reinvestidos` : `aportado ${brl(p.totalCostCents)}`}{p.missingQuotes.length > 0 && ` · sem cotação: ${p.missingQuotes.length} ${p.missingQuotes.length === 1 ? 'ativo' : 'ativos'}`}{p.noCostCount > 0 && ` · ${p.noCostCount} ${p.noCostCount === 1 ? 'item sem aportado' : 'itens sem aportado'}`}</div></div>
        <div className="k"><div className="muted k-l"><TrendingUp size={12} aria-hidden />Resultado</div><div className={`v ${tone(gain)}`}>{sign(gain, brl(gain))}</div>
          <div className={`s ${tone(gain)}`}>{gainBase > 0 ? `${pct1(gain / gainBase)} sobre ${reinvest > 0 ? 'o que saiu do bolso' : 'o aportado'}` : '—'}</div>
          <div className="s muted">valorização {sign(varTotal, brl(varTotal))} · proventos {sign(heldDividends, brl(heldDividends))}</div></div>
        <div className="k"><div className="muted k-l"><Coins size={12} aria-hidden />Proventos 12 meses</div><div className="v">{brl(p.dividends12mCents)}</div>
          <div className="s muted">média {brl(avg12)}/mês{yoc !== null && ` · ${(yoc * 100).toFixed(1).replace('.', ',')}% sobre o custo`}</div></div>
        <div className="k"><div className="muted k-l"><Landmark size={12} aria-hidden />Imposto</div>
          <div className={`v ${dueTotal > 0 ? 'dn' : ''}`}>{dueTotal > 0 ? brl(dueTotal) : 'nada a pagar'}</div>
          <div className="s muted">{dueTotal > 0 ? (nextDue?.dueDate ? `DARF · vence ${brDay(nextDue.dueDate)}` : `DARF · código ${DARF_CODE}`) : 'nenhum DARF a vencer ou em aberto'}</div></div>
      </div>

      {buckets.length > 1 && (
        <div className="buckets" role="group" aria-label="Onde está seu dinheiro">
          {buckets.map(b => (
            <button key={b.key} className="bk" onClick={() => onOpenCarteira(b.key)}>
              <span className="bk-h"><span className="class-dot" style={{ background: classColor(b.key === 'bolsa' ? 'Ação' : b.key) }} />{b.label}</span>
              <span className="bk-v">{brl(b.valueCents)}</span>
              <span className={`bk-s ${b.gainPct === null ? 'muted' : tone(b.gainCents)}`}>{b.gainPct === null ? 'sem aportado' : b.usdGain ? `US$ ${pct1(b.gainPct)}` : `${sign(b.gainCents!, brl(b.gainCents!))} · ${pct1(b.gainPct)}`}</span>
              <span className="bk-m" aria-hidden><i style={{ width: `${Math.max(2, b.pct * 100)}%`, background: classColor(b.key === 'bolsa' ? 'Ação' : b.key) }} /></span>
              <span className="muted bk-n">{Math.round(b.pct * 100)}% · {hidden && b.key === 'exterior' ? 'US$ •••••' : b.note}</span>
            </button>
          ))}
        </div>
      )}

      {coverage && (
        <div className="card coverage">
          <div className="bar"><h5 style={{ margin: 0 }} className="k-l"><Sprout size={14} aria-hidden style={{ color: 'var(--accent)' }} />Renda passiva</h5><span className="muted">últimos 12 meses</span></div>
          <div className="coverage-v"><b>{Math.round(coverage.pct * 100)}%</b> <span className="muted">do seu gasto médio já é pago pelos proventos{juros12m > 0 ? ' e juros da renda fixa' : ''}</span></div>
          <div className="meter big split" aria-hidden>
            <i style={{ width: `${Math.min(100, (p.dividends12mCents / 12 / coverage.avgSpentCents) * 100)}%` }} />
            {juros12m > 0 && <i className="juros" style={{ width: `${Math.max(0, Math.min(100 - (p.dividends12mCents / 12 / coverage.avgSpentCents) * 100, (juros12m / 12 / coverage.avgSpentCents) * 100))}%` }} />}
          </div>
          <div className="muted">proventos {brl(Math.round(p.dividends12mCents / 12))}/mês{juros12m > 0 && ` · juros da renda fixa ${brl(Math.round(juros12m / 12))}/mês`} · gasto {brl(coverage.avgSpentCents)}/mês · {coverage.gapCents > 0 ? `faltam ${brl(coverage.gapCents)}/mês para cobrir tudo` : 'a renda passiva já cobre todo o gasto'}</div>
        </div>
      )}

      <Rentabilidade trades={data.trades.filter(t => t.assetType !== 'ETF RF')} events={data.events} dividends={data.dividends} thisMonth={thisMonth} />

      <div className="grid2">
        <div className="card stretch">
          <h5 style={{ margin: 0 }}>Aportado × valor de hoje</h5>
          <LineChart fill
            series={[
              { label: data.proventos === 'reinvisto' ? 'bolsa, do seu bolso' : 'bolsa', values: invested.map(m => m.cents) },
              ...(hasRf ? [{ label: 'bolsa + renda fixa', values: invested.map((m, i) => m.cents + rfApplied[i].cents) }] : []),
              ...(allQuoted ? [{ label: 'valor de hoje', values: invested.map((_, i) => (i === invested.length - 1 ? todayValue : null)) }] : []),
            ]}
            xLabels={lineLabels} xTicks={[0, 6, 12, 18, 23]} tipTitle={i => lineLabels[i]} format={cents} tickFormat={short}
            ariaLabel={`Aportado na bolsa: ${brl(invested[invested.length - 1].cents)}${hasRf ? `; com a renda fixa: ${brl(invested[invested.length - 1].cents + rfApplied[rfApplied.length - 1].cents)}` : ''}${allQuoted ? `; patrimônio hoje ${brl(todayValue)}` : ''}`} />
          <div className="muted">
            As linhas são o que está aportado na bolsa (ações, FIIs, ETFs e BDRs){data.proventos === 'reinvisto' ? ', sem os proventos reinvestidos, que não saíram do seu bolso' : ''}{hasRf ? ' e, somada, a renda fixa aplicada' : ''}, mês a mês. O ponto de hoje é o patrimônio inteiro, com exterior, cripto e dólar, que não têm histórico no Yield.
            {!allQuoted && p.missingQuotes.length > 0 && ` ${p.missingQuotes.length} ${p.missingQuotes.length === 1 ? 'ativo' : 'ativos'} sem cotação: o ponto de hoje não é mostrado.`}
          </div>
        </div>
        <div className="card">
          <div className="bar"><h5 style={{ margin: 0 }}>Por classe</h5><span className="muted">clique para abrir a Carteira</span></div>
          {classes.length === 0 ? <div className="muted" style={{ marginTop: 6 }}>Nenhum ativo com valor ainda.</div> : <>
            <div className="class-stack" aria-hidden>{classes.map(c => <i key={c.key} style={{ width: `${c.pct * 100}%`, background: classColor(c.key) }} />)}</div>
            <div className="sum-rows">
              {classes.map(c => (
                <button key={c.key} className="sum-row" onClick={() => onOpenCarteira(c.key)}>
                  <span className="class-dot" style={{ background: classColor(c.key) }} />
                  <span className="lmid"><span className="sum-name">{c.label} <span className="muted">{pct1(c.pct).replace('+', '')}</span></span></span>
                  <span className="sum-val">{cents(c.valueCents)}<small className={tone(c.gainPct)}>{c.gainPct === null ? 'sem aportado' : `${c.usdGain ? 'US$ ' : ''}${pct1(c.gainPct)}`}</small></span>
                </button>
              ))}
            </div>
          </>}
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="card stretch">
          <div className="bar"><h5 style={{ margin: 0 }}>Proventos por mês</h5><span className="muted">clique num mês para abrir em Proventos</span></div>
          <BarChart fill onSelect={i => onOpenProventos(divs[i].month)} selected={null} series={['Rendimento', 'Dividendo', 'JCP', 'Juros RF']} format={brl} valueLabel={short}
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
                <button key={`${t.manual}-${t.name}`} className="sum-row" onClick={() => onOpenCarteira(t.clsKey)}>
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
