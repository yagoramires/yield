import { useState, type ReactNode } from 'react'
import { createMonth, deleteLine, dismissSuggestion, saveLine, type BudgetLine, type Grupo, type IncomeSource, type LineKind } from '../db/orcamentoRepo'
import { addMonths, formatBRL, formatCents } from '../domain/money'
import { blocoOf, cltTabelaAno, copyLines, missingSources, monthSummary, nextMonthLines, pjNet, sourceNet, variaveis, withSources, type Bloco } from '../domain/orcamento'
import { displayName } from '../domain/gastos'
import { suggestForMonth, type Suggestion } from '../domain/sugestoes'
import type { Month } from '../domain/types'
import { todayISO, useData } from '../state/DataProvider'
import { errText, monthName } from './lancamentos/GastosHeader'
import { monthProgress, pace, tetoError, validateLine } from './orcamento/build'
import { Select } from '../ui/Select'

type At = Bloco | 'entrada' // bloco onde o formulário de linha nova aparece
interface Form { id?: string; at: At; kind: LineKind; grupo: Grupo; name: string; amount: string; installment: string; categoryId: string; recurring: boolean; sourceId: string; sourceKey: string | null; position: number }

const NET_ZERO = 'O líquido desta fonte está zerado ou negativo: confira a fonte em Configurações'
const GRUPOS: { value: Grupo; label: string }[] = [{ value: 'fixo', label: 'Custo fixo' }, { value: 'variavel', label: 'Variável (teto)' }, { value: 'meta', label: 'Investimento ou meta' }]
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, (part / whole) * 100) : part > 0 ? 100 : 0)
const lower = (m: Month) => monthName(m).toLowerCase()
const total = (ls: BudgetLine[]) => ls.reduce((s, l) => s + l.amountCents, 0)

