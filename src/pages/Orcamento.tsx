import { useState } from 'react'
import { createMonth, deleteLine, dismissSuggestion, saveLine, type BudgetLine, type LineKind } from '../db/orcamentoRepo'
import { addMonths, formatBRL, formatCents } from '../domain/money'
import { cltTabelaAno, copyLines, monthSummary, nextMonthLines, pjNet, planVsReal, sourceNet } from '../domain/orcamento'
import { suggestForMonth, type Suggestion } from '../domain/sugestoes'
import type { Month } from '../domain/types'
import { todayISO, useData } from '../state/DataProvider'
import { errText, monthName } from './lancamentos/GastosHeader'
import { monthProgress, spendingPlan, validateLine } from './orcamento/build'
import { Select } from '../ui/Select'

interface Form { id?: string; kind: LineKind; name: string; amount: string; installment: string; categoryId: string; recurring: boolean; sourceId: string; sourceKey: string | null; position: number }

const NET_ZERO = 'O líquido desta fonte está zerado ou negativo: confira a fonte em Configurações'
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, (part / whole) * 100) : part > 0 ? 100 : 0)
const lower = (m: Month) => monthName(m).toLowerCase()

function Track({ real, planned, mark }: { real: number; planned: number; mark?: number }) {
  return (
    <div className="track" style={mark === undefined ? undefined : { height: 12 }}>
      <div className={real > planned ? 'fill over' : 'fill'} style={{ width: `${pct(real, planned)}%` }} />
      {mark !== undefined && <div className="mark" style={{ left: `${mark * 100}%` }} />}
    </div>
  )
}

