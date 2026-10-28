import { Search } from 'lucide-react'
import { useState } from 'react'
import { saveRule, setOverride, type Txn } from '../db/gastosRepo'
import { pluggyCategoryId } from '../domain/categoriasPluggy'
import { monthTotals, normalizeDescription } from '../domain/gastos'
import { companyCreditHints, ownerMention } from '../domain/transferencias'
import { formatBRL, formatCents } from '../domain/money'
import { useData } from '../state/DataProvider'
import { CategoryIcon } from '../ui/CategoryIcon'
import { categoryStrip, cleanDescription, filterTxns, groupByDay, NO_FILTER, ruleFor, shortAccountLabel, suggestRulePattern, type TxnFilter } from './lancamentos/build'
import { CategoryPicker } from './lancamentos/CategoryPicker'
import { errText, GastosHeader, GastosVazio } from './lancamentos/GastosHeader'

const signed = (c: number) => (c < 0 ? `−${formatCents(-c)}` : c > 0 ? `+${formatCents(c)}` : '—')
const dayTitle = (iso: string) => {
  const s = new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  return s[0].toUpperCase() + s.slice(1)
}
const HINT_KEY = 'yield.dicaEmpresaDispensada'
const KINDS: [TxnFilter['accountKind'], string][] = [['todas', 'Tudo'], ['conta', 'Contas'], ['cartao', 'Cartões']]

