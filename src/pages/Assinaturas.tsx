import { useState } from 'react'
import { dismissSubscription } from '../db/gastosRepo'
import { formatBRL, formatCents } from '../domain/money'
import type { Subscription } from '../domain/assinaturas'
import { todayISO, useData } from '../state/DataProvider'
import { totalsOfSubscriptions } from './categorias/build'
import { accountLabel, brDay, errText } from './lancamentos/GastosHeader'

export function Assinaturas() {
  const { db, reload, gastos } = useData()
  const { data, subscriptions: subs } = gastos
  const [ask, setAsk] = useState<Subscription | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = totalsOfSubscriptions(subs)
  const accounts = new Map(data.accounts.map(a => [a.id, a]))
  const thisYear = todayISO().slice(0, 4)
  const next = (d: string) => (d.slice(0, 4) === thisYear ? brDay(d) : `${brDay(d)}/${d.slice(0, 4)}`)

  const dismiss = async (s: Subscription) => {
    setBusy(true)
    try { await dismissSubscription(db, s.merchantKey); await reload(); setAsk(null); setError(null) } catch (e) { setError(`Não foi possível tirar "${s.name}" da lista: ${errText(e)}`) }
    setBusy(false)
  }

  return (
    <>
      <h1>Assinaturas</h1>
      <div className="muted">Cobranças que se repetem todo mês (ou todo ano) no mesmo lugar, com valor parecido. Compras parceladas não entram.</div>
      {subs.length === 0 ? (
        <div className="info" style={{ marginTop: 14 }}>Nenhuma cobrança repetida encontrada ainda. Elas aparecem depois de 3 meses de lançamentos.</div>
      ) : (
        <>
          <div className="kpis">
            <div className="k"><div className="muted">Por mês</div><div className="v">{formatBRL(t.monthlyCents)}</div><div className="s muted">{t.active === 1 ? '1 ativa' : `${t.active} ativas`}</div></div>
            <div className="k"><div className="muted">Por ano</div><div className="v">{formatBRL(t.yearlyCents)}</div><div className="s muted">anuais incluídas</div></div>
            <div className="k"><div className="muted">Paradas</div><div className="v">{t.stopped}</div><div className="s muted">sem cobrança há mais de 45 dias</div></div>
          </div>
          {error && <div className="note" style={{ marginBottom: 8 }}>{error}</div>}
          <table>
            <thead><tr><th>Assinatura</th><th>Conta</th><th>Período</th><th className="r">Valor</th><th className="r">Por mês</th><th>Próxima</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {subs.map(s => (
                <tr key={s.merchantKey}>
                  <td>{s.name}</td>
                  <td className="t2">{accountLabel(accounts.get(s.accountId))}</td>
                  <td>{s.period}</td>
                  <td className="r">{formatCents(s.amountCents)}</td>
                  <td className={`r ${s.active ? '' : 't2'}`}>{s.active ? formatCents(s.monthlyCents) : '—'}</td>
                  <td className={s.active ? '' : 't2'}>{s.active ? next(s.nextDate) : '—'}</td>
                  <td>{s.active ? <span className="pill ok">ativa</span> : <span className="pill">parada desde {brDay(s.lastDate)}</span>}</td>
                  <td className="muted"><button className="link" disabled={busy} onClick={() => { setAsk(s); setError(null) }}>não é assinatura</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {ask && (
        <div className="note" style={{ marginTop: 10 }}>
          Tirar "{ask.name}" da lista? Ela não volta a aparecer como assinatura. Os lançamentos continuam em Lançamentos.
          <span className="btns" style={{ marginTop: 8 }}>
            <button className="b" disabled={busy} onClick={() => setAsk(null)}>Cancelar</button>
            <button className="b pri" disabled={busy} onClick={() => void dismiss(ask)}>Não é assinatura</button>
          </span>
        </div>
      )}
    </>
  )
}