export function Orcamento({ onOpenGastos, onOpenSettings }: { onOpenGastos(): void; onOpenSettings(): void }) {
  const { db, gastos, orcamento } = useData()
  const { data, month, setMonth, reload } = orcamento
  const [form, setForm] = useState<Form | null>(null)
  const [del, setDel] = useState<BudgetLine | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // toda escrita passa por aqui: recarrega e mostra o erro em pt-BR na tela
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn(); await reload(); setError(null) } catch (e) { setError(`${what}: ${errText(e)}`); setBusy(false); return false }
    setBusy(false)
    return true
  }
  const go = (m: Month) => { setForm(null); setDel(null); setError(null); setMonth(m) }

  const today = todayISO()
  const hasPlan = data.months.includes(month)
  const next = addMonths(month, 1)
  const lines = data.lines.filter(l => l.month === month)
  const entradas = lines.filter(l => l.kind === 'entrada'), saidas = lines.filter(l => l.kind === 'saida')
  const categories = gastos.data.categories
  const catName = (id: string | null) => categories.find(c => c.id === id)?.name ?? null

  const header = (
    <div className="bar">
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <h1 style={{ margin: 0 }}>Orçamento</h1>
        <button className="chip" aria-label="Mês anterior" disabled={busy} onClick={() => go(addMonths(month, -1))}>‹</button>
        <b style={{ color: '#fff', fontSize: 13 }}>{monthName(month)} {month.slice(0, 4)}</b>
        <button className="chip" aria-label="Próximo mês" disabled={busy} onClick={() => go(next)}>›</button>
      </div>
      {hasPlan && !data.months.includes(next) && (
        <div className="btns">
          <button className="b pri" disabled={busy} onClick={() => void run(`Não foi possível criar ${lower(next)}`, async () => {
            await createMonth(db, next, nextMonthLines(lines, data.sources))
          }).then(ok => ok && go(next))}>Criar {lower(next)}</button>
        </div>
      )}
    </div>
  )
  const errorBox = error && <div className="note" style={{ marginTop: 10 }}>{error}</div>

  if (!hasPlan) {
    const prev = data.months.filter(m => m < month).at(-1)
    const copy = prev ? copyLines(data.lines.filter(l => l.month === prev), data.sources, month) : []
    return (
      <>
        {header}
        {errorBox}
        <div className="card" style={{ marginTop: 40, textAlign: 'center', padding: 28 }}>
          <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{monthName(month)} ainda não tem plano</div>
          <div className="muted" style={{ margin: '6px 0 14px' }}>
            {prev && copy.length ? `Copie as linhas recorrentes de ${lower(prev)} (${plural(copy.length, 'linha', 'linhas')}; parcelas avançam sozinhas) ou comece do zero.` : 'Comece do zero e adicione as entradas e saídas do mês.'}
          </div>
          <div className="btns" style={{ justifyContent: 'center' }}>
            {prev && copy.length > 0 && <button className="b pri" disabled={busy} onClick={() => void run('Não foi possível copiar o mês', async () => { await createMonth(db, month, copy) })}>Copiar de {lower(prev)}</button>}
            <button className="b" disabled={busy} onClick={() => void run('Não foi possível criar o mês', async () => { await createMonth(db, month, []) })}>Começar vazio</button>
          </div>
          <div className="muted" style={{ marginTop: 12 }}>Já tem o orçamento numa planilha? Salve como CSV (mes;tipo;nome;valor) e importe em <button className="link" onClick={onOpenSettings}>Configurações › Importar orçamento (CSV)</button>.</div>
        </div>
      </>
    )
  }

  const sum = monthSummary(lines)
  const plan = spendingPlan(lines, categories)
  const pvr = planVsReal(data.lines, gastos.data.txns, gastos.categorize, month)
  const progress = monthProgress(month, today)
  const byCategory = pvr.byCategory.filter(b => categories.find(c => c.id === b.categoryId)?.countsAsSpending)
  const dismissed = data.dismissed.filter(d => d.month === month).map(d => d.key)
  const suggestions = suggestForMonth(month, gastos.subscriptions, gastos.data.txns, gastos.categorize, data.lines, dismissed)

  const open = (kind: LineKind, f: Partial<Form> = {}) => {
    setDel(null); setError(null)
    setForm({ kind, name: '', amount: '', installment: '', categoryId: '', recurring: true, sourceId: '', sourceKey: null, position: 0, ...f })
  }
  const edit = (l: BudgetLine) => open(l.kind, {
    id: l.id, name: l.name, amount: formatCents(l.amountCents), recurring: l.recurring, categoryId: l.categoryId ?? '', sourceId: l.sourceId ?? '', sourceKey: l.sourceKey, position: l.position,
    installment: l.installmentCurrent !== null && l.installmentTotal !== null ? `${l.installmentCurrent}/${l.installmentTotal}` : '',
  })
  // fonte com líquido ≤ 0 trazida para o formulário: o parseMoney daria um erro genérico
  const zeroSource = (f: Form) => {
    const s = f.kind === 'entrada' ? data.sources.find(x => x.id === f.sourceId) : undefined
    return !!s && sourceNet(s, month) <= 0 && f.amount === formatCents(sourceNet(s, month))
  }
  const save = (f: Form) => void run('Não foi possível salvar a linha', async () => {
    if (zeroSource(f)) throw new Error(NET_ZERO)
    const v = validateLine(f.kind === 'saida' ? f : { ...f, installment: '' })
    await saveLine(db, {
      id: f.id, month, kind: f.kind, name: v.name, amountCents: v.amountCents, recurring: v.recurring, position: f.position,
      categoryId: f.kind === 'saida' ? f.categoryId || null : null, installmentCurrent: v.installmentCurrent, installmentTotal: v.installmentTotal,
      sourceId: f.kind === 'entrada' ? f.sourceId || null : null, sourceKey: f.sourceKey,
    })
  }).then(ok => ok && setForm(null))
  const accept = (s: Suggestion) => void run('Não foi possível aceitar a sugestão', async () => {
    await saveLine(db, { month, kind: 'saida', name: s.name, amountCents: s.amountCents, recurring: s.recurring, categoryId: s.categoryId, installmentCurrent: s.installmentCurrent, installmentTotal: s.installmentTotal, sourceId: null, sourceKey: s.key, position: 0 })
  })

  const buttons = (f: Form) => (
    <span className="btns" style={{ marginLeft: 'auto' }}>
      <button className="b ghost" disabled={busy} onClick={() => { setForm(null); setError(null) }}>Cancelar</button>
      <button className="b pri" disabled={busy} onClick={() => save(f)}>Salvar</button>
    </span>
  )
  const recurringBox = (f: Form, forced = false) => (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }} title={forced ? 'parcelas são sempre recorrentes' : undefined}>
      <input type="checkbox" checked={forced || f.recurring} disabled={forced} onChange={e => setForm({ ...f, recurring: e.target.checked })} /> recorrente
    </label>
  )
  const entradaForm = (f: Form) => {
    const source = data.sources.find(s => s.id === f.sourceId)
    return (
      <tr className="edit" key="form"><td colSpan={3}>
        <div className="row" style={{ alignItems: 'center' }}>
          <Select ariaLabel="Fonte" value={f.sourceId} onChange={v => {
            const s = data.sources.find(x => x.id === v)
            setForm(s ? { ...f, sourceId: s.id, name: s.name, amount: formatCents(sourceNet(s, month)) } : { ...f, sourceId: '' })
          }} options={[...data.sources.map(s => ({ value: s.id, label: `Fonte: ${s.name}` })), { value: '', label: 'Valor avulso' }]} />
          <input className="in" aria-label="Nome" placeholder="nome" style={{ width: 140 }} value={f.name} onChange={e => setForm({ ...f, name: e.target.value })} />
          <input className="in" aria-label="Valor" placeholder="0,00" style={{ width: 90 }} readOnly={!!source} value={f.amount} onChange={e => setForm({ ...f, amount: e.target.value })} />
          {recurringBox(f)}
          {buttons(f)}
        </div>
        {zeroSource(f) ? <div className="warn" style={{ marginTop: 4, fontSize: 11 }}>{NET_ZERO}</div>
          : source && <div className="muted" style={{ marginTop: 4 }}>O valor acompanha a fonte: mudar a fonte em Configurações recalcula este mês e os próximos.</div>}
      </td></tr>
    )
  }
  const saidaForm = (f: Form) => {
    const inst = f.installment.trim(), total = inst.match(/^\d+\/(\d+)$/)?.[1]
    return (
    <tr className="edit" key="form"><td colSpan={4}>
      <div className="row" style={{ alignItems: 'center' }}>
        <input className="in" aria-label="Nome" placeholder="nome" autoFocus style={{ width: 140 }} value={f.name} onChange={e => setForm({ ...f, name: e.target.value })} />
        <input className="in" aria-label="Valor" placeholder="0,00" style={{ width: 90 }} value={f.amount} onChange={e => setForm({ ...f, amount: e.target.value })} />
        <input className="in" aria-label="Parcela" placeholder="n/total" style={{ width: 60 }} value={f.installment} onChange={e => setForm({ ...f, installment: e.target.value })} />
        <Select ariaLabel="Categoria" value={f.categoryId} onChange={v => setForm({ ...f, categoryId: v })} options={[{ value: '', label: 'sem categoria' }, ...categories.map(c => ({ value: c.id, label: c.name }))]} />
        {recurringBox(f, !!total)}
        {buttons(f)}
      </div>
      <div className="muted" style={{ marginTop: 4 }}>
        {total ? `Parcela ${inst}: o mês seguinte já nasce com a próxima, e a linha some depois da ${total}/${total}.` : 'Parcela é opcional (ex.: 3/10). Só linhas recorrentes passam para o mês seguinte.'}
      </div>
    </td></tr>
    )
  }
  const actions = (l: BudgetLine) => (
    <td className="muted r">
      <button className="link" disabled={busy} onClick={() => edit(l)}>editar</button> · <button className="link" disabled={busy} onClick={() => { setForm(null); setError(null); setDel(l) }}>apagar</button>
    </td>
  )
  const confirmDel = (l: BudgetLine) => (
    <div className="note" style={{ marginTop: 8 }}>
      Apagar "{l.name}" deste mês? Os outros meses não mudam.
      <span className="btns" style={{ marginTop: 8 }}>
        <button className="b" disabled={busy} onClick={() => setDel(null)}>Cancelar</button>
        <button className="b pri" disabled={busy} onClick={() => void run('Não foi possível apagar a linha', () => deleteLine(db, l.id)).then(ok => ok && setDel(null))}>Apagar</button>
      </span>
    </div>
  )
  const recur = (l: BudgetLine) => l.recurring && <span className="ic on" title="recorrente">↻</span>

  return (
    <>
      {header}
      {errorBox}
      <div className="kpis">
        <div className="k"><div className="muted">Entradas</div><div className="v">{formatBRL(sum.entradasCents)}</div><div className="s muted">{plural(entradas.length, 'linha', 'linhas')}</div></div>
        <div className="k"><div className="muted">Saídas</div><div className="v">{formatBRL(sum.saidasCents)}</div>
          <div className="s muted">{plural(saidas.length, 'linha', 'linhas')}{plan.reservedCents > 0 && ` · ${formatBRL(plan.reservedCents)} em investimentos e reservas`}</div></div>
        <div className="k"><div className="muted">Saldo do mês</div><div className={`v ${sum.saldoCents > 0 ? 'up' : sum.saldoCents < 0 ? 'dn' : ''}`}>{sum.saldoCents > 0 ? '+' : ''}{formatBRL(sum.saldoCents)}</div><div className="s muted">entradas − saídas</div></div>
      </div>

      {gastos.data.accounts.length === 0 ? (
        <div className="info">Sem gastos para comparar com o plano: conecte ou importe uma conta em <button className="link" onClick={onOpenGastos}>Últimos gastos</button>.</div>
      ) : (
        <div className="grid2">
          <div className="card">
            <div className="bar"><h5 style={{ margin: 0 }}>Planejado × gasto real até agora</h5><span className="muted">{Math.round(progress * 100)}% do mês passou</span></div>
            <div style={{ margin: '10px 0 4px', fontSize: 12 }}><b style={{ color: '#fff' }}>{formatBRL(pvr.realSpentCents)}</b> <span className="t2">gastos de {formatBRL(plan.plannedCents)} planejados</span></div>
            <Track real={pvr.realSpentCents} planned={plan.plannedCents} mark={progress} />
            <div className="muted" style={{ marginTop: 6 }}>A marca branca é o quanto do mês já passou. Investimentos e reservas não entram no gasto, igual ao Resumo de gastos.</div>
          </div>
          <div className="card">
            <div className="bar"><h5 style={{ margin: 0 }}>Por categoria</h5><span className="muted">planejado × real</span></div>
            <div style={{ marginTop: 6 }}>
              {byCategory.length === 0 ? <div className="muted">Nenhuma saída ligada a uma categoria de gasto.</div> : byCategory.map(b => (
                <div key={b.categoryId} className="catrow">
                  <span>{catName(b.categoryId)}</span>
                  <Track real={b.realCents} planned={b.plannedCents} />
                  <span className="r" style={b.realCents > b.plannedCents ? { color: 'var(--negative)' } : undefined}>{formatCents(b.realCents)} de {formatCents(b.plannedCents)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="card" style={{ marginTop: 12, borderColor: '#2c3a14' }}>
          <div className="bar"><h5 style={{ margin: 0 }}>Sugestões dos seus gastos <span className="muted">({suggestions.length})</span></h5><span className="muted">nada entra no plano sem você aceitar</span></div>
          {suggestions.map(s => (
            <div key={s.key} className="sug">
              <span className="pill">{s.reason}</span>
              <span className="grow"><b style={{ color: '#fff' }}>{s.name}</b> {s.installmentCurrent !== null && <span className="tag">{s.installmentCurrent}/{s.installmentTotal}</span>} <span className="muted">· {catName(s.categoryId) ?? 'sem categoria'}</span></span>
              <span className="r">{formatCents(s.amountCents)}</span>
              <button className="b" disabled={busy} onClick={() => accept(s)}>Aceitar</button>
              <button className="b ghost" disabled={busy} onClick={() => open('saida', {
                name: s.name, amount: formatCents(s.amountCents), categoryId: s.categoryId ?? '', recurring: s.recurring, sourceKey: s.key,
                installment: s.installmentCurrent !== null ? `${s.installmentCurrent}/${s.installmentTotal}` : '',
              })}>Ajustar</button>
              <button className="b ghost" disabled={busy} onClick={() => void run('Não foi possível descartar a sugestão', () => dismissSuggestion(db, month, s.key))}>Descartar</button>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="bar"><h5 style={{ margin: 0 }}>Entradas</h5><button className="b ghost" disabled={busy} onClick={() => {
          const s = data.sources[0]
          open('entrada', s ? { sourceId: s.id, name: s.name, amount: formatCents(sourceNet(s, month)) } : {})
        }}>+ Entrada</button></div>
        <div className="muted" style={{ marginTop: 2 }}>Uma entrada pode usar uma fonte de renda (o valor acompanha a fonte) ou ser um valor avulso.</div>
        <div className="table-scroll" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table className="lt" style={{ marginTop: 6 }}>
          <thead><tr><th>Nome</th><th className="r">Valor</th><th></th></tr></thead>
          <tbody>
            {entradas.length === 0 && !(form?.kind === 'entrada' && !form.id) && <tr><td colSpan={3} className="muted">Nenhuma entrada neste mês.</td></tr>}
            {entradas.map(l => {
              if (form?.id === l.id) return entradaForm(form)
              const source = data.sources.find(s => s.id === l.sourceId)
              const pj = source?.kind === 'pj' && l.amountCents === sourceNet(source, month) ? pjNet(source.grossCents ?? 0, source) : null
              return (
                <tr key={l.id}>
                  <td>
                    <div style={{ color: '#fff' }}>{l.name} {source && <span className="pill">{source.kind === 'pj' ? 'fonte PJ' : 'fonte'}</span>} {recur(l)}</div>
                    {pj ? <div className="pj">bruto {formatCents(pj.grossCents)} − IRPJ {formatCents(pj.irpjCents)} − INSS {formatCents(pj.inssCents)} − contabilidade {formatCents(pj.contabilidadeCents)} − outros {formatCents(pj.outrosCents)} · pró-labore {formatCents(pj.proLaboreCents)}</div>
                      : !source ? <div className="d2">valor avulso{l.recurring ? '' : ' · só este mês'}</div>
                      : source.kind === 'clt' && cltTabelaAno(Number(month.slice(0, 4))) !== Number(month.slice(0, 4)) && <div className="d2">usando a tabela de {cltTabelaAno(Number(month.slice(0, 4)))}</div>}
                  </td>
                  <td className="r">{formatCents(l.amountCents)}</td>
                  {actions(l)}
                </tr>
              )
            })}
            {form?.kind === 'entrada' && !form.id && entradaForm(form)}
          </tbody>
        </table></div>
        {del?.kind === 'entrada' && confirmDel(del)}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="bar"><h5 style={{ margin: 0 }}>Saídas</h5><button className="b ghost" disabled={busy} onClick={() => open('saida')}>+ Saída</button></div>
        <div className="table-scroll" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table className="lt" style={{ marginTop: 6 }}>
          <thead><tr><th>Nome</th><th>Categoria</th><th className="r">Valor</th><th></th></tr></thead>
          <tbody>
            {saidas.length === 0 && !(form?.kind === 'saida' && !form.id) && <tr><td colSpan={4} className="muted">Nenhuma saída neste mês.</td></tr>}
            {saidas.map(l => form?.id === l.id ? saidaForm(form) : (
              <tr key={l.id}>
                <td>{l.name} {l.installmentCurrent !== null && <span className="tag">{l.installmentCurrent}/{l.installmentTotal}</span>} {recur(l)}</td>
                <td className={l.categoryId ? 't2' : 'muted'}>{catName(l.categoryId) ?? 'sem categoria'}</td>
                <td className="r">{formatCents(l.amountCents)}</td>
                {actions(l)}
              </tr>
            ))}
            {form?.kind === 'saida' && !form.id && saidaForm(form)}
          </tbody>
        </table></div>
        {del?.kind === 'saida' && confirmDel(del)}
      </div>
    </>
  )
}
