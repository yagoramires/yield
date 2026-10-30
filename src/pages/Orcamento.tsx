import { useState, type ReactNode } from 'react'
import { Insights } from './assistente/Insights'
import type { Route } from '../ui/routes'
import { ChevronRight, Plus } from 'lucide-react'
import { createMonth, deleteLine, dismissSuggestion, saveFixedCategories, saveGoals, saveLine, saveReservaLinks, saveReservas, type BudgetLine, type Grupo, type IncomeSource, type LineKind } from '../db/orcamentoRepo'
import { addMonths, editCents, formatBRL, formatCents } from '../domain/money'
import { averageByCategory, blocoOf, cltTabelaAno, copyLines, custos, goalsFor, investido, type InvGroup, missingSources, monthSummary, nextMonthLines, pjNet, sourceNet, withSources, type Bloco, type VarRow } from '../domain/orcamento'
import { displayName } from '../domain/gastos'
import { reservaInvestments } from '../domain/bancoInvest'
import { ago } from '../ui/SyncStatus'
import { suggestForMonth, type Suggestion } from '../domain/sugestoes'
import type { Month } from '../domain/types'
import { todayISO, useData } from '../state/DataProvider'
import { accountLabel, brDay, errText, monthName } from './lancamentos/GastosHeader'
import { monthProgress, pace, validateLine } from './orcamento/build'
import { Metas } from './orcamento/Metas'
import { Select } from '../ui/Select'
import { CategoryIcon, IconGlyph } from '../ui/CategoryIcon'
import { TINT } from '../ui/palette'

type At = Bloco | 'entrada' // bloco onde o formulário de linha nova aparece
interface Form { id?: string; at: At; kind: LineKind; grupo: Grupo; name: string; amount: string; installment: string; categoryId: string; recurring: boolean; sourceId: string; sourceKey: string | null; position: number }

const NET_ZERO = 'O líquido desta fonte está zerado ou negativo: confira a fonte em Configurações'
const GRUPOS: { value: Grupo; label: string }[] = [{ value: 'fixo', label: 'Custo fixo' }, { value: 'variavel', label: 'Gasto variável' }, { value: 'meta', label: 'Investimento' }]
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, (part / whole) * 100) : part > 0 ? 100 : 0)
const lower = (m: Month) => monthName(m).toLowerCase()
// ícone de cada tipo de fonte de renda (avulso = sem fonte)
const SOURCE_LOOK: Record<string, [string, string]> = { clt: ['briefcase-business', '#c6ff3d'], pj: ['landmark', TINT.azul], mei: ['store', TINT.violeta], fixo: ['piggy-bank', TINT.turquesa], avulso: ['gift', TINT.areia] }
const SourceIcon = ({ kind, dim }: { kind: string; dim?: boolean }) => <span style={dim ? { opacity: 0.45 } : undefined}><IconGlyph name={SOURCE_LOOK[kind][0]} color={SOURCE_LOOK[kind][1]} size={28} /></span>
const total = (ls: BudgetLine[]) => ls.reduce((s, l) => s + l.amountCents, 0)

// soft: a referência é a média, não uma meta (passar dela é aviso, não estouro)
function Track({ real, planned, soft }: { real: number; planned: number; soft?: boolean }) {
  return <div className="track" style={{ height: 6, marginTop: 4 }}><div className={`fill${soft ? ' soft' : ''}${real > planned ? ' over' : ''}`} style={{ width: `${pct(real, planned)}%` }} /></div>
}

