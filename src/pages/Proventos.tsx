import { useState } from 'react'
import { deleteDividend, upsertDividends } from '../db/repo'
import { formatBRL, formatCents } from '../domain/money'
import type { Dividend } from '../domain/types'
import { useData } from '../state/DataProvider'
import { useB3Import } from './configuracoes/useB3Import'
import { buildDividend, filterDividends, groupByMonth, KINDS, totalsByKind, totalsByYear, type DividendForm, type Filter } from './proventos/build'

const ORIGIN: Record<Dividend['source'], string> = { b3: 'B3', planilha: 'planilha', manual: 'manual' }
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} de ${m.slice(0, 4)}`
const brDay = (iso: string) => iso.split('-').reverse().join('/')
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const emptyForm = (): DividendForm => ({ ticker: '', kind: 'Dividendo', payDate: '', broker: '', amount: '' })

export function Proventos() {
  const { data, db, reload } = useData()
  const [filter, setFilter] = useState<Filter>({ ticker: '', kind: '', year: '' })
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

  const all = data.dividends
  const tickers = [...new Set(all.map(d => d.ticker))].sort()
  const filtered = filterDividends(all, filter)
  const groups = groupByMonth(filtered)
  const byKind = totalsByKind(filtered)

  return (
    <>
      <div className="bar">
        <h1>Proventos</h1>
        <div className="btns">{b3.button('Importar extrato da B3', 'b')}<button className="b pri" onClick={() => { setForm(emptyForm()); setFormError(null) }}>+ Provento</button></div>
      </div>
      {error && <div className="note" style={{ marginTop: 10 }}>{error}</div>}
      {b3.panel}

      <div className="kpis">
        {totalsByYear(all).map(y => <div className="k" key={y.year}><div className="muted">{y.year}</div><div className="v">{formatBRL(y.totalCents)}</div></div>)}
        <div className="k" style={{ flex: 2 }}>
          <div className="muted">Por tipo{filter.ticker || filter.year ? ' (filtro atual)' : ''}</div>
          <div className="row" style={{ marginTop: 4 }}>{KINDS.map(k => <span key={k} className="t2">{k} <b style={{ color: '#fff' }}>{formatBRL(byKind[k])}</b></span>)}</div>
        </div>
      </div>

      {form && (
        <div className="card" style={{ marginBottom: 12 }}>
          <b style={{ color: '#fff' }}>Novo provento</b>
          <div className="row" style={{ margin: '10px 0' }}>
            <label className="field"><span>Ativo</span><input className="in" autoFocus style={{ width: 90 }} value={form.ticker} onChange={e => setForm({ ...form, ticker: e.target.value.toUpperCase() })} /></label>
            <label className="field"><span>Tipo</span>
              <select className="in" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as DividendForm['kind'] })}>{KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
            <label className="field"><span>Data do pagamento</span><input className="in" type="date" value={form.payDate} onChange={e => setForm({ ...form, payDate: e.target.value })} /></label>
            <label className="field"><span>Corretora (opcional)</span><input className="in" style={{ width: 110 }} value={form.broker} onChange={e => setForm({ ...form, broker: e.target.value })} /></label>
            <label className="field"><span>Valor</span><input className="in" style={{ width: 100 }} inputMode="decimal" placeholder="0,00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} onKeyDown={e => e.key === 'Enter' && void save()} /></label>
          </div>
          {formError && <div className="note" style={{ marginBottom: 8 }}>{formError}</div>}
          <div className="btns"><button className="b" onClick={() => setForm(null)}>Cancelar</button><button className="b pri" onClick={() => void save()}>Salvar</button></div>
        </div>
      )}

      <div className="row" style={{ marginBottom: 10 }}>
        <select className="in" aria-label="Ticker" value={filter.ticker} onChange={e => setFilter({ ...filter, ticker: e.target.value })}>
          <option value="">Ticker: todos</option>{tickers.map(t => <option key={t}>{t}</option>)}</select>
        <button className={`chip ${filter.kind === '' ? 'on' : ''}`} onClick={() => setFilter({ ...filter, kind: '' })}>Todos</button>
        {KINDS.map(k => <button key={k} className={`chip ${filter.kind === k ? 'on' : ''}`} onClick={() => setFilter({ ...filter, kind: k })}>{k}</button>)}
        <select className="in" aria-label="Ano" value={filter.year} onChange={e => setFilter({ ...filter, year: e.target.value })}>
          <option value="">Ano: todos</option>{totalsByYear(all).map(y => <option key={y.year}>{y.year}</option>)}</select>
      </div>

      {groups.length === 0 ? <div className="info">{all.length === 0 ? 'Nenhum provento ainda. Lance um provento ou importe os Proventos Recebidos da B3 em Configurações.' : 'Nenhum provento com esses filtros.'}</div> : (
        <div className="table-scroll" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table>
          <tbody>
            {groups.map(g => [
              <tr key={g.month} className="cls"><td>{monthLabel(g.month)}</td><td /><td /><td /><td /><td className="r">{formatCents(g.totalCents)}</td><td /></tr>,
              ...g.items.map(d => (
                <tr key={d.id}>
                  <td>{brDay(d.payDate).slice(0, 5)}</td><td>{d.ticker}</td><td className="t2">{d.kind}</td><td className="t2">{d.broker ?? '—'}</td>
                  <td><span className="tag">{ORIGIN[d.source]}</span></td><td className="r">{formatCents(d.amountCents)}</td>
                  <td className="r t2">{confirm === d.id ? (
                    <span>Excluir este provento? <button className="link dn" onClick={() => void remove(d.id)}>Excluir</button> <button className="link" onClick={() => setConfirm(null)}>Cancelar</button></span>
                  ) : <button className="link" onClick={() => setConfirm(d.id)}>excluir</button>}</td>
                </tr>
              )),
            ])}
          </tbody>
        </table></div>
      )}
      {all.some(d => d.source === 'planilha') && <div className="muted" style={{ marginTop: 8 }}>Da planilha antiga só vem o total do mês (dia 01). Ao importar o extrato da B3, ele substitui o valor da planilha naquele mês e ticker.</div>}
    </>
  )
}
