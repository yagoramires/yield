import { useState } from 'react'
import { deleteCategory, deleteRule, renameCategory, saveCategory, saveRule, type Category } from '../db/gastosRepo'
import { normalizeDescription } from '../domain/gastos'
import { formatCents } from '../domain/money'
import { useData } from '../state/DataProvider'
import { deleteImpact, spentByCategory, validateCategoryName } from './categorias/build'
import { errText, GastosHeader, monthName } from './lancamentos/GastosHeader'

export function Categorias() {
  const { db, reload, gastos } = useData()
  const { data, categorize: cat, month } = gastos
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null)
  const [adding, setAdding] = useState<{ name: string; counts: boolean } | null>(null)
  const [del, setDel] = useState<Category | null>(null)
  const [pattern, setPattern] = useState('')
  const [ruleCat, setRuleCat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // toda escrita passa por aqui: recarrega e mostra o erro em pt-BR na tela
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn(); await reload(); setError(null) } catch (e) { setError(`${what}: ${errText(e)}`); setBusy(false); return false }
    setBusy(false)
    return true
  }

  const rows = spentByCategory(data.txns, data.accounts, cat, data.categories, month)
  const catName = (id: string) => data.categories.find(c => c.id === id)?.name ?? '—'
  const impact = del ? deleteImpact(del.id, data.rules, data.overrides) : null
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  return (
    <>
      <GastosHeader title="Categorias" />
      <div className="bar" style={{ marginTop: 10 }}>
        <div className="muted">Gasto de {monthName(month).toLowerCase()} por categoria</div>
        <div className="btns"><button className="b" disabled={busy} onClick={() => { setAdding({ name: '', counts: true }); setError(null) }}>+ Categoria</button></div>
      </div>
      {error && <div className="note" style={{ marginTop: 8 }}>{error}</div>}
      {adding && (
        <div className="note" style={{ marginTop: 8 }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field"><span>Nome da categoria</span>
              <input className="in" autoFocus value={adding.name} onChange={e => setAdding({ ...adding, name: e.target.value })} /></label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={adding.counts} onChange={e => setAdding({ ...adding, counts: e.target.checked })} /> conta como gasto
            </label>
            <div className="btns">
              <button className="b" disabled={busy} onClick={() => setAdding(null)}>Cancelar</button>
              <button className="b pri" disabled={busy} onClick={() => void run('Não foi possível criar a categoria', async () => {
                await saveCategory(db, validateCategoryName(adding.name, data.categories), adding.counts)
              }).then(ok => ok && setAdding(null))}>Criar</button>
            </div>
          </div>
        </div>
      )}
      <div className="grid2" style={{ marginTop: 12, gridTemplateColumns: '1.2fr 1fr' }}>
        <div>
          <table>
            <thead><tr><th>Categoria</th><th>Conta como gasto</th><th className="r">{monthName(month)}</th><th></th></tr></thead>
            <tbody>
              {rows.map(r => {
                const c = r.category
                const off = !r.countsAsSpending
                return (
                  <tr key={c?.id ?? 'sem'} className={off ? 't2' : ''}>
                    <td style={c ? undefined : { color: '#ffcf5c' }}>
                      {c && rename?.id === c.id ? (
                        <span className="row" style={{ flexWrap: 'nowrap' }}>
                          <input className="in" aria-label="Novo nome" autoFocus value={rename.name} onChange={e => setRename({ ...rename, name: e.target.value })} />
                          <button className="b pri" disabled={busy} onClick={() => void run('Não foi possível renomear', async () => {
                            await renameCategory(db, c.id, validateCategoryName(rename.name, data.categories, c.id))
                          }).then(ok => ok && setRename(null))}>Salvar</button>
                          <button className="b ghost" disabled={busy} onClick={() => { setRename(null); setError(null) }}>Cancelar</button>
                        </span>
                      ) : <>{c?.name ?? 'Sem categoria'} {c && !c.builtin && <span className="tag">sua</span>}</>}
                    </td>
                    <td>{off ? 'não' : 'sim'}</td>
                    <td className="r">{formatCents(r.cents)}</td>
                    <td className="muted">
                      {c && <button className="link" onClick={() => { setRename({ id: c.id, name: c.name }); setError(null) }}>renomear</button>}
                      {c && !c.builtin && <> · <button className="link" onClick={() => { setDel(c); setError(null) }}>apagar</button></>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="muted" style={{ marginTop: 6 }}>Categorias que não contam como gasto mostram o que saiu, mas ficam fora dos totais do Resumo.</div>
          {del && impact && (
            <div className="note" style={{ marginTop: 10 }}>
              Apagar "{del.name}"? Vão junto {plural(impact.rules, 'regra', 'regras')} e {plural(impact.overrides, 'categoria escolhida', 'categorias escolhidas')} à mão; essas compras voltam para "Sem categoria".
              <span className="btns" style={{ marginTop: 8 }}>
                <button className="b" disabled={busy} onClick={() => setDel(null)}>Cancelar</button>
                <button className="b pri" disabled={busy} onClick={() => void run('Não foi possível apagar a categoria', () => deleteCategory(db, del.id)).then(ok => ok && setDel(null))}>Apagar</button>
              </span>
            </div>
          )}
        </div>
        <div className="card">
          <b style={{ color: '#fff' }}>Regras</b>
          <div className="muted" style={{ margin: '4px 0 8px' }}>"Sempre categorizar … como …". A regra mais específica ganha; a categoria escolhida à mão numa compra ganha de todas.</div>
          <table>
            <thead><tr><th>Quando a descrição tem</th><th>Categoria</th><th></th></tr></thead>
            <tbody>
              {data.rules.length === 0 && <tr><td colSpan={3} className="muted">Nenhuma regra ainda.</td></tr>}
              {data.rules.map(r => (
                <tr key={r.id}><td>{r.pattern}</td><td>{catName(r.categoryId)}</td>
                  <td className="muted"><button className="link" disabled={busy} onClick={() => void run('Não foi possível apagar a regra', () => deleteRule(db, r.id))}>apagar</button></td></tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 8 }}>
            <input className="in" style={{ flex: 1 }} placeholder="descrição contém…" aria-label="Descrição contém" value={pattern} onChange={e => setPattern(e.target.value)} />
            <select className="in" aria-label="Categoria da regra" value={ruleCat || data.categories[0]?.id || ''} onChange={e => setRuleCat(e.target.value)}>
              {data.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="b" disabled={busy} onClick={() => void run('Não foi possível salvar a regra', async () => {
              const p = normalizeDescription(pattern)
              if (!p) throw new Error('Digite um trecho da descrição (letras, sem só números ou símbolos)')
              await saveRule(db, p, ruleCat || data.categories[0].id)
            }).then(ok => ok && setPattern(''))}>Adicionar</button>
          </div>
        </div>
      </div>
    </>
  )
}
