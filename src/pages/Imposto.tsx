import { useState } from 'react'
import { deletePayment, savePayment } from '../db/repo'
import { DARF_CODE, type DarfStatus } from '../domain/darf'
import { formatBRL, formatCents } from '../domain/money'
import { useData } from '../state/DataProvider'
import { buildPayment, dayTradeMonths, exemptSales, groupByYear, irrfToDeclare, isEmptyMonth, lastDayOfMonth, lossCarry, openCounts, type ImpostoRow, type PaymentForm } from './imposto/build'

const SICALC = 'https://sicalc.receita.economia.gov.br/sicalc/principal'
const MON = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const monLabel = (m: string) => `${MON[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`
const brDay = (iso: string) => iso.split('-').reverse().join('/')
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const dash = (c: number, f: (c: number) => string = formatCents) => (c === 0 ? '—' : f(c))
const STATUS: Record<DarfStatus, { label: string; cls: string }> = {
  sem_imposto: { label: 'sem imposto', cls: '' }, acumulado: { label: 'acumulado (< R$ 10)', cls: '' }, a_vencer: { label: 'a vencer', cls: '' },
  em_aberto: { label: 'em aberto', cls: 'bad' }, pago: { label: 'pago', cls: 'ok' }, pago_a_menor: { label: 'pago a menor', cls: 'warn' },
}

