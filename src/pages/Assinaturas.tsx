import { useEffect, useRef, useState } from 'react'
import { dismissSubscription } from '../db/gastosRepo'
import { formatBRL } from '../domain/money'
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
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (ask) dialog.current?.showModal() }, [ask])
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
      <div className="muted page-description">Acompanhe suas cobranças recorrentes e a previsão dos próximos pagamentos. Compras parceladas não entram.</div>
      {subs.length === 0 ? (
        <div className="info" style={{ marginTop: 14 }}>Nenhuma cobrança repetida encontrada ainda. Elas aparecem depois de 3 meses de lançamentos.</div>
      ) : (
        <>
          <div className="kpis">
            <div className="k"><div className="muted">Por mês</div><div className="v">{formatBRL(t.monthlyCents)}</div><div className="s muted">{t.active === 1 ? '1 ativa' : `${t.active} ativas`}</div></div>
            <div className="k"><div className="muted">Por ano</div><div className="v">{formatBRL(t.yearlyCents)}</div><div className="s muted">anuais incluídas</div></div>
            <div className="k"><div className="muted">Paradas</div><div className="v">{t.stopped}</div><div className="s muted">sem cobrança há mais de 45 dias (mensais) ou 400 dias (anuais)</div></div>
          </div>
          {error && <div className="note" role="alert" style={{ marginBottom: 8 }}>{error}</div>}
          <div className="subscription-list">
            {subs.map(s => (
              <article className={`card subscription${s.active ? '' : ' stopped'}`} key={s.merchantKey}>
                <div className="subscription-heading">
                  <h2>{s.name}</h2>
                  <span className={`pill${s.active ? ' ok' : ''}`}>{s.active ? 'Ativa' : 'Parada'}</span>
                </div>
                <div className="subscription-price">{formatBRL(s.amountCents)} <span className="t2">/ {s.period === 'mensal' ? 'mês' : 'ano'}</span></div>
                {s.previousAmountCents !== null && <div className="subscription-increase warn">Último valor: {formatBRL(s.previousAmountCents)} · houve aumento</div>}
                <dl className="subscription-details">
                  <div className="subscription-account"><dt>Conta</dt><dd>{accountLabel(accounts.get(s.accountId))}</dd></div>
                  <div><dt>Equivalente por mês</dt><dd>{s.active ? formatBRL(s.monthlyCents) : '—'}</dd></div>
                  <div><dt>Próxima prevista</dt><dd>{s.active ? next(s.nextDate) : '—'}</dd></div>
                </dl>
                <div className="subscription-footer">
                  <span className="muted">Última cobrança em {next(s.lastDate)}</span>
                  <button className="b ghost" disabled={busy} onClick={() => { setAsk(s); setError(null) }}>Não é assinatura</button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {ask && (
        <dialog ref={dialog} className="modal subscription-dialog" aria-labelledby="dismiss-subscription-title" onCancel={e => { if (busy) e.preventDefault(); else setAsk(null) }}>
          <h2 id="dismiss-subscription-title">Remover da lista de assinaturas?</h2>
          Tirar "{ask.name}" da lista? Ela não volta a aparecer como assinatura. Os lançamentos continuam em Lançamentos.
          <span className="btns" style={{ marginTop: 8 }}>
            <button className="b" autoFocus disabled={busy} onClick={() => setAsk(null)}>Cancelar</button>
            <button className="b pri" disabled={busy} onClick={() => void dismiss(ask)}>{busy ? 'Removendo…' : 'Não é assinatura'}</button>
          </span>
          {error && <div className="note" role="alert" style={{ marginTop: 8 }}>{error}</div>}
        </dialog>
      )}
    </>
  )
}