export function Lancamentos({ onOpenSettings }: { onOpenSettings(): void }) {
  const { db, reload, gastos } = useData()
  const { data, categorize: cat, transfers, month, filter, setFilter } = gastos
  const [picking, setPicking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hintOff, setHintOff] = useState(() => { try { return localStorage.getItem(HINT_KEY) === '1' } catch { return false } })
  if (!data.txns.length) return <><GastosHeader title="Lançamentos" /><GastosVazio onOpenSettings={onOpenSettings} /></>

  const totals = monthTotals(data.txns, data.accounts, cat, month)
  const left = totals.incomeCents - totals.spentCents
  const list = filterTxns(data.txns, data.accounts, cat, month, filter)
  const strip = categoryStrip(data.txns, cat, month)
  const out = list.reduce((s, t) => s + Math.min(0, t.amountCents), 0)
  const inc = list.reduce((s, t) => s + Math.max(0, t.amountCents), 0)
  const accounts = new Map(data.accounts.map(a => [a.id, a]))
  const filtered = filter.accountKind !== 'todas' || filter.categoryId !== null || filter.search !== ''
  const toggle = (id: string | null) => setFilter({ ...filter, categoryId: filter.categoryId === id ? null : id })
  const open = (id: string | null) => { setPicking(id); setError(null) }
  // sem "sua empresa" configurada, o que a PJ paga cai em Transferência (o nome dela costuma conter o do titular)
  const pjCredits = hintOff ? [] : companyCreditHints(data.txns, data.accounts, cat, data.companyNames)
  const dismissHint = () => { try { localStorage.setItem(HINT_KEY, '1') } catch { /* sem storage: vale só nesta tela */ } setHintOff(true) }

  // "fazer isso sempre" grava a regra no lugar da escolha manual (e apaga uma antiga), para a compra seguir a regra.
  const pick = async (t: Txn, categoryId: string, always: boolean) => {
    if (!always && cat(t)?.id === categoryId) return open(null)
    setBusy(true)
    try {
      if (always) {
        await saveRule(db, suggestRulePattern(t.description), categoryId)
        await setOverride(db, t.fingerprint, null)
      } else await setOverride(db, t.fingerprint, categoryId)
      await reload()
      open(null)
    } catch (e) { setError(`Não foi possível salvar a categoria: ${errText(e)}`) }
    setBusy(false)
  }

  const row = (t: Txn) => {
    const c = cat(t)
    const off = c !== null && !c.countsAsSpending && c.id !== 'receita' // fatura, transferência, investimento
    const rule = ruleFor(t, data.rules, data.overrides)
    const tr = !rule && !data.overrides[t.fingerprint] && c?.id === 'transferencia' ? transfers.get(t.id) : undefined
    const between = tr && `${tr.outgoing ? 'para' : 'de'} ${shortAccountLabel(accounts.get(tr.otherAccountId))}, entre suas contas`
    const auto = !rule && !between && !data.overrides[t.fingerprint]
    const company = auto && c?.id === 'receita' && accounts.get(t.accountId)?.kind === 'conta' && ownerMention(t.description, data.ownerNames, data.companyNames) === 'empresa' && 'da sua empresa'
    const byPluggy = auto && !company && c && pluggyCategoryId(t.pluggyCategory, t.amountCents) === c.id
    const { name, via } = cleanDescription(t.description)
    const meta = [via, shortAccountLabel(accounts.get(t.accountId)), t.installment && `parcela ${t.installment}`, t.pending && 'pendente', rule && `regra "${rule.pattern}"`, between, company, byPluggy && 'categoria da Pluggy', off && 'não conta como gasto']
    const pattern = suggestRulePattern(t.description)
    return (
      <div key={t.id} className={`lrow ${off ? 'off' : ''}`}>
        <CategoryIcon category={c} />
        <div className="lmid">
          <div className="lname" title={t.description}>{name}</div>
          <div className="lsub">
            <button className={`catlink ${c ? '' : 'none'}`} aria-expanded={picking === t.id} aria-label={`Categoria de ${name}: ${c?.name ?? 'sem categoria'}`} onClick={() => open(picking === t.id ? null : t.id)}>{c?.name ?? 'Escolher categoria'}</button>
            {meta.filter(Boolean).map((m, i) => <span key={i}>· {m}</span>)}
          </div>
        </div>
        <div className={`lval ${t.amountCents > 0 ? 'up' : ''}`}>{signed(t.amountCents)}</div>
        {picking === t.id && (
          <CategoryPicker categories={data.categories} current={c?.id ?? null} pattern={pattern} busy={busy} error={error}
            reach={pattern ? data.txns.filter(o => o.id !== t.id && !data.overrides[o.fingerprint] && normalizeDescription(o.description).includes(pattern)).length : 0}
            onPick={(id, always) => void pick(t, id, always)} onClose={() => open(null)} />
        )}
      </div>
    )
  }

  return (
    <>
      <GastosHeader title="Lançamentos" />
      <div className="kpis">
        <div className="k"><div className="muted">Gasto</div><div className="v">{formatBRL(totals.spentCents)}</div></div>
        <div className="k"><div className="muted">Entradas</div><div className="v up">{formatBRL(totals.incomeCents)}</div></div>
        <div className="k"><div className="muted">Sobrou</div><div className={`v ${left < 0 ? 'dn' : ''}`}>{formatBRL(left)}</div></div>
      </div>

      {pjCredits.length > 0 && (
        <div className="note" style={{ marginBottom: 10 }}>
          {pjCredits.length === 1 ? '1 Pix/TED recebido de empresa está' : `${pjCredits.length} Pix/TED recebidos de empresa estão`} como Transferência (por exemplo, "{cleanDescription(pjCredits[0].description).name}").
          {' '}Se for a sua empresa, informe o nome ou o CNPJ dela em Configurações › Transferências entre suas contas para contar como Receita.
          {' '}<button className="link" onClick={onOpenSettings}>Abrir Configurações</button> · <button className="link" onClick={dismissHint}>dispensar</button>
        </div>
      )}
      <div className="lan-tools">
        <label className="search-box"><Search size={14} aria-hidden />
          <input placeholder="buscar" aria-label="Buscar descrição" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} />
        </label>
        <div className="seg" role="group" aria-label="Tipo de conta">
          {KINDS.map(([k, l]) => <button key={k} className={filter.accountKind === k ? 'on' : ''} aria-pressed={filter.accountKind === k} onClick={() => setFilter({ ...filter, accountKind: k })}>{l}</button>)}
        </div>
        {filtered && <button className="link" onClick={() => setFilter(NO_FILTER)}>limpar filtros</button>}
        <div className="lan-total" aria-live="polite">
          <span className="muted">{list.length === 1 ? '1 lançamento' : `${list.length} lançamentos`}</span>
          {/* sem filtro os cartões do topo já dizem o mês; aqui somaria fatura e transferência junto */}
          {filtered && out < 0 && <span>saiu <b>{formatBRL(-out)}</b></span>}
          {filtered && inc > 0 && <span>entrou <b className="up">{formatBRL(inc)}</b></span>}
        </div>
      </div>
      <div className="cat-strip" role="group" aria-label="Filtrar por categoria">
        <button className={`cc ${filter.categoryId === null ? 'on' : ''}`} aria-pressed={filter.categoryId === null} onClick={() => setFilter({ ...filter, categoryId: null })}>Todas</button>
        {strip.map(i => (
          <button key={i.id} className={`cc ${i.id === 'sem' ? 'warn' : ''} ${i.spending ? '' : 'quiet'} ${filter.categoryId === i.id ? 'on' : ''}`} aria-pressed={filter.categoryId === i.id} onClick={() => toggle(i.id)}>
            <CategoryIcon category={i.id === 'sem' ? null : data.categories.find(k => k.id === i.id) ?? null} size={13} bare />{i.name}{i.id === 'sem' && <b>{i.count}</b>}
          </button>
        ))}
      </div>

      {list.length === 0 ? <div className="info">{filtered ? 'Nenhum lançamento com esses filtros neste mês.' : 'Nenhum lançamento neste mês.'}</div> : (
        groupByDay(list, cat).map(g => (
          <section key={g.date} className="day-card" aria-label={dayTitle(g.date)}>
            <div className="day-h"><span>{dayTitle(g.date)}</span><span>{signed(g.totalCents)}</span></div>
            {g.txns.map(row)}
          </section>
        ))
      )}
    </>
  )
}