export function Imposto() {
  const { derived, db, reload } = useData()
  const [open, setOpen] = useState<string | null>(null) // mês com o formulário de pagamento aberto
  const [form, setForm] = useState<PaymentForm>({ paidAt: '', principal: '', total: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const { darfs, tax, replay } = derived
  const groups = groupByYear(tax, darfs.rows).map(g => ({ ...g, rows: g.rows.filter(r => !isEmptyMonth(r)) })).filter(g => g.rows.length > 0)
  const dtMonths = dayTradeMonths(replay.warnings)
  const loss = (r: ImpostoRow) => { const l = lossCarry(r.tax); return l.comum + l.fii === 0 ? '—' : <>comum {formatCents(l.comum)}<br />FII {formatCents(l.fii)}</> }
  const exempt = (r: ImpostoRow) => r.tax.comum.exemptProfitCents
  const counts = openCounts(darfs.rows)
  const latest = tax[tax.length - 1]
  const latestLoss = latest ? lossCarry(latest) : { comum: 0, fii: 0 }
  const year = groups[0]?.year ?? ''
  const plural = (n: number) => `${n} ${n === 1 ? 'mês' : 'meses'}`

  const startPay = (r: ImpostoRow) => {
    // Complementar substitui o pagamento do mês: o principal sugerido é o DARF inteiro.
    setForm({ paidAt: '', principal: formatCents(r.darf.darfCents), total: formatCents(r.darf.darfCents) }); setFormError(null); setOpen(r.darf.month)
  }
  const pay = async (month: string) => {
    try {
      await savePayment(db, buildPayment(month, form))
      await reload(); setOpen(null); setFormError(null)
    } catch (e) { setFormError(e instanceof Error && !e.message.includes('SQL') ? e.message : `Não foi possível salvar: ${errText(e)}`) }
  }
  const undo = async (month: string) => {
    try { await deletePayment(db, month); await reload(); setConfirm(null); setError(null) } catch (e) { setError(`Não foi possível desfazer: ${errText(e)}`) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(SICALC); setCopied('Link copiado.') } catch { setCopied('Não foi possível copiar. Selecione o link e copie à mão.') }
  }

  return (
    <>
      <div className="bar"><h1>Imposto</h1></div>
      <div className="note" style={{ marginTop: 10 }}>Cobre só renda variável na B3 (ações, FIIs, ETFs e BDRs). Cripto e dólar não entram. Day trade não é apurado.</div>
      {error && <div className="note" style={{ marginTop: 10 }}>{error}</div>}

      <div className="kpis">
        <div className="k" style={{ borderColor: darfs.openCents > 0 ? '#4a2224' : undefined }}>
          <div className="muted">DARF em aberto</div>
          <div className={`v ${darfs.openCents > 0 ? 'dn' : ''}`}>{formatBRL(darfs.openCents)}</div>
          <div className="s muted">{plural(counts.complete)} em aberto · código {DARF_CODE}</div>
        </div>
        <div className="k">
          <div className="muted">Em meses com notas faltando</div>
          <div className="v">{formatBRL(darfs.openIncompleteCents)}</div>
          <div className="s muted">{plural(counts.incomplete)} · valor pode estar errado</div>
        </div>
        <div className="k">
          <div className="muted">Prejuízo a compensar</div>
          <div className="v">{formatBRL(latestLoss.comum + latestLoss.fii)}</div>
          <div className="s muted">comum {formatBRL(latestLoss.comum)} · FII {formatBRL(latestLoss.fii)}</div>
        </div>
        <div className="k">
          <div className="muted">Vendas de ações isentas em {year}</div>
          <div className="v">{formatBRL(exemptSales(tax, year))}</div>
          <div className="s muted">meses abaixo de R$ 20 mil com lucro</div>
        </div>
      </div>
      {darfs.orphanPayments.map(p => (
        <div className="note" key={p.month} style={{ marginBottom: 8 }}>
          Pagamento sem DARF correspondente — revise: {monLabel(p.month)}, pago em {brDay(p.paidAt)}, principal {formatBRL(p.principalCents)}.{' '}
          {confirm === `o-${p.month}` ? (
            <span>Desfazer este pagamento? <button className="link dn" onClick={() => void undo(p.month)}>Desfazer</button> <button className="link" onClick={() => setConfirm(null)}>Cancelar</button></span>
          ) : <button className="link" onClick={() => setConfirm(`o-${p.month}`)}>desfazer</button>}
        </div>
      ))}

      {groups.length === 0 ? <div className="info">Nenhuma venda apurada ainda. Lance notas ou importe a planilha em Configurações.</div> : groups.map(g => (
        <div key={g.year}>
          <h5>{g.year}</h5>
          <table>
            <thead><tr>
              <th>Mês</th><th className="r">Vendas ações</th><th className="r">Resultado comum</th><th className="r">Isento</th><th className="r">Prejuízo a compensar</th>
              <th className="r">IR comum</th><th className="r">Resultado FII</th><th className="r">IR FII</th><th className="r">IRRF usado</th><th className="r">DARF</th><th>Vence</th><th>Situação</th><th />
            </tr></thead>
            <tbody>
              {g.rows.map(r => {
                const d = r.darf, t = r.tax, m = d.month
                const urgent = d.status === 'em_aberto' || d.status === 'pago_a_menor'
                const result = (c: number) => (c === 0 ? '—' : <span className={c > 0 ? 'up' : 'dn'}>{c > 0 ? '+' : ''}{formatCents(c)}</span>)
                return [
                  <tr key={m} className={urgent ? 'hl' : ''}>
                    <td>{monLabel(m)}</td><td className="r">{dash(t.stockSalesCents)}</td><td className="r">{result(t.comum.resultCents)}</td>
                    <td className="r">{dash(exempt(r))}</td><td className="r">{loss(r)}</td><td className="r">{formatCents(t.comum.taxDueCents)}</td>
                    <td className="r">{result(t.fii.resultCents)}</td><td className="r">{formatCents(t.fii.taxDueCents)}</td>
                    <td className="r">{formatCents(t.comum.irrfUsedCents + t.fii.irrfUsedCents)}</td>
                    <td className={`r ${urgent ? 'dn' : ''}`}>{d.darfCents > 0 ? formatCents(d.darfCents) : '—'}</td>
                    <td className={urgent ? 'dn' : ''}>{d.dueDate ? brDay(d.dueDate) : '—'}</td>
                    <td>
                      <span className={`pill ${STATUS[d.status].cls}`}>{d.status === 'pago' && d.payment ? `pago ${brDay(d.payment.paidAt).slice(0, 5)}` : d.status === 'pago_a_menor' ? `pago a menor: falta ${formatCents(d.complementCents)}` : STATUS[d.status].label}</span>
                      {t.incomplete && <> <span className="pill warn">incompleto</span></>}
                      {dtMonths.has(m) && <> <span className="pill warn">day trade</span></>}
                    </td>
                    <td className="r t2">
                      {d.darfCents > 0 && d.status !== 'pago' && <button className="b" onClick={() => startPay(r)}>{d.status === 'pago_a_menor' ? 'Complementar' : 'Marcar como pago'}</button>}
                      {d.payment && (confirm === m ? (
                        <span> Desfazer o pagamento de {monLabel(m)}? <button className="link dn" onClick={() => void undo(m)}>Desfazer</button> <button className="link" onClick={() => setConfirm(null)}>Cancelar</button></span>
                      ) : <> <button className="link" onClick={() => setConfirm(m)}>desfazer</button></>)}
                    </td>
                  </tr>,
                  (t.incomplete || dtMonths.has(m)) && (
                    <tr key={`${m}-w`}><td colSpan={13}>
                      {t.incomplete && <div className="note">Venda maior que a posição: faltam notas antes desta data</div>}
                      {dtMonths.has(m) && <div className="note" style={{ marginTop: t.incomplete ? 4 : 0 }}>
                        Day trade em {replay.warnings.filter(w => w.kind === 'day_trade' && w.date.startsWith(m)).map(w => `${w.ticker} (${brDay(w.date).slice(0, 5)})`).join(', ')}: não apurado aqui, o imposto pode estar errado.
                      </div>}
                    </td></tr>
                  ),
                  open === m && (
                    <tr key={`${m}-f`}><td colSpan={13}>
                      <div className="card">
                        <b style={{ color: '#fff' }}>DARF {monLabel(m)} · código {DARF_CODE}</b>
                        <div className="t2" style={{ margin: '6px 0' }}>
                          Período de apuração {brDay(lastDayOfMonth(m))} · principal {formatBRL(d.darfCents)} · vencimento {d.dueDate ? brDay(d.dueDate) : '—'}
                          {d.status === 'em_aberto' && <><br />Pagamento em atraso: calcule multa e juros no SicalcWeb da Receita</>}
                        </div>
                        <div className="t2">SicalcWeb: <span style={{ userSelect: 'all' }}>{SICALC}</span> <button className="b" onClick={() => void copy()}>Copiar link</button> {copied && <span>{copied}</span>}</div>
                        <div className="row" style={{ margin: '10px 0' }}>
                          <label className="field"><span>Data do pagamento</span><input className="in" type="date" value={form.paidAt} onChange={e => setForm({ ...form, paidAt: e.target.value })} /></label>
                          <label className="field"><span>Principal</span><input className="in" style={{ width: 100 }} inputMode="decimal" value={form.principal} onChange={e => setForm({ ...form, principal: e.target.value })} /></label>
                          <label className="field"><span>Total pago (com multa e juros)</span><input className="in" style={{ width: 100 }} inputMode="decimal" value={form.total} onChange={e => setForm({ ...form, total: e.target.value })} onKeyDown={e => e.key === 'Enter' && void pay(m)} /></label>
                        </div>
                        {formError && <div className="note" style={{ marginBottom: 8 }}>{formError}</div>}
                        <div className="btns"><button className="b" onClick={() => setOpen(null)}>Cancelar</button><button className="b pri" onClick={() => void pay(m)}>Salvar</button></div>
                      </div>
                    </td></tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      ))}

      {irrfToDeclare(tax).length > 0 && (
        <>
          <h5>IRRF a informar na declaração</h5>
          <div className="row">{irrfToDeclare(tax).map(x => <span key={x.year} className="t2">{x.year} <b style={{ color: '#fff' }}>{formatBRL(x.cents)}</b></span>)}</div>
        </>
      )}
      <div className="info" style={{ marginTop: 10 }}>Marcar como pago pede a data e o valor pago (principal; multa e juros à parte, se pagou atrasado). Complementar substitui o pagamento do mês: informe o principal total pago.</div>
    </>
  )
}
