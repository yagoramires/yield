import { useState } from 'react'
import { Insights } from './assistente/Insights'
import type { Route } from '../ui/routes'
import { deleteDividend, upsertDividends } from '../db/repo'
import { formatBRL, formatCents, monthOf } from '../domain/money'
import { todayISO, useData } from '../state/DataProvider'
import { BarChart, HBars } from '../ui/charts'
import { useB3Import } from './configuracoes/useB3Import'
import { brDay as brDate, errText, monthName } from './lancamentos/GastosHeader'
import { buildDividend, byTicker, filterDividends, groupByMonth, KINDS, summary, yearTable, yieldOnCost, type DividendForm, type Filter } from './proventos/build'
import { dividendsByMonth } from './resumoInvestimentos/build'
import { rfJuros, rfJurosByMonth } from '../domain/rendaFixa'
import { DateField } from '../ui/DateField'
import { Select } from '../ui/Select'

const pct = (p: number) => `${(p * 100).toFixed(1).replace('.', ',')}%`
const signedPct = (p: number) => `${p >= 0 ? '+' : '−'}${pct(Math.abs(p))}`
const shortBroker = (b: string | null) => (b ? b.split(/\s+/).slice(0, 2).join(' ') : '—')
type Period = string // '12m', 'tudo' ou um ano ('2025')
const emptyForm = (): DividendForm => ({ ticker: '', kind: 'Dividendo', payDate: '', broker: '', amount: '' })

