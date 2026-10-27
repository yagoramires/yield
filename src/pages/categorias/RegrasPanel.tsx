import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { deleteRule, dismissRuleSuggestion, saveRule, setOverride, type CategoryRule } from '../../db/gastosRepo'
import { normalizeDescription } from '../../domain/gastos'
import { formatCents } from '../../domain/money'
import { useData } from '../../state/DataProvider'
import { CategoryIcon } from '../../ui/CategoryIcon'
import { cleanDescription, suggestRulePattern } from '../lancamentos/build'
import { CategoryPicker } from '../lancamentos/CategoryPicker'
import { brDay, errText } from '../lancamentos/GastosHeader'
import { rulePreview, ruleSuggestions, ruleUsage } from './build'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Linhas de regra; `showCategory` falso no painel de uma categoria (todas são dela). */
export function RuleList({ rules, showCategory }: { rules: CategoryRule[]; showCategory: boolean }) {
  const { db, reload, gastos: { data } } = useData()
  const [error, setError] = useState<string | null>(null)
  const usage = ruleUsage(data.txns, data.rules, data.overrides)
  const remove = async (r: CategoryRule) => {
    try { await deleteRule(db, r.id); await reload(); setError(null) } catch (e) { setError(`Não foi possível apagar a regra: ${errText(e)}`) }
  }
  if (!rules.length) return <div className="muted rule-row">Nenhuma regra ainda.</div>
  return (
    <>
      {error && <div className="note" style={{ margin: '8px 14px' }}>{error}</div>}
      {rules.map(r => {
        const c = data.categories.find(k => k.id === r.categoryId) ?? null
        return (
          <div key={r.id} className="rule-row">
            <code>{r.pattern}</code>
            {showCategory && <><span className="muted">→</span><span className="rule-cat"><CategoryIcon category={c} size={13} bare />{c?.name ?? '—'}</span></>}
            <span className="muted rule-n">{plural(usage.get(r.id) ?? 0, 'compra', 'compras')}</span>
            <button className="icon-btn sq del" aria-label={`Apagar a regra ${r.pattern}`} onClick={() => void remove(r)}><Trash2 size={13} aria-hidden /></button>
          </div>
        )
      })}
    </>
  )
}

/** Campo de regra nova com a prévia do que ela pegaria; `categoryId` fixo no painel de uma categoria. */
export function AddRule({ categoryId: fixed }: { categoryId?: string }) {
  const { db, reload, gastos: { data, categorize: cat } } = useData()
  const [pattern, setPattern] = useState('')
  const [categoryId, setCategoryId] = useState(fixed ?? '')
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = pattern.trim() ? rulePreview(pattern, data.txns, data.overrides, cat) : null
  const chosen = data.categories.find(c => c.id === categoryId) ?? null

  const add = async () => {
    const p = normalizeDescription(pattern)
    if (!p) return setError('Digite um trecho da descrição (letras, sem só números ou símbolos)')
    if (!categoryId) return setError('Escolha a categoria da regra')
    setBusy(true)
    try { await saveRule(db, p, categoryId); await reload(); setPattern(''); setError(null) } catch (e) { setError(`Não foi possível salvar a regra: ${errText(e)}`) }
    setBusy(false)
  }

  return (
    <div className="rule-add">
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
        <input className="in mono" style={{ flex: 1, minWidth: 0 }} placeholder="descrição contém…" aria-label="Descrição contém" value={pattern}
          onChange={e => { setPattern(e.target.value); setError(null) }} onKeyDown={e => e.key === 'Enter' && void add()} />
        {!fixed && (
          <span style={{ position: 'relative' }}>
            <button className="b with-ico" aria-expanded={picking} onClick={() => setPicking(!picking)}>
              <CategoryIcon category={chosen} size={13} bare />{chosen?.name ?? 'Categoria'} ▾
            </button>
            {picking && <CategoryPicker categories={data.categories} current={categoryId || null} pattern="" reach={0} busy={false} error={null}
              onPick={id => { setCategoryId(id); setPicking(false) }} onClose={() => setPicking(false)} />}
          </span>
        )}
        <button className="b pri" disabled={busy} onClick={() => void add()}>Adicionar</button>
      </div>
      {preview && (
        <div className="rule-preview">
          {preview.count === 0 ? 'Não pegaria nenhuma compra por enquanto.' : <>
            Pegaria <b>{plural(preview.count, 'compra', 'compras')}</b>{preview.uncategorized > 0 && ` (${preview.uncategorized} hoje sem categoria)`}:
            {preview.examples.map(t => <div key={t.id}><b>{cleanDescription(t.description).name}</b> · {brDay(t.date)} · {formatCents(Math.abs(t.amountCents))}</div>)}
            {preview.count > preview.examples.length && <div className="muted">e mais {preview.count - preview.examples.length}</div>}
          </>}
        </div>
      )}
      {error && <div className="note" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  )
}

/** Coluna direita no dia a dia: sugestão de regra, todas as regras e o campo de regra nova. */
export function RegrasPanel() {
  const { db, reload, gastos: { data } } = useData()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sug = ruleSuggestions(data.txns, data.overrides, data.rules, data.ruleSuggestionsDismissed)[0]
  const sugCat = sug ? data.categories.find(c => c.id === sug.categoryId) : undefined

  // Criar a regra apaga as escolhas à mão que ela substitui, igual ao "fazer isso sempre" de Lançamentos.
  const accept = async () => {
    if (!sug) return
    setBusy(true)
    try {
      await saveRule(db, sug.pattern, sug.categoryId)
      for (const t of data.txns) if (data.overrides[t.fingerprint] === sug.categoryId && suggestRulePattern(t.description) === sug.pattern) await setOverride(db, t.fingerprint, null)
      await reload(); setError(null)
    } catch (e) { setError(`Não foi possível criar a regra: ${errText(e)}`) }
    setBusy(false)
  }
  const refuse = async () => {
    if (!sug) return
    try { await dismissRuleSuggestion(db, sug.pattern); await reload() } catch (e) { setError(`Não foi possível dispensar a sugestão: ${errText(e)}`) }
  }

  return (
    <>
      <div className="side-card">
        <div className="side-h"><b>Regras</b><span className="muted">a mais específica ganha</span></div>
        {sug && sugCat && (
          <div className="rule-sug">
            <CategoryIcon category={sugCat} size={26} />
            <div className="lmid"><div><code>{sug.pattern}</code> → {sugCat.name}?</div><div className="muted">você escolheu isso à mão {sug.count} vezes</div></div>
            <button className="b" disabled={busy} onClick={() => void refuse()}>Não</button>
            <button className="b pri" disabled={busy} onClick={() => void accept()}>Criar</button>
          </div>
        )}
        {error && <div className="note" style={{ margin: '8px 14px' }}>{error}</div>}
        <RuleList rules={data.rules} showCategory />
        <AddRule />
      </div>
      <div className="muted" style={{ marginTop: 8 }}>A categoria escolhida à mão numa compra ganha de todas as regras.</div>
    </>
  )
}
