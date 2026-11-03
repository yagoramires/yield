import { useState } from 'react'
import { deleteBem, saveBem, type Possession, type PossessionKind } from '../db/bensRepo'
import { brDate, costsOf, debtOf, installmentOf, irSituacao, isFinanced, KIND, lastInstallment, patrimonio, upcoming, valueOf } from '../domain/bens'
import { monthOf } from '../domain/money'
import { todayISO, useData } from '../state/DataProvider'
import { IconGlyph } from '../ui/CategoryIcon'
import { DateField } from '../ui/DateField'
import { useHideValues } from '../ui/HideValues'
import { TINT } from '../ui/palette'
import { Select } from '../ui/Select'
import { changeKind, newBemForm, toBemForm, validateBem, type BemForm } from './bens/build'
import { errText } from './lancamentos/GastosHeader'
import { liveAccounts } from './orcamento/SaldoContas'

const COLOR: Record<PossessionKind, string> = { apartamento: TINT.areia, casa: TINT.areia, terreno: TINT.verde, imovel: TINT.areia, veiculo: TINT.azul, outro: TINT.violeta }
const mmYYYY = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`

export function Bens({ onOpenCategorias }: { onOpenCategorias(): void }) {
  const { db, bens, gastos, derived } = useData()
  const { brl } = useHideValues()
  const [form, setForm] = useState<{ f: BemForm; editing: Possession | null } | null>(null)
  const [del, setDel] = useState<Possession | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = todayISO(), month = monthOf(today), lastYear = Number(today.slice(0, 4)) - 1
  const list = bens.list
  const pat = patrimonio(list, derived.portfolio.totalValueCents, liveAccounts(gastos.data).totalCents, month)
  const soon = upcoming(list, today)
  const catName = new Map(gastos.data.categories.map(c => [c.id, c.name]))

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn(); await bens.reload(); setError(null); return true } catch (e) { setError(`${what}: ${errText(e)}`); return false } finally { setBusy(false) }
  }
  const open = (p: Possession | null) => { setDel(null); setError(null); setForm({ f: p ? toBemForm(p) : newBemForm(), editing: p }) }
  const salvar = (f: BemForm, editing: Possession | null) => void run('Não foi possível salvar o bem', () => saveBem(db, { ...validateBem(f, today, editing ?? undefined), id: editing?.id })).then(ok => ok && setForm(null))

  return (
    <>
      <div className="bar">
        <h1 style={{ margin: 0 }}>Meus bens</h1>
        {!form && <button className="b pri" onClick={() => open(null)}>+ Adicionar bem</button>}
      </div>
      {error && <div className="note" style={{ marginTop: 10 }}>{error}</div>}

      <div className="kpis">
        <div className="k"><div className="muted">Patrimônio</div><div className={`v ${pat.totalCents < 0 ? 'dn' : ''}`}>{brl(pat.totalCents)}</div><div className="s muted">investimentos + contas + bens − dívidas</div></div>
        <div className="k"><div className="muted">Investimentos</div><div className="v">{brl(pat.investCents)}</div><div className="s muted">como no Resumo de investimentos</div></div>
        <div className="k"><div className="muted">Saldo nas contas</div><div className="v">{brl(pat.contasCents)}</div><div className="s muted">dos bancos conectados</div></div>
        <div className="k"><div className="muted">Bens</div><div className="v">{brl(pat.bensCents)}</div><div className="s muted">{list.length ? `${list.length} ${list.length === 1 ? 'bem' : 'bens'} pelo valor de hoje` : 'nenhum cadastrado'}</div></div>
        <div className="k"><div className="muted">Falta pagar</div><div className={`v ${pat.dividasCents > 0 ? 'dn' : ''}`}>{brl(pat.dividasCents)}</div><div className="s muted">{list.some(p => debtOf(p, month).cents > 0) ? 'financiamentos em aberto' : 'nada financiado'}</div></div>
      </div>

      {form && <FormCard key={form.editing?.id ?? 'novo'} initial={form.f} editing={form.editing} busy={busy} categories={gastos.data.categories.filter(c => c.countsAsSpending)}
        onCancel={() => { setForm(null); setError(null) }} onSave={salvar} onOpenCategorias={onOpenCategorias} />}

      {soon.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="bar"><h5 style={{ margin: 0 }}>Próximos vencimentos</h5><span className="muted">nos próximos 60 dias</span></div>
          {soon.map(u => (
            <div key={`${u.bem.id}|${u.reminder.name}`} className="bal-row">
              <IconGlyph name={KIND[u.bem.kind].icon} color={COLOR[u.bem.kind]} size={26} />
              <span className="grow"><b>{u.reminder.name} · {u.bem.name}</b><small>{brDate(u.date)} · {u.inDays === 0 ? 'hoje' : u.inDays === 1 ? 'amanhã' : `em ${u.inDays} dias`}</small></span>
              <span className="r">{u.reminder.amountCents != null ? brl(u.reminder.amountCents) : <span className="muted">sem valor</span>}</span>
            </div>
          ))}
        </div>
      )}

      {list.length === 0 && !form ? (
        <div className="card" style={{ textAlign: 'center', padding: 28 }}>
          <IconGlyph name="house" color={TINT.areia} size={40} />
          <h5 style={{ margin: '10px 0 4px' }}>Nenhum bem cadastrado</h5>
          <div className="muted" style={{ maxWidth: 520, margin: '0 auto 12px' }}>
            Imóvel, carro, moto ou outro bem: quanto custou e quanto vale hoje, o financiamento (a parcela vira sugestão no Orçamento), quanto ele custa por mês pelos seus lançamentos,
            os vencimentos do ano (IPVA, IPTU, seguro) e os dados para a ficha Bens e Direitos do IR.
          </div>
          <button className="b pri" onClick={() => open(null)}>+ Adicionar bem</button>
        </div>
      ) : (
        <div className="grid2" style={{ alignItems: 'start' }}>
          {list.map(p => {
            const value = valueOf(p), gain = p.valueCents != null && p.costCents > 0 ? (p.valueCents - p.costCents) / p.costCents : null
            const n = installmentOf(p, month), debt = debtOf(p, month), end = lastInstallment(p)
            const c = costsOf(p, gastos.data.txns, gastos.categorize, today)
            const ir = irSituacao(p, lastYear)
            return (
              <div key={p.id} className="card bem-card">
                <div className="bar">
                  <span className="row" style={{ alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <IconGlyph name={KIND[p.kind].icon} color={COLOR[p.kind]} size={32} />
                    <span style={{ minWidth: 0 }}><b className="bem-name">{p.name}</b><small className="muted bem-sub">{KIND[p.kind].label}{p.details ? ` · ${p.details}` : ''}</small></span>
                  </span>
                  <span className="btns"><button className="b ghost" disabled={busy} onClick={() => open(p)}>editar</button><button className="b ghost" disabled={busy} onClick={() => { setDel(p); setForm(null) }}>apagar</button></span>
                </div>
                <div className="bal-total">{brl(value)}<span className="muted"> {p.valueCents != null ? `vale hoje${p.valueAt ? `, atualizado em ${brDate(p.valueAt)}` : ''}` : 'valor da compra (informe quanto vale hoje no editar)'}</span>
                  {gain !== null && <span className={gain >= 0 ? 'up' : 'dn'} style={{ fontSize: 11, marginLeft: 6 }}>{gain >= 0 ? '+' : '−'}{Math.abs(gain * 100).toFixed(1).replace('.', ',')}% sobre a compra</span>}</div>
                <table className="lt blk"><tbody>
                  <tr><td className="muted">Compra</td><td className="r">{brl(p.costCents)} em {brDate(p.boughtAt)}</td></tr>
                  {isFinanced(p) && <>
                    <tr><td className="muted">Financiamento</td><td className="r">{n !== null ? `parcela ${n} de ${p.installmentsTotal} · ${brl(p.installmentCents!)}/mês até ${mmYYYY(end!)}` : end! < month ? `quitado em ${mmYYYY(end!)}` : `${p.installmentsTotal} parcelas de ${brl(p.installmentCents!)} a partir de ${mmYYYY(p.firstInstallment!)}`}</td></tr>
                    {debt.cents > 0 && <tr><td className="muted">Falta pagar</td><td className="r dn">{brl(debt.cents)}<div className="d2">{debt.estimated ? 'parcela × parcelas restantes, com juros' : 'saldo devedor informado'}</div></td></tr>}
                  </>}
                  <tr><td className="muted">Custos</td><td className="r">{p.categoryIds.length === 0 ? <span className="muted">escolha as categorias de custo no editar</span> : <>
                    {c.months ? `${brl(c.avgCents)}/mês em média` : 'sem meses fechados ainda'}{c.thisMonthCents > 0 && ` · ${brl(c.thisMonthCents)} este mês`}
                    <div className="d2">{p.categoryIds.map(id => catName.get(id) ?? 'categoria apagada').join(', ')}{c.months ? ` · ${brl(c.totalCents)} em ${c.months} ${c.months === 1 ? 'mês' : 'meses'}` : ''}</div>
                  </>}</td></tr>
                  <tr><td className="muted">IR</td><td className="r">Grupo {KIND[p.kind].grupo} · Código {KIND[p.kind].codigo}{ir && <div className="d2">em 31/12/{lastYear}: {brl(ir.cents)} · discriminação em Declaração IR</div>}</td></tr>
                </tbody></table>
                {del?.id === p.id && (
                  <div className="note" style={{ marginTop: 10 }}>
                    Apagar "{p.name}"? Os lançamentos e as linhas do Orçamento continuam; só o bem some daqui e da Declaração IR.
                    <div className="btns" style={{ marginTop: 8 }}>
                      <button className="b" disabled={busy} onClick={() => setDel(null)}>Cancelar</button>
                      <button className="b pri" disabled={busy} onClick={() => void run('Não foi possível apagar o bem', () => deleteBem(db, p.id)).then(ok => ok && setDel(null))}>Apagar</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function FormCard({ initial, editing, busy, categories, onCancel, onSave, onOpenCategorias }: {
  initial: BemForm; editing: Possession | null; busy: boolean; categories: { id: string; name: string }[]
  onCancel(): void; onSave(f: BemForm, editing: Possession | null): void; onOpenCategorias(): void
}) {
  const [f, setF] = useState(initial)
  const text = (label: string, k: 'name' | 'details' | 'cost' | 'value' | 'down' | 'installment' | 'total' | 'first' | 'debt', w: number, placeholder?: string) => (
    <label className="field"><span>{label}</span><input className="in" style={{ width: w }} value={f[k]} placeholder={placeholder} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>
  )
  const setReminder = (i: number, k: 'name' | 'date' | 'amount', v: string) => setF({ ...f, reminders: f.reminders.map((r, j) => (j === i ? { ...r, [k]: v } : r)) })
  return (
    <div className="card" style={{ marginBottom: 12, background: 'var(--well)' }}>
      <div className="muted" style={{ marginBottom: 6 }}>{editing ? <>Editando <b style={{ color: 'var(--strong)' }}>{editing.name}</b></> : 'Novo bem'}</div>
      <div className="row">
        <div className="field"><span>Tipo</span>
          <Select ariaLabel="Tipo" value={f.kind} onChange={v => setF(changeKind(f, v as PossessionKind))} options={(Object.keys(KIND) as PossessionKind[]).map(k => ({ value: k, label: KIND[k].label }))} />
        </div>
        {text('Nome', 'name', 200, 'Onix 2024, Apartamento Centro')}
        {text('Detalhes (vão no IR)', 'details', 300, 'placa e Renavam, ou endereço e matrícula')}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <div className="field"><span>Data da compra</span><DateField ariaLabel="Data da compra" value={f.boughtAt} onChange={v => setF({ ...f, boughtAt: v })} /></div>
        {text('Valor da compra (R$)', 'cost', 130)}
        {text('Vale hoje (R$, opcional)', 'value', 140)}
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 10 }}>
        <input type="checkbox" checked={f.financed} onChange={e => setF({ ...f, financed: e.target.checked })} /> Financiado
      </label>
      {f.financed && <>
        <div className="row" style={{ marginTop: 6 }}>
          {text('Entrada (R$)', 'down', 120)}
          {text('Parcela (R$)', 'installment', 110)}
          {text('Nº de parcelas', 'total', 90)}
          {text('Primeira parcela', 'first', 100, 'mm/aaaa')}
          {text('Saldo devedor (R$, opcional)', 'debt', 150)}
        </div>
        <div className="muted" style={{ marginTop: 6 }}>A parcela de cada mês aparece como sugestão no Orçamento. Sem o saldo devedor, "falta pagar" é parcela × parcelas restantes (com os juros que ainda vão correr).</div>
      </>}
      <div className="field" style={{ marginTop: 10 }}><span>Categorias de custo (o que você gasta com o bem)</span></div>
      <div className="row" style={{ marginTop: 4 }} role="group" aria-label="Categorias de custo">
        {categories.map(c => {
          const on = f.categoryIds.includes(c.id)
          return <button key={c.id} type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setF({ ...f, categoryIds: on ? f.categoryIds.filter(x => x !== c.id) : [...f.categoryIds, c.id] })}>{c.name}</button>
        })}
      </div>
      <div className="muted" style={{ marginTop: 4 }}>Dica: crie uma categoria só do bem (ex.: "Carro") em <button className="link" onClick={onOpenCategorias}>Categorias</button>, com regras para IPVA, seguro, posto e oficina.</div>
      <div className="field" style={{ marginTop: 10 }}><span>Vencimentos do ano</span></div>
      {f.reminders.map((r, i) => (
        <div key={i} className="row" style={{ marginTop: 4, alignItems: 'center' }}>
          <input className="in" style={{ width: 160 }} aria-label="Nome do vencimento" placeholder="IPVA, Seguro…" value={r.name} onChange={e => setReminder(i, 'name', e.target.value)} />
          <input className="in" style={{ width: 80 }} aria-label="Dia e mês" placeholder="dd/mm" value={r.date} onChange={e => setReminder(i, 'date', e.target.value)} />
          <input className="in" style={{ width: 110 }} aria-label="Valor (opcional)" placeholder="valor (opcional)" value={r.amount} onChange={e => setReminder(i, 'amount', e.target.value)} />
          <button type="button" className="b ghost" aria-label={`Tirar ${r.name || 'vencimento'}`} onClick={() => setF({ ...f, reminders: f.reminders.filter((_, j) => j !== i) })}>tirar</button>
        </div>
      ))}
      <button type="button" className="link" style={{ marginTop: 6 }} onClick={() => setF({ ...f, reminders: [...f.reminders, { name: '', date: '', amount: '' }] })}>+ vencimento</button>
      <div className="btns" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
        <button className="b ghost" disabled={busy} onClick={onCancel}>Cancelar</button>
        <button className="b pri" disabled={busy} onClick={() => onSave(f, editing)}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </div>
  )
}