function Track({ real, planned }: { real: number; planned: number }) {
  return <div className="track" style={{ height: 6, marginTop: 4 }}><div className={real > planned ? 'fill over' : 'fill'} style={{ width: `${pct(real, planned)}%` }} /></div>
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
            await createMonth(db, next, withSources(nextMonthLines(lines, data.sources), data.sources, next))
          }).then(ok => ok && go(next))}>Criar {lower(next)}</button>
        </div>
      )}
    </div>
  )
  const errorBox = error && <div className="note" style={{ marginTop: 10 }}>{error}</div>

  if (!hasPlan) {
    const prev = data.months.filter(m => m < month).at(-1)
    const copy = prev ? copyLines(data.lines.filter(l => l.month === prev), data.sources, month) : []
    const fresh = withSources([], data.sources, month)
    return (
      <>
        {header}
        {errorBox}
        <div className="card" style={{ marginTop: 40, textAlign: 'center', padding: 28 }}>
          <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{monthName(month)} ainda não tem plano</div>
          <div className="muted" style={{ margin: '6px 0 14px' }}>
            {prev && copy.length ? `Copie as linhas recorrentes de ${lower(prev)} (${plural(copy.length, 'linha', 'linhas')}; parcelas avançam sozinhas) ou comece do zero.` : 'Comece do zero e adicione o que entra e o que sai no mês.'}
            {fresh.length > 0 && ` Suas fontes de renda já entram no mês.`}
          </div>
          <div className="btns" style={{ justifyContent: 'center' }}>
            {prev && copy.length > 0 && <button className="b pri" disabled={busy} onClick={() => void run('Não foi possível copiar o mês', async () => { await createMonth(db, month, withSources(copy, data.sources, month)) })}>Copiar de {lower(prev)}</button>}
            <button className="b" disabled={busy} onClick={() => void run('Não foi possível criar o mês', async () => { await createMonth(db, month, fresh) })}>Começar do zero</button>
          </div>
          <div className="muted" style={{ marginTop: 12 }}>Já tem o orçamento numa planilha? Salve como CSV (mes;tipo;nome;valor) e importe em <button className="link" onClick={onOpenSettings}>Configurações › Importar orçamento (CSV)</button>.</div>
        </div>
      </>
    )
  }

  const entradas = lines.filter(l => l.kind === 'entrada')
  const saidas = lines.filter(l => l.kind === 'saida')
  const of = (b: Bloco) => saidas.filter(l => blocoOf(l) === b)
  const fixos = of('fixo'), parcelas = of('parcela'), metas = of('meta')
  const vars = variaveis(data.lines, gastos.data.txns, gastos.categorize, month)
  const sum = monthSummary(lines)
  const progress = monthProgress(month, today)
  const ritmo = pace(vars.realCents, progress)
  const hasTxns = gastos.data.accounts.length > 0
  const missing = missingSources(lines, data.sources).filter(s => sourceNet(s, month) > 0)
  const dismissed = data.dismissed.filter(d => d.month === month).map(d => d.key)
  const suggestions = suggestForMonth(month, gastos.subscriptions, gastos.data.txns, gastos.categorize, data.lines, dismissed)

  const open = (at: At, f: Partial<Form> = {}) => {
    setDel(null); setError(null)
    setForm({ at, kind: at === 'entrada' ? 'entrada' : 'saida', grupo: at === 'variavel' || at === 'meta' ? at : 'fixo', name: '', amount: '', installment: '', categoryId: '', recurring: true, sourceId: '', sourceKey: null, position: 0, ...f })
  }
  const edit = (l: BudgetLine) => open(l.kind === 'entrada' ? 'entrada' : blocoOf(l), {
    id: l.id, grupo: l.grupo ?? 'fixo', name: shown(l), amount: formatCents(l.amountCents), recurring: l.recurring, categoryId: l.categoryId ?? '', sourceId: l.sourceId ?? '', sourceKey: l.sourceKey, position: l.position,
    installment: l.installmentCurrent !== null && l.installmentTotal !== null ? `${l.installmentCurrent}/${l.installmentTotal}` : '',
  })
  // só o nome que veio do extrato (sugestão aceita) é limpo; o que a pessoa digitou fica como está
  const shown = (l: BudgetLine) => (/^(sub|parc):/.test(l.sourceKey ?? '') ? displayName(l.name) : l.name)
  const fromSource = (s: IncomeSource) => ({ sourceId: s.id, name: s.name, amount: formatCents(sourceNet(s, month)) })
  // fonte com líquido ≤ 0 trazida para o formulário: o parseMoney daria um erro genérico
  const zeroSource = (f: Form) => {
    const s = f.kind === 'entrada' ? data.sources.find(x => x.id === f.sourceId) : undefined
    return !!s && sourceNet(s, month) <= 0 && f.amount === formatCents(sourceNet(s, month))
  }
  const save = (f: Form) => void run('Não foi possível salvar a linha', async () => {
    if (zeroSource(f)) throw new Error(NET_ZERO)
    if (f.kind === 'entrada' && f.sourceId && entradas.some(l => l.id !== f.id && l.sourceId === f.sourceId)) throw new Error('Esta fonte já está no mês: edite a entrada dela ou escolha Valor avulso.')
    if (f.at === 'parcela' && !f.installment.trim()) throw new Error('Parcela: use n/total, por exemplo 3/10.')
    const v = validateLine(f.at === 'parcela' ? f : { ...f, installment: '' })
    const teto = f.kind === 'saida' && f.at !== 'parcela' && f.grupo === 'variavel' ? tetoError(lines, f.id, f.categoryId) : null
    if (teto) throw new Error(teto)
    await saveLine(db, {
      id: f.id, month, kind: f.kind, name: v.name, amountCents: v.amountCents, recurring: v.recurring, position: f.position,
      categoryId: f.kind === 'saida' ? f.categoryId || null : null, installmentCurrent: v.installmentCurrent, installmentTotal: v.installmentTotal,
      sourceId: f.kind === 'entrada' ? f.sourceId || null : null, sourceKey: f.sourceKey, grupo: f.kind === 'saida' ? f.grupo : null,
    })
  }).then(ok => ok && setForm(null))
  const include = (s: IncomeSource) => void run('Não foi possível incluir a fonte', async () => {
    await saveLine(db, { month, kind: 'entrada', name: s.name, amountCents: sourceNet(s, month), recurring: true, position: 0, categoryId: null, installmentCurrent: null, installmentTotal: null, sourceId: s.id, sourceKey: null, grupo: null })
  })
  const accept = (s: Suggestion) => void run('Não foi possível aceitar a sugestão', async () => {
    await saveLine(db, { month, kind: 'saida', name: s.name, amountCents: s.amountCents, recurring: s.recurring, categoryId: s.categoryId, installmentCurrent: s.installmentCurrent, installmentTotal: s.installmentTotal, sourceId: null, sourceKey: s.key, position: 0, grupo: 'fixo' })
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
      <tr className="edit" key="form"><td colSpan={2}>
        <div className="row" style={{ alignItems: 'center' }}>
          <Select ariaLabel="Fonte" value={f.sourceId} onChange={v => {
            const s = data.sources.find(x => x.id === v)
            setForm(s ? { ...f, ...fromSource(s) } : { ...f, sourceId: '' })
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
    const parcela = f.at === 'parcela', last = f.installment.trim().match(/^\d+\/(\d+)$/)?.[1]
    return (
      <tr className="edit" key="form"><td colSpan={2}>
        <div className="row" style={{ alignItems: 'center' }}>
          <input className="in" aria-label="Nome" placeholder="nome" autoFocus style={{ width: 140 }} value={f.name} onChange={e => setForm({ ...f, name: e.target.value })} />
          <input className="in" aria-label="Valor" placeholder="0,00" style={{ width: 90 }} value={f.amount} onChange={e => setForm({ ...f, amount: e.target.value })} />
          {parcela ? <input className="in" aria-label="Parcela" placeholder="n/total" style={{ width: 60 }} value={f.installment} onChange={e => setForm({ ...f, installment: e.target.value })} />
            : <Select ariaLabel="Bloco" value={f.grupo} onChange={v => setForm({ ...f, grupo: v as Grupo })} options={GRUPOS} />}
          <Select ariaLabel="Categoria" value={f.categoryId} onChange={v => setForm({ ...f, categoryId: v })} options={[{ value: '', label: 'sem categoria' }, ...categories.map(c => ({ value: c.id, label: c.name }))]} />
          {recurringBox(f, parcela)}
          {buttons(f)}
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          {parcela ? (last ? `Parcela ${f.installment.trim()}: o mês seguinte já nasce com a próxima, e a linha some depois da ${last}/${last}.` : 'Informe a parcela atual e o total, por exemplo 3/10.')
            : f.grupo === 'variavel' ? 'O teto é para a categoria: o gasto real vem dos lançamentos dela no mês.'
            : 'Só linhas recorrentes passam para o mês seguinte.'}
        </div>
      </td></tr>
    )
  }
  const actions = (l: BudgetLine) => (
    <span className="acts muted">
      <button className="link" disabled={busy} onClick={() => edit(l)}>editar</button> · <button className="link" disabled={busy} onClick={() => { setForm(null); setError(null); setDel(l) }}>apagar</button>
    </span>
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
  // nome em cima, o resto numa linha só embaixo
  const nameCell = (l: BudgetLine, sub: (string | null | false | undefined)[]) => {
    const info = sub.filter(Boolean).join(' · ')
    return <td><div className="nm" title={l.name}><span>{shown(l)}</span>{actions(l)}</div>{info && <div className="d2">{info}</div>}</td>
  }

  // um bloco da tela: linhas do bloco, formulário no lugar da linha editada e o de linha nova no fim
  const block = (at: At, title: string, ls: BudgetLine[], value: ReactNode, row: (l: BudgetLine) => ReactNode, opts: { empty: string; add?: () => void; hint?: ReactNode; extra?: ReactNode }) => {
    const formRow = (f: Form) => (f.kind === 'entrada' ? entradaForm(f) : saidaForm(f))
    const inBlock = (l: BudgetLine) => (l.kind === 'entrada' ? 'entrada' : blocoOf(l)) === at
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="bar">
          <h5 style={{ margin: 0 }}>{title}</h5>
          <span className="row" style={{ alignItems: 'center', gap: 10 }}>{(ls.length > 0 || opts.extra) && <b style={{ color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{value}</b>}
            <button className="b ghost" disabled={busy} onClick={opts.add ?? (() => open(at))}>+</button></span>
        </div>
        {opts.hint && <div className="muted" style={{ marginTop: 2 }}>{opts.hint}</div>}
        <table className="lt blk" style={{ marginTop: 6 }}>
          <tbody>
            {ls.length === 0 && !opts.extra && !(form?.at === at && !form.id) && <tr><td colSpan={2} className="muted">{opts.empty}</td></tr>}
            {ls.map(l => (form?.id === l.id ? formRow(form) : <tr key={l.id}>{row(l)}</tr>))}
            {opts.extra}
            {form?.at === at && !form.id && formRow(form)}
          </tbody>
        </table>
        {del && inBlock(del) && confirmDel(del)}
      </div>
    )
  }

  const entradaRow = (l: BudgetLine) => {
    const source = data.sources.find(s => s.id === l.sourceId)
    const pj = (source?.kind === 'pj' || source?.kind === 'mei') && l.amountCents === sourceNet(source, month) ? pjNet(source.grossCents ?? 0, source) : null
    const ano = Number(month.slice(0, 4))
    const kind = !source ? 'valor avulso' : source.kind === 'pj' ? 'PJ' : source.kind === 'mei' ? 'MEI' : source.kind === 'clt' ? 'CLT' : 'fonte'
    const detail = pj ? `bruto ${formatCents(pj.grossCents)} − ${formatCents(pj.grossCents - pj.netCents)} de ${source?.kind === 'mei' ? 'DAS e custos' : 'impostos e custos'}`
      : source?.kind === 'clt' ? `líquido de INSS e IRRF${cltTabelaAno(ano) !== ano ? ` (tabela de ${cltTabelaAno(ano)})` : ''}` : null
    const full = pj && source?.kind !== 'mei' ? `imposto ${formatCents(pj.irpjCents)} · INSS ${formatCents(pj.inssCents)} · contabilidade ${formatCents(pj.contabilidadeCents)} · outros ${formatCents(pj.outrosCents)} · pró-labore ${formatCents(pj.proLaboreCents)}` : undefined
    return (
      <>
        <td title={full}><div className="nm"><span>{l.name}</span>{actions(l)}</div><div className="d2">{[kind, detail, !l.recurring && 'só este mês'].filter(Boolean).join(' · ')}</div></td>
        <td className="r">{formatCents(l.amountCents)}</td>
      </>
    )
  }
  const plainRow = (l: BudgetLine) => (
    <>
      {nameCell(l, [l.sourceKey?.startsWith('sub:') && !/^assinatura/i.test(catName(l.categoryId) ?? '') && 'assinatura', catName(l.categoryId), !l.recurring && 'só este mês'])}
      <td className="r">{formatCents(l.amountCents)}</td>
    </>
  )
  const parcelaRow = (l: BudgetLine) => {
    const n = l.installmentCurrent!, last = l.installmentTotal!
    return (
      <>
        {nameCell(l, [`${n} de ${last}`, n >= last ? 'última' : `acaba em ${lower(addMonths(month, last - n))}`])}
        <td className="r">{formatCents(l.amountCents)}</td>
      </>
    )
  }
  const tetoRow = (l: BudgetLine) => {
    const real = vars.tetos.find(t => t.line.id === l.id)?.realCents ?? null
    return (
      <>
        <td>
          <div className="nm" title={l.name}><span>{shown(l)} {l.categoryId && catName(l.categoryId) !== l.name && <span className="muted">· {catName(l.categoryId)}</span>}</span>{actions(l)}</div>
          {real === null ? <div className="d2">escolha uma categoria para acompanhar o gasto</div> : hasTxns && <Track real={real} planned={l.amountCents} />}
        </td>
        <td className="r" style={{ whiteSpace: 'nowrap', ...(real !== null && real > l.amountCents ? { color: 'var(--negative)' } : {}) }}>
          {real === null || !hasTxns ? formatCents(l.amountCents) : `${formatCents(real)} / ${formatCents(l.amountCents)}`}
        </td>
      </>
    )
  }

  const varNote = !vars.tetos.length ? 'nenhum teto definido' : !hasTxns ? 'sem lançamentos para comparar'
    : progress >= 1 ? 'mês fechado' : progress <= 0 ? 'o mês ainda não começou'
    : `${Math.round(progress * 100)}% do mês${ritmo !== null ? ` · no ritmo fecha em ${formatBRL(ritmo)}` : ''}`
  const metasCents = total(metas)

  return (
    <>
      {header}
      {errorBox}
      <div className="kpis">
        <div className="k"><div className="muted">O que entra</div><div className="v">{formatBRL(sum.entradasCents)}</div><div className="s muted">{plural(entradas.length, 'entrada', 'entradas')} · líquido</div></div>
        <div className="k"><div className="muted">Fixos + parcelas</div><div className="v">{formatBRL(total(fixos) + total(parcelas))}</div><div className="s muted">{plural(fixos.length, 'custo fixo', 'custos fixos')} · {plural(parcelas.length, 'parcela', 'parcelas')}</div></div>
        <div className="k"><div className="muted">Variáveis</div><div className="v">{!vars.tetos.length ? '—' : hasTxns ? <>{formatBRL(vars.realCents)} <span className="muted" style={{ fontSize: 12 }}>de {formatBRL(vars.plannedCents)}</span></> : formatBRL(vars.plannedCents)}</div><div className="s muted">{varNote}</div></div>
        <div className="k"><div className="muted">Sobra</div><div className={`v ${sum.saldoCents > 0 ? 'up' : sum.saldoCents < 0 ? 'dn' : ''}`}>{sum.saldoCents > 0 ? '+' : ''}{formatBRL(sum.saldoCents)}</div><div className="s muted">{metasCents > 0 ? `depois de investir ${formatBRL(metasCents)}` : 'o que entra − o que sai'}</div></div>
      </div>

      {suggestions.length > 0 && (
        <div className="card" style={{ marginBottom: 12, borderColor: '#2c3a14' }}>
          <div className="bar"><h5 style={{ margin: 0 }}>Sugestões dos seus gastos <span className="muted">({suggestions.length})</span></h5><span className="muted">nada entra no plano sem você aceitar</span></div>
          {suggestions.map(s => (
            <div key={s.key} className="sug">
              <span className="pill">{s.reason}</span>
              <span className="grow"><b style={{ color: '#fff' }}>{s.name}</b> {s.installmentCurrent !== null && <span className="tag">{s.installmentCurrent}/{s.installmentTotal}</span>} <span className="muted">· {catName(s.categoryId) ?? 'sem categoria'}</span></span>
              <span className="r">{formatCents(s.amountCents)}</span>
              <button className="b" disabled={busy} onClick={() => accept(s)}>Aceitar</button>
              <button className="b ghost" disabled={busy} onClick={() => open(s.reason === 'parcela' ? 'parcela' : 'fixo', {
                name: s.name, amount: formatCents(s.amountCents), categoryId: s.categoryId ?? '', recurring: s.recurring, sourceKey: s.key,
                installment: s.installmentCurrent !== null ? `${s.installmentCurrent}/${s.installmentTotal}` : '',
              })}>Ajustar</button>
              <button className="b ghost" disabled={busy} onClick={() => void run('Não foi possível descartar a sugestão', () => dismissSuggestion(db, month, s.key))}>Descartar</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid2" style={{ alignItems: 'start' }}>
        <div>
          {block('entrada', 'O que eu ganho', entradas, formatCents(sum.entradasCents), entradaRow, {
            empty: data.sources.length ? 'Nenhuma entrada neste mês.' : 'Nenhuma entrada. Cadastre seus salários em Configurações › Fontes de renda e eles entram sozinhos todo mês.',
            add: () => open('entrada', missing[0] ? fromSource(missing[0]) : {}),
            extra: missing.length > 0 && missing.map(s => (
              <tr key={`fonte-${s.id}`}>
                <td className="muted"><div className="nm"><span className="muted">{s.name}</span><button className="link" disabled={busy} onClick={() => include(s)}>incluir</button></div><div className="d2">fonte de renda · não está neste mês</div></td>
                <td className="r muted">{formatCents(sourceNet(s, month))}</td>
              </tr>
            )),
          })}
          {block('variavel', 'Custos variáveis', vars.tetos.map(t => t.line), hasTxns ? `${formatCents(vars.realCents)} de ${formatCents(vars.plannedCents)}` : formatCents(vars.plannedCents), tetoRow, {
            empty: 'Um teto por categoria (mercado, restaurante, lazer…); o gasto real vem dos lançamentos.',
            hint: !hasTxns && <>Para ver o gasto real, conecte ou importe uma conta em <button className="link" onClick={onOpenGastos}>Últimos gastos</button>.</>,
          })}
          {block('meta', 'Investimentos e metas', metas, formatCents(metasCents), plainRow, { empty: 'Aportes e reservas que você separa todo mês. Não contam como gasto.' })}
        </div>
        <div>
          {block('fixo', 'Custos fixos', fixos, formatCents(total(fixos)), plainRow, { empty: 'Assinaturas e contas que se repetem. As assinaturas detectadas aparecem nas sugestões acima.' })}
          {block('parcela', 'Parcelas', parcelas, formatCents(total(parcelas)), parcelaRow, { empty: 'Compras parceladas; somem sozinhas depois da última.' })}
        </div>
      </div>
    </>
  )
}
