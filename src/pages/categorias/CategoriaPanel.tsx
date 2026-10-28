import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { deleteCategory, saveCategory, updateCategory, type Category } from '../../db/gastosRepo'
import { useData } from '../../state/DataProvider'
import { categoryLook, COLOR_CHOICES, ICON_CHOICES, IconGlyph } from '../../ui/CategoryIcon'
import { errText } from '../lancamentos/GastosHeader'
import { deleteImpact, validateCategoryName } from './build'
import { AddRule, plural, RuleList } from './RegrasPanel'
import { Select } from '../../ui/Select'


/** Coluna direita ao editar (`category`) ou criar (`null`) uma categoria. Esc ou Cancelar volta para as regras. */
export function CategoriaPanel({ category, onClose }: { category: Category | null; onClose(): void }) {
  const { db, reload, gastos: { data }, orcamento } = useData()
  const look = categoryLook(category ?? { id: '', icon: null, color: null })
  const [name, setName] = useState(category?.name ?? '')
  const [icon, setIcon] = useState(look.icon)
  const [color, setColor] = useState(look.color)
  const [counts, setCounts] = useState(category?.countsAsSpending ?? true)
  const [deleting, setDeleting] = useState(false)
  const [moveTo, setMoveTo] = useState(category && category.id !== 'outros' ? 'outros' : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn(); await reload(); setBusy(false); onClose() } catch (e) { setError(`${what}: ${errText(e)}`); setBusy(false) }
  }
  const save = () => run(category ? 'Não foi possível salvar a categoria' : 'Não foi possível criar a categoria', async () => {
    const n = validateCategoryName(name, data.categories, category?.id)
    if (category) await updateCategory(db, category.id, { name: n, icon, color, countsAsSpending: counts })
    else await saveCategory(db, n, counts, { icon, color })
  })

  const impact = category ? deleteImpact(category.id, data.rules, data.overrides) : null
  const budgetLines = category ? orcamento.data.lines.filter(l => l.categoryId === category.id).length : 0
  const rules = category ? data.rules.filter(r => r.categoryId === category.id) : []
  const moving = impact ? [
    impact.overrides > 0 && plural(impact.overrides, 'compra escolhida à mão', 'compras escolhidas à mão'),
    impact.rules > 0 && plural(impact.rules, 'regra', 'regras'),
    budgetLines > 0 && plural(budgetLines, 'linha do orçamento', 'linhas do orçamento'),
  ].filter((x): x is string => !!x) : []

  return (
    <div className="side-card cat-panel">
      <div className="side-h"><span className="row" style={{ alignItems: 'center', gap: 8 }}><IconGlyph name={icon} color={color} size={26} /><b>{name.trim() || 'Nova categoria'}</b></span><span className="muted">Esc fecha</span></div>
      <label className="panel-field"><span>Nome</span>
        <input className="in" autoFocus={!category} value={name} onChange={e => setName(e.target.value)} /></label>
      <div className="panel-field"><span>Ícone</span>
        <div className="icon-grid">{ICON_CHOICES.map(n => (
          <button key={n} className={n === icon ? 'on' : ''} aria-label={`Ícone ${n}`} aria-pressed={n === icon} onClick={() => setIcon(n)}><IconGlyph name={n} color={n === icon ? color : 'currentColor'} size={14} bare /></button>
        ))}</div></div>
      <div className="panel-field"><span>Cor</span>
        <div className="color-row">{COLOR_CHOICES.map(c => (
          <button key={c} className={c === color ? 'on' : ''} style={{ background: c }} aria-label={`Cor ${c}`} aria-pressed={c === color} onClick={() => setColor(c)} />
        ))}</div></div>
      <div className="panel-field">
        {category?.builtin
          ? <div className="muted">Categoria padrão: {category.countsAsSpending ? 'conta como gasto' : 'fica fora dos totais de gasto'}.</div>
          : <label className="toggle-row"><span>Conta como gasto<small>desligado: aparece, mas fica fora dos totais</small></span>
            <input type="checkbox" checked={counts} onChange={e => setCounts(e.target.checked)} /></label>}
      </div>
      {category && (
        <div className="panel-field"><span>Regras desta categoria</span>
          <div className="panel-rules"><RuleList rules={rules} showCategory={false} /></div>
          <AddRule key={category.id} categoryId={category.id} />
        </div>
      )}
      {error && <div className="note" style={{ margin: '0 14px 10px' }}>{error}</div>}
      {deleting && category && impact ? (
        <div className="panel-foot danger-zone">
          {moving.length === 0 ? <div>Apagar <b>{category.name}</b>? Ela não tem compras escolhidas à mão, regras nem orçamento.</div> : (
            <div>Apagar <b>{category.name}</b>? {moving.join(', ').replace(/, ([^,]*)$/, ' e $1')} {moving.length > 1 || !moving[0].startsWith('1 ') ? 'vão' : 'vai'} para{' '}
              <Select small ariaLabel="Mover para" value={moveTo} onChange={setMoveTo} options={[...data.categories.filter(c => c.id !== category.id).map(c => ({ value: c.id, label: c.name })), { value: '', label: 'Sem categoria' }]} />
              {!moveTo && <div className="muted">Sem categoria: as compras voltam para a categoria automática e as linhas do orçamento ficam sem categoria.</div>}
            </div>
          )}
          <span className="btns">
            <button className="b" disabled={busy} onClick={() => setDeleting(false)}>Cancelar</button>
            <button className="b danger" disabled={busy} onClick={() => void run('Não foi possível apagar a categoria', () => deleteCategory(db, category.id, (moving.length && moveTo) || null))}>{busy ? 'Apagando…' : moveTo && moving.length ? 'Apagar e mover' : 'Apagar'}</button>
          </span>
        </div>
      ) : (
        <div className="panel-foot">
          {category && !category.builtin ? <button className="b ghost with-ico del-text" onClick={() => { setDeleting(true); setError(null) }}><Trash2 size={13} aria-hidden />Apagar categoria</button> : <span />}
          <span className="btns">
            <button className="b" disabled={busy} onClick={onClose}>Cancelar</button>
            <button className="b pri" disabled={busy} onClick={() => void save()}>{busy ? 'Salvando…' : category ? 'Salvar' : 'Criar'}</button>
          </span>
        </div>
      )}
    </div>
  )
}