export function Orcamento({ onNavigate, onOpenGastos, onOpenSettings }: { onNavigate(r: Route): void; onOpenGastos(): void; onOpenSettings(): void }) {
  const { db, gastos, orcamento, data: carteira } = useData()
  const { data, month, setMonth, reload } = orcamento
  const [form, setForm] = useState<Form | null>(null)
  const [del, setDel] = useState<BudgetLine | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metasOpen, setMetasOpen] = useState(false)
  const [openCats, setOpenCats] = useState<Set<string>>(new Set()) // categorias abertas no cartão de custos
  const [tab, setTab] = useState<'fixos' | 'variaveis'>('variaveis')

  // toda escrita passa por aqui: recarrega e mostra o erro em pt-BR na tela
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn(); await reload(); setError(null) } catch (e) { setError(`${what}: ${errText(e)}`); setBusy(false); return false }
    setBusy(false)
    return true
  }
  const go = (m: Month) => { setForm(null); setDel(null); setError(null); setMetasOpen(false); setMonth(m) }

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
      {hasPlan && (
        <div className="btns">
          <button className={metasOpen ? 'b' : 'b ghost'} disabled={busy} onClick={() => { setForm(null); setDel(null); setMetasOpen(!metasOpen) }}>Metas</button>
          {!data.months.includes(next) && <button className="b pri" disabled={busy} onClick={() => void run(`Não foi possível criar ${lower(next)}`, async () => {
            await createMonth(db, next, withSources(nextMonthLines(lines, data.sources), data.sources, next))
          }).then(ok => ok && go(next))}>Criar {lower(next)}</button>}
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
  const fixos = of('fixo'), parcelas = of('parcela')
  const goals = goalsFor(data.goals, data.months, month, categories)
  const avgs = averageByCategory(gastos.data.txns, gastos.categorize, month)
  const vars = custos(data.lines, gastos.data.txns, gastos.categorize, month, goals, new Set(data.fixedCategories))
  const inv = investido(data.lines, gastos.data.txns, gastos.categorize, month, goals, new Set(data.reservas))
  const sum = monthSummary(lines)
  const progress = monthProgress(month, today)
  const ritmo = pace(vars.realCents, progress)
  const hasTxns = gastos.data.accounts.length > 0
  const missing = missingSources(lines, data.sources).filter(s => sourceNet(s, month) > 0)
  const dismissed = data.dismissed.filter(d => d.month === month).map(d => d.key)
  const suggestions = suggestForMonth(month, gastos.subscriptions, gastos.data.txns, gastos.categorize, data.lines, dismissed)

  const open = (at: At, f: Partial<Form> = {}) => {
    setDel(null); setError(null)
    // gasto ou aporte à mão é do mês: repetido no mês seguinte já nasceria como gasto feito
    const manual = at === 'variavel' || at === 'meta'
    if (at === 'fixo' || at === 'variavel') setTab(at === 'fixo' ? 'fixos' : 'variaveis')
    setForm({ at, kind: at === 'entrada' ? 'entrada' : 'saida', grupo: manual ? at : 'fixo', name: '', amount: '', installment: '', categoryId: '', recurring: !manual, sourceId: '', sourceKey: null, position: 0, ...f })
  }
  const edit = (l: BudgetLine) => open(l.kind === 'entrada' ? 'entrada' : blocoOf(l), {
    id: l.id, grupo: l.grupo ?? 'fixo', name: shown(l), amount: editCents(l.amountCents), recurring: l.recurring, categoryId: l.categoryId ?? '', sourceId: l.sourceId ?? '', sourceKey: l.sourceKey, position: l.position,
    installment: l.installmentCurrent !== null && l.installmentTotal !== null ? `${l.installmentCurrent}/${l.installmentTotal}` : '',
  })
  // só o nome que veio do extrato (sugestão aceita) é limpo; o que a pessoa digitou fica como está
  const shown = (l: BudgetLine) => (/^(sub|parc):/.test(l.sourceKey ?? '') ? displayName(l.name) : l.name)
  const fromSource = (s: IncomeSource) => ({ sourceId: s.id, name: s.name, amount: editCents(sourceNet(s, month)) })
  // fonte com líquido ≤ 0 trazida para o formulário: o parseMoney daria um erro genérico
  const zeroSource = (f: Form) => {
    const s = f.kind === 'entrada' ? data.sources.find(x => x.id === f.sourceId) : undefined
    return !!s && sourceNet(s, month) <= 0 && f.amount === editCents(sourceNet(s, month))
  }
  const save = (f: Form) => void run('Não foi possível salvar a linha', async () => {
    if (zeroSource(f)) throw new Error(NET_ZERO)
    if (f.kind === 'entrada' && f.sourceId && entradas.some(l => l.id !== f.id && l.sourceId === f.sourceId)) throw new Error('Esta fonte já está no mês: edite a entrada dela ou escolha Valor avulso.')
    if (f.at === 'parcela' && !f.installment.trim()) throw new Error('Parcela: use n/total, por exemplo 3/10.')
    const v = validateLine(f.at === 'parcela' ? f : { ...f, installment: '' })
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
            : f.grupo === 'variavel' ? 'Gasto que não aparece nos lançamentos (em dinheiro, por exemplo); vale só para este mês.'
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
  const block = (at: At, title: string, ls: BudgetLine[], value: ReactNode, row: (l: BudgetLine) => ReactNode, opts: { empty: string; add?: () => void; hint?: ReactNode; extra?: ReactNode; goal?: { real: number; goal: number } }) => {
    const formRow = (f: Form) => (f.kind === 'entrada' ? entradaForm(f) : saidaForm(f))
    const inBlock = (l: BudgetLine) => (l.kind === 'entrada' ? 'entrada' : blocoOf(l)) === at
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="bar">
          <h5 style={{ margin: 0 }}>{title}</h5>
          <span className="row" style={{ alignItems: 'center', gap: 10 }}>{(ls.length > 0 || opts.extra || opts.goal) && <b style={{ color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{value}</b>}
            <button className="b ghost sq" aria-label={`Adicionar em ${title}`} disabled={busy} onClick={opts.add ?? (() => open(at))}><Plus size={14} aria-hidden /></button></span>
        </div>
        {opts.goal && <Track real={opts.goal.real} planned={opts.goal.goal} />}
        {opts.hint && <div className="muted" style={{ marginTop: 2 }}>{opts.hint}</div>}
        <table className="lt blk" style={{ marginTop: 6 }}>
          <tbody>
            {ls.length === 0 && !opts.extra && !(form?.at === at && !form.id) && <tr><td colSpan={2} className="muted">{opts.empty}</td></tr>}
            {opts.extra}
            {ls.map(l => (form?.id === l.id ? formRow(form) : <tr key={l.id}>{row(l)}</tr>))}
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
        <td className="ell-cell" title={full}><div className="cat-line">
          <SourceIcon kind={source?.kind ?? 'avulso'} />
          <div className="grow"><div className="nm"><span>{l.name}</span>{actions(l)}</div><div className="d2">{[kind, detail, !l.recurring && 'só este mês'].filter(Boolean).join(' · ')}</div></div>
        </div></td>
        <td className="r">{formatCents(l.amountCents)}</td>
      </>
    )
  }
  const plainRow = (l: BudgetLine) => (
    <>
      {nameCell(l, [l.sourceKey?.startsWith('sub:') && !/^assinatura/i.test(catName(l.categoryId) ?? '') && 'assinatura', catName(l.categoryId), !l.recurring && 'só este mês',
        vars.paid.has(l.id) && `pago ${brDay(vars.paid.get(l.id)!.date)} ✓`, fatura(l) && 'fora da sobra: as compras do cartão já entram nos variáveis'])}
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
  // categoria puxada dos lançamentos: o gasto do mês, a barra contra a meta (ou a média) e, aberta, a lista dos gastos
  // nos fixos não há média: ela somaria o que já foi pago pelo plano
  const catRow = (r: VarRow, fixed = false) => {
    const avg = r.categoryId && !fixed ? avgs.get(r.categoryId) ?? null : null
    const ref = r.goalCents ?? avg, soft = r.goalCents === null
    const over = ref !== null && r.realCents > ref
    const key = r.categoryId ?? 'sem', opened = openCats.has(key)
    const toggle = () => { const n = new Set(openCats); if (opened) n.delete(key); else n.add(key); setOpenCats(n) }
    const note = r.goalCents !== null ? (over ? `passou ${formatCents(r.realCents - r.goalCents)}` : `de ${formatCents(r.goalCents)}`)
      : avg ? `média ${formatCents(avg)}${over ? ` · +${Math.round((r.realCents / avg - 1) * 100)}%` : ''}` : null
    return [
      <tr key={`cat-${key}`} className={`acc${opened ? ' open' : ''}`} onClick={e => { if (r.txns.length && !(e.target as HTMLElement).closest('button')) toggle() }}>
        <td className="ell-cell">
          <div className="cat-line">
            <CategoryIcon category={categories.find(c => c.id === r.categoryId) ?? null} size={28} />
            <div className="grow">
              <button className="cat-toggle" aria-expanded={opened} disabled={!r.txns.length} onClick={toggle}>
                {catName(r.categoryId) ?? 'Sem categoria'} {r.txns.length > 0 && <span className="muted">{plural(r.txns.length, 'gasto', 'gastos')}<ChevronRight size={12} className="chev" aria-hidden /></span>}
              </button>
              {ref !== null && <Track real={r.realCents} planned={ref} soft={soft} />}
            </div>
          </div>
        </td>
        <td className="r" style={{ whiteSpace: 'nowrap', ...(over ? { color: soft ? 'var(--warn)' : 'var(--negative)' } : {}) }}>
          {formatCents(r.realCents)}{note && <div className="d2" style={{ textAlign: 'right' }}>{note}</div>}
        </td>
      </tr>,
      ...(opened ? [
        <tr key={`l-${key}`} className="sub"><td colSpan={2}><div className="txn-list">{r.txns.map(t => (
          <div key={t.id} className="it"><span className="muted">{brDay(t.date)}</span><span className="ell" title={t.description}>{displayName(t.description)}{t.pending && <span className="muted"> · pendente</span>}</span><span>{formatCents(-t.amountCents)}</span></div>
        ))}</div></td></tr>,
      ] : []),
    ]
  }
  // destino de investimento ou reserva: o saldo do mês (aplicado − resgatado) e, aberto, cada movimento
  const toggleReserva = (key: string) => void run('Não foi possível mudar o destino', () =>
    saveReservas(db, data.reservas.includes(key) ? data.reservas.filter(k => k !== key) : [...data.reservas, key]))
  // reserva ligada a um investimento do banco mostra o saldo dele hoje; o movimento do mês fica embaixo
  const liveInv = carteira.bankInvestments.filter(b => gastos.data.pluggyItems.some(i => i.itemId === b.itemId))
  const linked = reservaInvestments(data.reservas, liveInv, data.reservaLinks)
  const saldoOf = (k: string) => { const l = linked.get(k) ?? []; return l.length ? l.reduce((s, b) => s + b.balanceCents, 0) : null }
  // reserva sem movimento no mês continua aparecendo pelo saldo do banco
  const reservaGroups: InvGroup[] = [...inv.reservas, ...data.reservas.filter(k => !inv.reservas.some(g => g.key === k) && saldoOf(k) !== null)
    .map(k => ({ key: k, name: linked.get(k)![0].name, inCents: 0, outCents: 0, netCents: 0, txns: [] }))]
  const reservaSaldo = reservaGroups.map(g => saldoOf(g.key)).filter((c): c is number => c !== null)
  const linkReserva = (k: string, id: string) => void run('Não foi possível ligar a reserva', () => {
    const links = { ...data.reservaLinks }
    if (id) links[k] = id; else delete links[k]
    return saveReservaLinks(db, links)
  })
  const groupRow = (g: InvGroup, reserva: boolean) => {
    const key = `inv:${g.key}`, opened = openCats.has(key)
    const saldo = reserva ? saldoOf(g.key) : null
    const toggle = () => { const n = new Set(openCats); if (opened) n.delete(key); else n.add(key); setOpenCats(n) }
    const ins = g.txns.filter(t => t.amountCents < 0).length, outs = g.txns.length - ins
    return [
      <tr key={key} className={g.txns.length ? `acc${opened ? ' open' : ''}` : undefined} onClick={e => { if (g.txns.length && !(e.target as HTMLElement).closest('button')) toggle() }}>
        <td className="ell-cell"><div className="cat-line">
          {reserva ? <IconGlyph name="piggy-bank" color={TINT.turquesa} size={28} /> : <CategoryIcon category={gastos.categorize(g.txns[0])} size={28} />}
          <div className="grow"><div className="nm">
            <button className="cat-toggle" aria-expanded={opened} disabled={!g.txns.length} onClick={toggle}>{g.name} <span className="muted">{g.txns.length ? [ins > 0 && plural(ins, reserva ? 'depósito' : 'aplicação', reserva ? 'depósitos' : 'aplicações'), outs > 0 && plural(outs, 'resgate', 'resgates')].filter(Boolean).join(' · ') : 'sem movimento no mês'}{g.txns.length > 0 && <ChevronRight size={12} className="chev" aria-hidden />}</span></button>
            <span className="acts muted"><button className="link" disabled={busy} onClick={() => toggleReserva(g.key)}>{reserva ? 'é investimento' : 'é reserva'}</button></span>
          </div></div>
        </div></td>
        <td className="r" style={{ whiteSpace: 'nowrap' }}>{saldo !== null ? <>{formatCents(saldo)}<div className="d2" style={{ textAlign: 'right' }}>{g.netCents > 0 ? '+' : ''}{formatCents(g.netCents)} este mês</div></>
          : <>{reserva && g.netCents > 0 ? '+' : ''}{formatCents(g.netCents)}{g.outCents > 0 && <div className="d2" style={{ textAlign: 'right' }}>{formatCents(g.inCents)} − {formatCents(g.outCents)}</div>}</>}</td>
      </tr>,
      ...(reserva && liveInv.length > 0 ? [
        <tr key={`link-${key}`} className="sub"><td colSpan={2}><div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <span className="muted">{saldo === null ? 'Qual investimento do banco é esta reserva?' : 'Ligada a'}</span>
          <Select small ariaLabel={`Investimento da reserva ${g.name}`} value={data.reservaLinks[g.key] ?? ''} onChange={v => linkReserva(g.key, v)}
            options={[{ value: '', label: saldo === null ? 'escolha' : 'pelo nome' }, ...liveInv.map(b => ({ value: b.id, label: `${b.name} · ${formatCents(b.balanceCents)}` }))]} />
        </div></td></tr>,
      ] : []),
      ...(opened ? [<tr key={`l-${key}`} className="sub"><td colSpan={2}><div className="txn-list">{g.txns.map(t => (
        <div key={t.id} className="it"><span className="muted">{brDay(t.date)}</span><span className="ell" title={`${t.description} · ${accountLabel(gastos.data.accounts.find(a => a.id === t.accountId))}`}>{displayName(t.description)}</span>
          <span className={t.amountCents > 0 ? 'muted' : undefined}>{t.amountCents > 0 ? `−${formatCents(t.amountCents)}` : formatCents(-t.amountCents)}</span></div>
      ))}</div></td></tr>] : []),
    ]
  }
  const ofGoal = (real: number, goal: number | null) => (goal === null ? formatCents(real) : `${formatCents(real)} de ${formatCents(goal)}`)

  const varNote = !hasTxns ? 'sem lançamentos para comparar'
    : progress >= 1 ? 'mês fechado' : progress <= 0 ? 'o mês ainda não começou'
    : ritmo !== null ? `no ritmo fecha em ${formatBRL(ritmo)}` : `${Math.round(progress * 100)}% do mês`
  // com lançamentos, a fatura do cartão já entra compra por compra nos variáveis: a linha dela não sai de novo da sobra
  const fatura = (l: BudgetLine) => hasTxns && l.categoryId === 'pagamento-de-fatura'
  const fixosCents = total(fixos.filter(l => !fatura(l))) + vars.fixasCents, custosCents = fixosCents + vars.realCents
  const share = (part: number) => (custosCents > 0 ? Math.round((part / custosCents) * 100) : 0)
  const sobra = sum.entradasCents - fixosCents - total(parcelas) - vars.realCents - inv.realCents
  const section = (label: string, cents: number) => <tr className="secl"><td>{label}</td><td className="r">{formatCents(cents)}</td></tr>
  const formHere = (at: At) => form?.at === at && !form.id && saidaForm(form)
  const lineRows = (ls: BudgetLine[]) => ls.map(l => (form?.id === l.id ? saidaForm(form) : <tr key={l.id}>{plainRow(l)}</tr>))

  return (
    <>
      {header}
      {errorBox}
      <Insights area="orcamento" month={month} onNavigate={onNavigate} />
      <div className="kpis">
        <div className="k"><div className="muted">O que entra</div><div className="v">{formatBRL(sum.entradasCents)}</div><div className="s muted">{plural(entradas.length, 'entrada', 'entradas')} · líquido</div></div>
        <div className="k"><div className="muted">Fixos + parcelas</div><div className="v">{formatBRL(fixosCents + total(parcelas))}</div><div className="s muted">{vars.fixasCents > 0 ? `${formatBRL(vars.fixasCents)} fora do plano · ` : ''}{plural(parcelas.length, 'parcela', 'parcelas')}</div></div>
        <div className="k"><div className="muted">Variáveis</div><div className={`v ${vars.goalCents !== null && vars.realCents > vars.goalCents ? 'dn' : ''}`}>{formatBRL(vars.realCents)}</div><div className="s muted">{[vars.goalCents !== null && `meta ${formatBRL(vars.goalCents)}`, varNote].filter(Boolean).join(' · ')}</div></div>
        <div className="k"><div className="muted">Investido</div><div className="v">{formatBRL(inv.realCents)}</div><div className="s muted">{inv.goalCents === null ? 'sem meta' : `meta ${formatBRL(inv.goalCents)} · ${inv.realCents >= inv.goalCents ? 'batida' : `faltam ${formatBRL(inv.goalCents - inv.realCents)}`}`}</div></div>
        <div className="k"><div className="muted">Sobra</div><div className={`v ${sobra > 0 ? 'up' : sobra < 0 ? 'dn' : ''}`}>{sobra > 0 ? '+' : ''}{formatBRL(sobra)}</div><div className="s muted">{inv.reservaCents > 0 ? `inclui ${formatBRL(inv.reservaCents)} guardados na reserva` : inv.reservaCents < 0 ? `sem contar ${formatBRL(-inv.reservaCents)} tirados da reserva` : 'o que entra − o que já saiu'}</div></div>
      </div>

      {metasOpen && <Metas key={month} month={month} categories={categories} goals={goals} averages={avgs} fixed={data.fixedCategories} busy={busy}
        onClose={() => setMetasOpen(false)} onSave={(changes, fixed) => void run('Não foi possível salvar as metas', async () => {
          await saveGoals(db, month, changes)
          if (fixed) await saveFixedCategories(db, fixed)
        }).then(ok => ok && setMetasOpen(false))} />}

      {suggestions.length > 0 && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--accent-line)' }}>
          <div className="bar"><h5 style={{ margin: 0 }}>Sugestões dos seus gastos <span className="muted">({suggestions.length})</span></h5><span className="muted">nada entra no plano sem você aceitar</span></div>
          {suggestions.map(s => (
            <div key={s.key} className="sug">
              <span className="pill">{s.reason}</span>
              <span className="grow"><b style={{ color: '#fff' }}>{s.name}</b> {s.installmentCurrent !== null && <span className="tag">{s.installmentCurrent}/{s.installmentTotal}</span>} <span className="muted">· {catName(s.categoryId) ?? 'sem categoria'}</span></span>
              <span className="r">{formatCents(s.amountCents)}</span>
              <button className="b" disabled={busy} onClick={() => accept(s)}>Aceitar</button>
              <button className="b ghost" disabled={busy} onClick={() => open(s.reason === 'parcela' ? 'parcela' : 'fixo', {
                name: s.name, amount: editCents(s.amountCents), categoryId: s.categoryId ?? '', recurring: s.recurring, sourceKey: s.key,
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
                <td className="ell-cell"><div className="cat-line">
                  <SourceIcon kind={s.kind} dim />
                  <div className="grow"><div className="nm"><span style={{ color: "var(--text-2)" }}>{s.name}</span></div><div className="d2">não está neste mês · {formatCents(sourceNet(s, month))}</div></div>
                </div></td>
                <td className="r"><button className="b" disabled={busy} onClick={() => include(s)}>Incluir</button></td>
              </tr>
            )),
          })}
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="bar">
              <h5 style={{ margin: 0 }}>Custos <span className="muted" style={{ fontWeight: 400 }}>{lower(month)}</span></h5>
              <button className="b ghost sq" disabled={busy} aria-label={tab === 'fixos' ? 'Novo custo fixo' : 'Novo gasto variável'} onClick={() => open(tab === 'fixos' ? 'fixo' : 'variavel')}><Plus size={14} aria-hidden /></button>
            </div>
            <div className="costs-big">{formatBRL(custosCents)}</div>
            <div className="split" aria-hidden><i style={{ flexGrow: fixosCents, background: 'var(--faint)' }} /><i style={{ flexGrow: vars.realCents, background: 'var(--c2)' }} /></div>
            <div className="cost-seg" role="group" aria-label="Mostrar custos">
              {(['fixos', 'variaveis'] as const).map(t => (
                <button key={t} aria-pressed={tab === t} className={tab === t ? 'on' : ''} onClick={() => {
                  // só o formulário e a confirmação deste cartão: os dos outros cartões continuam abertos
                  if (form?.at === 'fixo' || form?.at === 'variavel') setForm(null)
                  if (del?.kind === 'saida' && (blocoOf(del) === 'fixo' || blocoOf(del) === 'variavel')) setDel(null)
                  setTab(t)
                }}>
                  <b><span className="dot" style={{ background: t === 'fixos' ? 'var(--faint)' : 'var(--c2)' }} />{t === 'fixos' ? 'Fixos' : 'Variáveis'}</b>
                  <span>{formatBRL(t === 'fixos' ? fixosCents : vars.realCents)} · {share(t === 'fixos' ? fixosCents : vars.realCents)}%</span>
                </button>
              ))}
            </div>
            {!hasTxns && <div className="muted" style={{ marginBottom: 6 }}>Os gastos vêm dos lançamentos: conecte ou importe uma conta em <button className="link" onClick={onOpenGastos}>Últimos gastos</button>.</div>}
            {tab === 'variaveis' && vars.goalCents !== null && (
              <div style={{ marginBottom: 6 }}><div className="muted">limite dos variáveis: {formatCents(vars.realCents)} de {formatCents(vars.goalCents)}</div><Track real={vars.realCents} planned={vars.goalCents} /></div>
            )}
            <table className="lt blk">
              <tbody>
                {tab === 'fixos' ? <>
                  {section('No plano', total(fixos.filter(l => !fatura(l))))}
                  {fixos.length === 0 && !formHere('fixo') && <tr><td colSpan={2} className="muted">Assinaturas e contas que se repetem; as detectadas aparecem nas sugestões acima.</td></tr>}
                  {lineRows(fixos)}
                  {formHere('fixo')}
                  {vars.fixas.length > 0 && <>{section('Fora do plano', vars.fixasCents)}{vars.fixas.flatMap(r => catRow(r, true))}</>}
                </> : <>
                  {vars.variaveis.length === 0 && vars.manual.length === 0 && !formHere('variavel') && <tr><td colSpan={2} className="muted">Nenhum gasto variável neste mês ainda.</td></tr>}
                  {vars.variaveis.flatMap(r => catRow(r))}
                  {lineRows(vars.manual)}
                  {formHere('variavel')}
                </>}
              </tbody>
            </table>
            {del && del.kind === 'saida' && (blocoOf(del) === 'fixo' || blocoOf(del) === 'variavel') && confirmDel(del)}
          </div>
        </div>
        <div>
          {block('meta', 'Investimentos', inv.manual, ofGoal(inv.realCents, inv.goalCents), plainRow, {
            empty: 'Nada investido neste mês ainda.',
            goal: inv.goalCents !== null ? { real: inv.realCents, goal: inv.goalCents } : undefined,
            hint: inv.groups.length > 0 && 'aplicado − resgatado no mês · caixinha que entra e sai: passe o mouse na linha e marque como reserva',
            extra: inv.groups.length > 0 && inv.groups.flatMap(g => groupRow(g, false)),
          })}
          {reservaGroups.length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="bar"><h5 style={{ margin: 0 }}>Reserva</h5><b style={{ color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{reservaSaldo.length ? formatCents(reservaSaldo.reduce((s, c) => s + c, 0)) : `${inv.reservaCents > 0 ? '+' : ''}${formatCents(inv.reservaCents)}`}</b></div>
              <div className="muted" style={{ marginTop: 2 }}>{reservaSaldo.length ? `saldo no banco ${ago(liveInv.map(b => b.fetchedAt).sort().at(-1))} · ${inv.reservaCents >= 0 ? '+' : ''}${formatCents(inv.reservaCents)} este mês; não conta como investimento nem como gasto` : 'dinheiro guardado que entra e sai: não conta como investimento nem como gasto'}</div>
              <table className="lt blk" style={{ marginTop: 6 }}><tbody>{reservaGroups.flatMap(g => groupRow(g, true))}</tbody></table>
            </div>
          )}
          {block('parcela', 'Parcelas', parcelas, formatCents(total(parcelas)), parcelaRow, { empty: 'Compras parceladas; somem sozinhas depois da última.' })}
        </div>
      </div>
    </>
  )
}
