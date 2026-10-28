import { List, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { dismissSubscription } from '../db/gastosRepo'
import { formatBRL, formatCents, monthOf } from '../domain/money'
import type { Subscription } from '../domain/assinaturas'
import { todayISO, useData } from '../state/DataProvider'
import { nextCharges, totalsOfSubscriptions } from './categorias/build'
import { cleanDescription, NO_FILTER, shortAccountLabel } from './lancamentos/build'
import { brDay, errText } from './lancamentos/GastosHeader'

const COLORS = ['#ff7a8a', '#c79bff', '#6fdc8c', '#5fb3ff', '#7fd1d1', '#f5d76e', '#ff9f5a', '#9aa8ff']
// cor fixa por nome, para a mesma assinatura ter sempre a mesma cor
const colorOf = (name: string) => COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length]
const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export function Assinaturas({ onOpenLancamentos }: { onOpenLancamentos(): void }) {
  const { db, reload, gastos } = useData()
  const { data, subscriptions: subs, setFilter, setMonth } = gastos
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = todayISO()
  const t = totalsOfSubscriptions(subs)
  const soon = nextCharges(subs, today)
  const accounts = new Map(data.accounts.map(a => [a.id, a]))
  const date = (d: string) => (d.slice(0, 4) === today.slice(0, 4) ? brDay(d) : `${brDay(d)}/${d.slice(0, 4)}`)
  const when = (d: string) => (d === today ? 'hoje' : d < today ? `atrasada (${date(d)})` : `próxima ${date(d)}`)

  const remove = async (s: Subscription) => {
    setBusy(true)
    try { await dismissSubscription(db, s.merchantKey); await reload(); setConfirming(null); setError(null) } catch (e) { setError(`Não foi possível excluir "${cleanDescription(s.name).name}": ${errText(e)}`) }
    setBusy(false)
  }
  const openTxns = (s: Subscription) => { setMonth(monthOf(s.lastDate)); setFilter({ ...NO_FILTER, search: s.name }); onOpenLancamentos() }

  const row = (s: Subscription) => {
    const name = cleanDescription(s.name).name
    const color = colorOf(name)
    const avatar = <div className="sub-av" style={{ background: `${color}22`, color }} aria-hidden>{name.charAt(0).toUpperCase()}</div>
    if (confirming === s.merchantKey) return (
      <div key={s.merchantKey} className="srow confirm" role="alert">
        {avatar}
        <div className="lmid"><div>Excluir <b style={{ color: '#fff' }}>{name}</b> das assinaturas?</div>
          <div className="lsub">Ela não volta a aparecer aqui. Os lançamentos continuam em Lançamentos.</div>
          {error && <div className="note" style={{ marginTop: 6 }}>{error}</div>}</div>
        <span className="btns">
          <button className="b" autoFocus disabled={busy} onClick={() => setConfirming(null)}>Cancelar</button>
          <button className="b danger" disabled={busy} onClick={() => void remove(s)}>{busy ? 'Excluindo…' : 'Excluir'}</button>
        </span>
      </div>
    )
    const share = s.active && t.monthlyCents > 0 ? Math.round((s.monthlyCents / t.monthlyCents) * 100) : null
    return (
      <div key={s.merchantKey} className="srow">
        {avatar}
        <div className="lmid">
          <div className="sname"><span className="lname">{name}</span>
            {s.previousAmountCents !== null && <span className="badge up-price">subiu de {formatCents(s.previousAmountCents)}</span>}
            {s.period === 'anual' && <span className="badge">anual</span>}</div>
          <div className="lsub">{[s.period === 'mensal' ? 'Mensal' : 'Anual', shortAccountLabel(accounts.get(s.accountId)), s.active ? when(s.nextDate) : `última em ${date(s.lastDate)}`].join(' · ')}</div>
          {share !== null && <div className="share" aria-label={`${share}% do total por mês`}><div><i style={{ width: `${share}%`, background: color }} /></div><span>{share}%</span></div>}
        </div>
        <div className="sact">
          <button className="icon-btn sq" title="Ver lançamentos" aria-label={`Ver lançamentos de ${name}`} onClick={() => openTxns(s)}><List size={14} aria-hidden /></button>
          <button className="icon-btn sq del" title="Excluir" aria-label={`Excluir ${name}`} onClick={() => { setConfirming(s.merchantKey); setError(null) }}><Trash2 size={14} aria-hidden /></button>
        </div>
        <div className="lval">{formatCents(s.amountCents)}<small>/ {s.period === 'mensal' ? 'mês' : 'ano'}</small></div>
      </div>
    )
  }

  const active = subs.filter(s => s.active), stopped = subs.filter(s => !s.active)
  return (
    <>
      <h1>Assinaturas</h1>
      <div className="muted page-description">Cobranças que se repetem todo mês ou todo ano. Compras parceladas não entram.</div>
      {subs.length === 0 ? (
        <div className="info" style={{ marginTop: 14 }}>Nenhuma cobrança repetida encontrada ainda. Elas aparecem depois de 3 meses de lançamentos.</div>
      ) : (
        <>
          <div className="kpis">
            <div className="k"><div className="muted">Por mês</div><div className="v">{formatBRL(t.monthlyCents)}</div><div className="s muted">{t.active === 1 ? '1 ativa' : `${t.active} ativas`}</div></div>
            <div className="k"><div className="muted">Por ano</div><div className="v">{formatBRL(t.yearlyCents)}</div><div className="s muted">anuais incluídas</div></div>
            <div className="k"><div className="muted">Próximos 30 dias</div><div className="v">{formatBRL(soon.totalCents)}</div><div className="s muted">{soon.list.length === 1 ? '1 cobrança' : `${soon.list.length} cobranças`}</div></div>
          </div>
          {soon.list.length > 0 && (
            <>
              <div className="sec-h"><span>Próximas cobranças</span></div>
              <div className="next-strip">
                {soon.list.slice(0, 5).map(s => (
                  <div key={s.merchantKey} className={`next-c ${s.nextDate <= today ? 'now' : ''}`}>
                    <div className="d">{s.nextDate === today ? 'Hoje' : s.nextDate < today ? 'Atrasada' : WEEKDAY[new Date(`${s.nextDate}T12:00:00`).getDay()]} · {brDay(s.nextDate)}</div>
                    <div className="n">{cleanDescription(s.name).name}</div>
                    <div className="v">{formatCents(s.amountCents)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          {active.length > 0 && <><div className="sec-h"><span>Ativas · {active.length}</span><span>mais caras primeiro</span></div><div className="day-card">{active.map(row)}</div></>}
          {stopped.length > 0 && <><div className="sec-h"><span>Paradas · {stopped.length}</span><span>sem cobrança há mais de 45 dias (mensais) ou 400 dias (anuais)</span></div><div className="day-card stopped">{stopped.map(row)}</div></>}
        </>
      )}
    </>
  )
}
