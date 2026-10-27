import { useState } from 'react'
import { saveRule, setOverride, type Txn } from '../db/gastosRepo'
import { monthTotals, normalizeDescription } from '../domain/gastos'
import { formatBRL, formatCents } from '../domain/money'
import { useData } from '../state/DataProvider'
import { filterTxns, groupByDay, NO_FILTER, ruleFor, suggestRulePattern, type TxnFilter } from './lancamentos/build'
import { accountLabel, errText, GastosHeader, GastosVazio, monthName } from './lancamentos/GastosHeader'

const signed = (c: number) => (c < 0 ? `−${formatCents(-c)}` : c > 0 ? `+${formatCents(c)}` : '—')
const dayTitle = (iso: string) => {
  const s = new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  return s[0].toUpperCase() + s.slice(1)
}
const KINDS: [TxnFilter['accountKind'], string][] = [['todas', 'Tudo'], ['conta', 'Contas'], ['cartao', 'Cartões']]

export function Lancamentos({ onOpenSettings }: { onOpenSettings(): void }) {
  const { db, reload, gastos } = useData()
  const { data, categorize: cat, month, filter, setFilter } = gastos
  const [edit, setEdit] = useState<{ txn: Txn; categoryId: string; always: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!data.txns.length) return <><GastosHeader title="Lançamentos" /><GastosVazio onOpenSettings={onOpenSettings} /></>

  const totals = monthTotals(data.txns, data.accounts, cat, month)
  const list = filterTxns(data.txns, data.accounts, cat, month, filter)
  const uncategorized = filterTxns(data.txns, data.accounts, cat, month, { ...NO_FILTER, categoryId: 'sem' }).length
  const accounts = new Map(data.accounts.map(a => [a.id, a]))
  const filtered = filter.accountKind !== 'todas' || filter.categoryId !== null || filter.search !== ''

  // "fazer isso sempre" grava a regra no lugar da escolha manual (e apaga uma antiga), para a compra seguir a regra.
  const save = async () => {
    if (!edit) return
    setBusy(true)
    try {
      if (edit.always) {
        await saveRule(db, suggestRulePattern(edit.txn.description), edit.categoryId)
        await setOverride(db, edit.txn.fingerprint, null)
      } else await setOverride(db, edit.txn.fingerprint, edit.categoryId)
      await reload()
      setEdit(null); setError(null)
    } catch (e) { setError(`Não foi possível salvar a categoria: ${errText(e)}`) }
    setBusy(false)
  }

  const editor = (t: Txn) => {
    if (edit?.txn.id !== t.id) return null
    const pattern = suggestRulePattern(t.description)
    const reach = pattern ? data.txns.filter(o => o.id !== t.id && !data.overrides[o.fingerprint] && normalizeDescription(o.description).includes(pattern)).length : 0
    return (
      <tr className="expand"><td colSpan={3}>
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <span className="muted">Categoria:</span>
          <select className="in" aria-label="Nova categoria" value={edit.categoryId} onChange={e => setEdit({ ...edit, categoryId: e.target.value })}>
            {data.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {pattern && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
              <input type="checkbox" checked={edit.always} onChange={e => setEdit({ ...edit, always: e.target.checked })} />
              fazer isso sempre com "{pattern}"
              {reach > 0 && <span className="muted">(também {reach === 1 ? 'na 1 compra antiga' : `nas ${reach} compras antigas`})</span>}
            </label>
          )}
          <span className="btns" style={{ marginLeft: 'auto' }}>
            <button className="b ghost" disabled={busy} onClick={() => setEdit(null)}>Cancelar</button>
            <button className="b pri" disabled={busy} onClick={() => void save()}>{busy ? 'Salvando…' : 'Salvar'}</button>
          </span>
        </div>
        {error && <div className="note" style={{ marginTop: 8 }}>{error}</div>}
      </td></tr>
    )
  }

  return (
    <>
      <GastosHeader title="Lançamentos" />
      <div className="row" style={{ marginTop: 10, gap: 14, fontSize: 11 }}>
        <span className="t2">Gasto <b style={{ color: '#fff' }}>{formatBRL(totals.spentCents)}</b></span>
        <span className="t2">Entradas <b style={{ color: '#fff' }}>{formatBRL(totals.incomeCents)}</b></span>
        <span className="muted">os números do mês ficam no Resumo</span>
      </div>

      <div className="row" style={{ margin: '14px 0 6px', alignItems: 'center' }}>
        <input className="in" style={{ flex: 1, maxWidth: 220 }} placeholder="buscar descrição" aria-label="Buscar descrição" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} />
        {KINDS.map(([k, l]) => <button key={k} className={`chip ${filter.accountKind === k ? 'on' : ''}`} onClick={() => setFilter({ ...filter, accountKind: k })}>{l}</button>)}
        <select className="in" aria-label="Categoria" value={filter.categoryId ?? ''} onChange={e => setFilter({ ...filter, categoryId: e.target.value || null })}>
          <option value="">Categoria: todas</option>
          {data.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="sem">Sem categoria</option>
        </select>
        {uncategorized > 0 && (
          <button className={`chip warn ${filter.categoryId === 'sem' ? 'on' : ''}`} onClick={() => setFilter({ ...filter, categoryId: filter.categoryId === 'sem' ? null : 'sem' })}>{uncategorized} sem categoria</button>
        )}
        {filtered && <button className="link" onClick={() => setFilter(NO_FILTER)}>limpar filtros</button>}
      </div>

      {list.length === 0 ? <div className="info">{filtered ? 'Nenhum lançamento com esses filtros neste mês.' : 'Nenhum lançamento neste mês.'}</div> : (
        <table className="txn">
          <tbody>
            {groupByDay(list, cat).map(g => [
              <tr key={g.date} className="day"><td colSpan={2}>{dayTitle(g.date)}</td><td className="r">{signed(g.totalCents)}</td></tr>,
              ...g.txns.flatMap(t => {
                const c = cat(t)
                const off = c !== null && !c.countsAsSpending && c.id !== 'receita' // fatura, transferência, investimento
                const rule = ruleFor(t, data.rules, data.overrides)
                const meta = [accountLabel(accounts.get(t.accountId)), t.installment && `parcela ${t.installment}`, t.pending && 'pendente', rule && `regra "${rule.pattern}"`, off && 'não conta como gasto']
                return [
                  <tr key={t.id} className={off ? 'off' : ''}>
                    <td><div className="d1">{t.description}</div><div className="d2">{meta.filter(Boolean).join(' · ')}</div></td>
                    <td style={{ width: 170 }}>
                      <select className={`in ${c ? '' : 'none'}`} aria-label={`Categoria de ${t.description}`} value={edit?.txn.id === t.id ? edit.categoryId : c?.id ?? ''}
                        onChange={e => { if (e.target.value) { setEdit({ txn: t, categoryId: e.target.value, always: false }); setError(null) } }}>
                        {!c && <option value="">Sem categoria</option>}
                        {data.categories.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                      </select>
                    </td>
                    <td className={`r ${t.amountCents > 0 ? 'up' : ''}`}>{signed(t.amountCents)}</td>
                  </tr>,
                  editor(t),
                ]
              }),
            ])}
          </tbody>
        </table>
      )}
      <div className="muted" style={{ marginTop: 6 }}>{list.length === 1 ? '1 lançamento' : `${list.length} lançamentos`} em {monthName(month).toLowerCase()} · mostrando por dia, do mais recente</div>
    </>
  )
}