export function Proventos({ initialMonth = '', onNavigate }: { initialMonth?: string; onNavigate(r: Route): void }) {
  const { data, db, derived, reload } = useData()
  // abre no mês mais recente com provento (o atual pode ainda não ter nenhum); "Todos os meses" continua no filtro
  const [filter, setFilter] = useState<Filter>(() => ({ ticker: '', kind: '', month: initialMonth || data.dividends.map(d => d.payDate.slice(0, 7)).sort().at(-1) || '' }))
  const [period, setPeriod] = useState<Period>('12m')
  const [showAll, setShowAll] = useState(false)
  const [form, setForm] = useState<DividendForm | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const b3 = useB3Import()

  const save = async () => {
    if (!form) return
    try {
      await upsertDividends(db, [buildDividend(form)])
      await reload(); setForm(null); setFormError(null)
    } catch (e) { setFormError(e instanceof Error && !e.message.includes('SQL') ? e.message : `Não foi possível salvar: ${errText(e)}`) }
  }
  const remove = async (id: string) => {
    try { await deleteDividend(db, id); await reload(); setConfirm(null); setError(null) } catch (e) { setError(`Não foi possível excluir: ${errText(e)}`) }
  }

  const today = todayISO()
  const thisMonth = monthOf(today)
  const all = data.dividends
  const tickers = [...new Set(all.map(d => d.ticker))].sort()
  const sm = summary(all, today)
  const yoc = yieldOnCost(sm.last12, derived.portfolio.rows)
  const years = yearTable(all)
  const months = dividendsByMonth(all, thisMonth, 24)
  const juros = rfJurosByMonth(data.rfMoves, thisMonth, 24)
  // juros de Tesouro e CDB: só leitura, fora da Declaração IR (vêm da Movimentação da B3)
  const jurosList = filter.ticker || filter.kind ? [] : rfJuros(data.rfMoves).filter(j => !filter.month || monthOf(j.date) === filter.month).reverse()
  const periodList = period === '12m' ? sm.last12 : period === 'tudo' ? all : all.filter(d => d.payDate.startsWith(period))
  const ranking = byTicker(periodList)
  const filtered = filterDividends(all, filter)
  const groups = groupByMonth(filtered)
  const filtering = Boolean(filter.ticker || filter.kind || filter.month)
  // o mês vindo do clique no Resumo aparece no seletor mesmo sem provento nele
  const payMonths = [...new Set([...data.dividends.map(d => monthOf(d.payDate)), ...(filter.month ? [filter.month] : [])])].sort().reverse()
  const shown = showAll || filtering ? groups : groups.slice(0, 3)
  const ytdDiff = sm.ytdPrevCents ? sm.ytdCents / sm.ytdPrevCents - 1 : null
  const total = (m: (typeof months)[number], i: number) => m.byKind.Rendimento + m.byKind.Dividendo + m.byKind.JCP + juros[i].cents
  const pickMonth = (m: string) => { setFilter({ ...filter, month: filter.month === m ? '' : m }); setShowAll(false) }
  const pickTicker = (t: string) => setFilter({ ...filter, ticker: filter.ticker === t ? '' : t })

  return (
    <>
      <div className="bar">
        <h1>Proventos</h1>
        <div className="btns">{b3.button('Importar da B3', 'b')}<button className="b pri" onClick={() => { setForm(emptyForm()); setFormError(null) }}>+ Provento</button></div>
      </div>
      {error && <div className="note" style={{ marginTop: 10 }}>{error}</div>}
      {b3.panel}

      {form && (
        <div className="card" style={{ marginTop: 12 }}>
          <b style={{ color: 'var(--strong)' }}>Novo provento</b>
          <div className="row" style={{ margin: '10px 0' }}>
            <label className="field"><span>Ativo</span><input className="in" autoFocus style={{ width: 90 }} value={form.ticker} onChange={e => setForm({ ...form, ticker: e.target.value.toUpperCase() })} /></label>
            <div className="field"><span>Tipo</span>
              <Select ariaLabel="Tipo" value={form.kind} onChange={v => setForm({ ...form, kind: v as DividendForm['kind'] })} options={KINDS.map(k => ({ value: k, label: k }))} /></div>
            <div className="field"><span>Data do pagamento</span><DateField ariaLabel="Data do pagamento" value={form.payDate} onChange={v => setForm({ ...form, payDate: v })} /></div>
            <label className="field"><span>Corretora (opcional)</span><input className="in" style={{ width: 110 }} value={form.broker} onChange={e => setForm({ ...form, broker: e.target.value })} /></label>
            <label className="field"><span>Valor</span><input className="in" style={{ width: 100 }} inputMode="decimal" placeholder="0,00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} onKeyDown={e => e.key === 'Enter' && void save()} /></label>
          </div>
          {formError && <div className="note" style={{ marginBottom: 8 }}>{formError}</div>}
          <div className="btns"><button className="b" onClick={() => setForm(null)}>Cancelar</button><button className="b pri" onClick={() => void save()}>Salvar</button></div>
        </div>
      )}

      {all.length === 0 ? <div className="info" style={{ marginTop: 14 }}>Nenhum provento ainda. Lance um provento ou importe os Proventos Recebidos da B3.</div> : (<>
        <Insights area="proventos" month={thisMonth} onNavigate={onNavigate} />
        <div className="kpis">
          <div className="k"><div className="muted">Últimos 12 meses</div><div className="v">{formatBRL(sm.last12Cents)}</div><div className="s muted">média {formatBRL(sm.avg12Cents)}/mês</div></div>
          <div className="k"><div className="muted">{sm.year} até hoje</div><div className="v">{formatBRL(sm.ytdCents)}</div>
            <div className={`s ${ytdDiff === null ? 'muted' : ytdDiff >= 0 ? 'up' : 'dn'}`}>{ytdDiff === null ? 'sem dados do ano passado' : `${signedPct(ytdDiff)} sobre ${Number(sm.year) - 1} no mesmo período`}</div></div>
          <div className="k"><div className="muted">Rendimento sobre o custo</div><div className="v">{yoc.total === null ? '—' : pct(yoc.total)}</div><div className="s muted">12 meses ÷ custo da carteira atual</div></div>
          <div className="k"><div className="muted">Maior pagador (12 meses)</div><div className="v">{sm.top?.ticker ?? '—'}</div><div className="s muted">{sm.top ? `${formatBRL(sm.top.totalCents)} · ${pct(sm.top.totalCents / sm.last12Cents)} do total` : ''}</div></div>
        </div>

        <div className="grid2">
          <div className="card stretch">
            <div className="bar"><h5 style={{ margin: 0 }}>Proventos por mês</h5><span className="muted">clique num mês para filtrar a lista</span></div>
            <BarChart fill height={170} series={['Rendimento', 'Dividendo', 'JCP', 'Juros RF']} format={formatBRL}
              selected={filter.month ? months.findIndex(m => m.month === filter.month) : null} onSelect={i => pickMonth(months[i].month)}
              ariaLabel={`Proventos por mês: ${months.map((m, i) => `${monthName(m.month).toLowerCase()} ${m.month.slice(0, 4)} ${formatBRL(total(m, i))}`).join('; ')}`}
              bars={months.map((m, i) => ({
                // 24 barras: rótulo só no início de cada trimestre, janeiro com o ano
                label: m.month.endsWith('-01') ? `jan ${m.month.slice(2, 4)}` : ['04', '07', '10'].includes(m.month.slice(5)) ? monthName(m.month).slice(0, 3).toLowerCase() : '',
                values: [m.byKind.Rendimento, m.byKind.Dividendo, m.byKind.JCP, juros[i].cents], partial: m.month === thisMonth,
                tip: `${monthName(m.month)} ${m.month.slice(0, 4)}${m.month === thisMonth ? ' até hoje' : ''}`,
              }))} valueLabel={() => ''} />
          </div>
          <div className="card">
            <div className="bar">
              <h5 style={{ margin: 0 }}>Por ativo</h5>
              <Select ariaLabel="Período" value={period} onChange={setPeriod} options={[{ value: '12m', label: 'Últimos 12 meses' }, ...years.map(y => ({ value: y.year, label: y.year })), { value: 'tudo', label: 'Tudo' }]} />
            </div>
            <div className="muted" style={{ margin: '4px 0 8px' }}>clique para filtrar a lista · % = rendimento sobre o custo em 12 meses</div>
            <HBars ariaLabel="Proventos por ativo" format={formatCents}
              rows={ranking.slice(0, 10).map(t => ({
                label: yoc.byTicker.has(t.ticker) ? `${t.ticker} · ${pct(yoc.byTicker.get(t.ticker)!)}` : t.ticker,
                cents: t.totalCents, selected: filter.ticker === t.ticker, onClick: () => pickTicker(t.ticker),
              }))} />
            {ranking.length > 10 && <div className="muted" style={{ marginTop: 6 }}>+ {ranking.length - 10} ativos com {formatBRL(ranking.slice(10).reduce((s, t) => s + t.totalCents, 0))}</div>}
          </div>
        </div>

        <div className="prov-grid">
          <div className="card">
            <h5 style={{ margin: '0 0 6px' }}>Por ano</h5>
            <table>
              <tbody>
                {years.map(y => (
                  <tr key={y.year}>
                    <td>{y.year}{y.year === sm.year && <span className="muted"> até hoje</span>}</td>
                    <td className="r">{formatCents(y.totalCents)}</td>
                    <td className={`r ${y.growth === null || y.year === sm.year ? 'muted' : y.growth >= 0 ? 'up' : 'dn'}`}>{y.growth === null || y.year === sm.year ? '—' : signedPct(y.growth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
              <h5 style={{ margin: 0, marginRight: 'auto' }}>Lançamentos</h5>
              <Select ariaLabel="Ativo" value={filter.ticker} onChange={v => setFilter({ ...filter, ticker: v })} options={[{ value: '', label: 'Todos os ativos' }, ...tickers.map(t => ({ value: t, label: t }))]} />
              <Select ariaLabel="Mês" value={filter.month} onChange={v => { setFilter({ ...filter, month: v }); setShowAll(false) }} options={[{ value: '', label: 'Todos os meses' }, ...payMonths.map(m => ({ value: m, label: `${monthName(m)} ${m.slice(0, 4)}` }))]} />
              <button className={`chip ${filter.kind === '' ? 'on' : ''}`} onClick={() => setFilter({ ...filter, kind: '' })}>Todos</button>
              {KINDS.map(k => <button key={k} className={`chip ${filter.kind === k ? 'on' : ''}`} onClick={() => setFilter({ ...filter, kind: k })}>{k}</button>)}
            </div>
            {groups.length === 0 ? <div className="muted">Nenhum provento com esses filtros.</div> : (
              <div className="table-scroll" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table>
                <tbody>
                  {shown.map(g => [
                    <tr key={g.month} className="cls"><td colSpan={4}>{monthName(g.month)} {g.month.slice(0, 4)}</td><td className="r">{formatCents(g.totalCents)}</td><td /></tr>,
                    ...g.items.map(d => (
                      <tr key={d.id}>
                        <td className="t2">{brDate(d.payDate)}</td><td>{d.ticker}</td><td className="t2">{d.kind}</td>
                        <td className="t2">{shortBroker(d.broker)}{d.source !== 'b3' && <> <span className="tag">{d.source}</span></>}</td>
                        <td className="r">{formatCents(d.amountCents)}</td>
                        <td className="r t2">{confirm === d.id ? (
                          <span>Excluir? <button className="link dn" onClick={() => void remove(d.id)}>Excluir</button> <button className="link" onClick={() => setConfirm(null)}>Cancelar</button></span>
                        ) : <button className="link" onClick={() => setConfirm(d.id)}>excluir</button>}</td>
                      </tr>
                    )),
                  ])}
                </tbody>
              </table></div>
            )}
            {!filtering && groups.length > 3 && (
              <button className="b ghost" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>{showAll ? 'Mostrar só os últimos 3 meses' : `Ver todos os ${groups.length} meses`}</button>
            )}
            {filtering && <div className="muted" style={{ marginTop: 8 }}>{filtered.length} proventos · {formatBRL(filtered.reduce((s, d) => s + d.amountCents, 0))}</div>}
            {jurosList.length > 0 && <>
              <h5 style={{ margin: '14px 0 6px' }}>Juros da renda fixa <span className="muted">· da Movimentação da B3, fora da declaração de IR</span></h5>
              <table><tbody>
                {(showAll || filtering ? jurosList : jurosList.slice(0, 6)).map((j, i) => (
                  <tr key={`${j.date}-${i}`}><td className="t2">{brDate(j.date)}</td><td>{j.product.split(' - ').filter((_, k, a) => a.length < 3 || k !== 1).join(' ')}</td><td className="t2">Juros RF</td><td className="r">{formatCents(j.valueCents)}</td></tr>
                ))}
              </tbody></table>
            </>}
          </div>
        </div>
        {all.some(d => d.source === 'planilha') && <div className="muted" style={{ marginTop: 8 }}>Da planilha antiga só vem o total do mês (dia 01). Ao importar o extrato da B3, ele substitui o valor da planilha naquele mês e ticker.</div>}
      </>)}
    </>
  )
}
