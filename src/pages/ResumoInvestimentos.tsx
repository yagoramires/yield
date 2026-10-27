import { DARF_CODE } from '../domain/darf'
import { formatBRL, formatCents, monthOf } from '../domain/money'
import { todayISO, useData } from '../state/DataProvider'
import { BarChart, HBars, LineChart } from '../ui/charts'
import { brDay, monthName } from './lancamentos/GastosHeader'
import { classLabel, dividendsByMonth, investedByMonth, topPositions } from './resumoInvestimentos/build'

const sign = (c: number, s: string) => (c > 0 ? `+${s}` : c < 0 ? `−${s.replace('-', '')}` : s)
const tone = (c: number | null) => (c === null || c === 0 ? '' : c > 0 ? 'up' : 'dn')
const pct1 = (p: number) => sign(p, `${(p * 100).toFixed(1).replace('.', ',')}%`)
const when = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}`
}
const monLabel = (m: string) => `${monthName(m).toLowerCase()}/${m.slice(2, 4)}`

export function ResumoInvestimentos({ onOpenCarteira, onOpenImposto, onOpenNotas, onOpenSettings }: {
  onOpenCarteira(): void; onOpenImposto(): void; onOpenNotas(): void; onOpenSettings(): void
}) {
  const { data, derived, refreshing, refreshQuotesNow } = useData()
  const { portfolio: p, darfs } = derived
  const today = todayISO()
  const thisMonth = monthOf(today)
  const lastQuote = data.quotes.filter(q => q.source === 'yahoo').map(q => q.fetchedAt).sort().at(-1)

  const header = (
    <div className="bar">
      <div>
        <h1>Resumo</h1>
        <div className="muted">{lastQuote ? `Cotações do Yahoo de ${when(lastQuote)} (atraso de ~15 min)` : 'Sem cotações do Yahoo ainda'}</div>
      </div>
      <div className="btns"><button className="b ghost" disabled={refreshing} onClick={() => void refreshQuotesNow()}>{refreshing ? 'Atualizando…' : '↻ Atualizar cotações'}</button></div>
    </div>
  )
  if (!data.trades.length && !data.manualAssets.length && !data.dividends.length) {
    return (
      <>
        {header}
        <div className="card" style={{ marginTop: 12 }}>
          <b style={{ color: '#fff' }}>Ainda não há investimentos por aqui</b>
          <div className="muted" style={{ margin: '4px 0 10px' }}>Importe a planilha antiga ou o extrato da B3 em Configurações, ou lance suas compras em Notas.</div>
          <div className="btns"><button className="b pri" onClick={onOpenSettings}>Ir para Configurações</button><button className="b ghost" onClick={onOpenNotas}>Abrir Notas</button></div>
        </div>
      </>
    )
  }

  // Mesmas definições da Carteira, para as duas telas nunca divergirem.
  const quoted = p.rows.filter(r => r.valueCents !== null)
  const varTotal = quoted.reduce((s, r) => s + (r.varCents ?? 0), 0)
  const costQuoted = quoted.reduce((s, r) => s + r.costCents, 0)
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
  const top = topPositions(p, 5)

  return (
    <>
      {header}
      {(due.length > 0 || incomplete.length > 0) && (
        <div className="note" style={{ marginTop: 10 }}>
          {due.map(r => (
            <div key={r.month}>DARF de {monLabel(r.month)} {r.status === 'a_vencer' ? 'a vencer' : 'em aberto'}: {formatBRL(dueCents(r))}{r.dueDate && ` · vence ${brDay(r.dueDate)}/${r.dueDate.slice(0, 4)}`} · código {DARF_CODE}</div>
          ))}
          {incomplete.length > 0 && <div>Imposto incompleto em {incomplete.map(r => monLabel(r.month)).join(', ')}: faltam notas antes destas datas.</div>}
          <button className="link" onClick={onOpenImposto}>Abrir Imposto</button>
        </div>
      )}

      <div className="kpis">
        <div className="k"><div className="muted">Patrimônio</div><div className="v">{formatBRL(p.totalValueCents)}</div>
          <div className="s muted">aportado {formatBRL(p.totalCostCents)}{p.missingQuotes.length > 0 && ` · sem cotação: ${p.missingQuotes.length} ${p.missingQuotes.length === 1 ? 'ativo' : 'ativos'}`}</div></div>
        <div className="k"><div className="muted">Resultado</div><div className={`v ${tone(varTotal)}`}>{sign(varTotal, formatBRL(varTotal))}</div>
          <div className={`s ${tone(varTotal)}`}>{costQuoted > 0 ? pct1(varTotal / costQuoted) : '—'}</div></div>
        <div className="k"><div className="muted">Proventos 12 meses</div><div className="v">{formatBRL(p.dividends12mCents)}</div><div className="s muted">média {formatBRL(avg12)}/mês</div></div>
        <div className="k"><div className="muted">Imposto</div>
          <div className={`v ${dueTotal > 0 ? 'dn' : ''}`}>{dueTotal > 0 ? formatBRL(dueTotal) : 'nada a pagar'}</div>
          <div className="s muted">{dueTotal > 0 ? (nextDue?.dueDate ? `DARF · vence ${brDay(nextDue.dueDate)}` : `DARF · código ${DARF_CODE}`) : 'nenhum DARF a vencer ou em aberto'}</div></div>
      </div>

      <div className="grid2" style={{ gridTemplateColumns: '1.15fr 1fr' }}>
        <div className="card">
          <h5 style={{ margin: 0 }}>Aportado × valor de hoje</h5>
          <LineChart
            series={[
              { label: 'aportado', values: invested.map(m => m.cents) },
              ...(allQuoted ? [{ label: 'valor de hoje', values: invested.map((_, i) => (i === invested.length - 1 ? todayValue : null)) }] : []),
            ]}
            xLabels={lineLabels} xTicks={[0, 6, 12, 18, 23]} tipTitle={i => lineLabels[i]} format={formatCents}
            ariaLabel={`Aportado em ações, FIIs, ETFs e BDRs: ${formatBRL(invested[invested.length - 1].cents)} hoje${allQuoted ? `; valor de mercado ${formatBRL(todayValue)}` : ''}`} />
          <div className="muted">
            A linha é o que você aportou em ações, FIIs, ETFs e BDRs (custo das compras menos o das vendas). O Yield não guarda cotações antigas, então o valor de mercado aparece só para hoje. Ativos manuais ficam de fora deste gráfico.
            {!allQuoted && p.missingQuotes.length > 0 && ` ${p.missingQuotes.length} ${p.missingQuotes.length === 1 ? 'ativo' : 'ativos'} sem cotação: o ponto de hoje não é mostrado.`}
          </div>
        </div>
        <div className="card">
          <div className="bar"><h5 style={{ margin: 0 }}>Patrimônio por classe</h5><span className="muted">clique para abrir a Carteira</span></div>
          <div style={{ marginTop: 6 }}>
            {classes.length === 0 ? <div className="muted">Nenhum ativo com valor ainda.</div> : (
              <HBars ariaLabel="Patrimônio por classe" format={c => `${formatCents(c)} · ${pct1(c / p.totalValueCents).replace('+', '')}`}
                rows={classes.map(c => ({ label: classLabel(c.cls), cents: c.valueCents, onClick: onOpenCarteira }))} />
            )}
          </div>
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="bar"><h5 style={{ margin: 0 }}>Proventos por mês</h5><span className="muted">{monthName(thisMonth).toLowerCase()} até hoje (listrado)</span></div>
          <BarChart series={['Rendimento', 'Dividendo', 'JCP']} format={formatBRL}
            ariaLabel={`Proventos por mês: ${divs.map(m => `${monthName(m.month).toLowerCase()} ${formatBRL(m.byKind.Rendimento + m.byKind.Dividendo + m.byKind.JCP)}`).join('; ')}`}
            bars={divs.map(m => ({
              label: monthName(m.month).slice(0, 3).toLowerCase(), values: [m.byKind.Rendimento, m.byKind.Dividendo, m.byKind.JCP],
              partial: m.month === thisMonth, tip: `${monthName(m.month)} ${m.month.slice(0, 4)}${m.month === thisMonth ? ' até hoje' : ''}`,
            }))} />
        </div>
        <div className="card">
          <div className="bar"><h5 style={{ margin: 0 }}>Maiores posições</h5><span className="muted">clique para abrir a Carteira</span></div>
          {top.length === 0 ? <div className="muted" style={{ marginTop: 6 }}>Nenhuma posição com valor ainda.</div> : (
            <table className="txn" style={{ marginTop: 4 }}>
              <tbody>
                {top.map(t => (
                  <tr key={`${t.manual}-${t.name}`} className="clk" tabIndex={0} onClick={onOpenCarteira} onKeyDown={e => e.key === 'Enter' && onOpenCarteira()}>
                    <td><div className="d1">{t.name}</div><div className="d2">{t.cls}</div></td>
                    <td className="r">{formatCents(t.valueCents)}<div className="d2">{pct1(t.pct).replace('+', '')} do patrimônio</div></td>
                    <td className={`r ${tone(t.varPct)}`}>{t.varPct === null ? (t.manual ? 'à mão' : '—') : pct1(t.varPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
