import { useMemo, useState } from 'react'
import type { Note } from '../../db/repo'
import { formatCents } from '../../domain/money'
import type { Side } from '../../domain/types'
import { ASSET_TYPES, buildNote, emptyItem, FEE_FIELDS, noteNet, type Built, type ItemRow, type NoteForm as Form } from './build'
import { DateField } from '../../ui/DateField'
import { Select } from '../../ui/Select'

interface Props {
  mode: 'manual' | 'sem_nota'
  editing: Note | null
  initial: Form
  onSave(built: Built, editing: Note | null): Promise<string | null> // devolve a mensagem de erro, se houver
  onCancel(): void
}

export function NoteForm({ mode, editing, initial, onSave, onCancel }: Props) {
  const semNota = mode === 'sem_nota'
  const [f, setF] = useState<Form>(initial)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState<number | null>(null) // linha cujo ticker recebe o foco ao nascer
  const keep = editing ? { number: editing.number, source: editing.source, sourceKey: editing.sourceKey } : undefined

  // Prévia ao vivo (taxa rateada e líquido); some enquanto o formulário estiver inválido.
  const preview = useMemo(() => { try { return buildNote(f, mode, keep) } catch { return null } }, [f, mode, editing])

  const setItem = (i: number, p: Partial<ItemRow>) => setF({ ...f, items: f.items.map((r, n) => (n === i ? { ...r, ...p } : r)) })
  const addItem = () => { setFocus(f.items.length); setF({ ...f, items: [...f.items, emptyItem()] }) }
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !semNota) { e.preventDefault(); addItem() } }

  const submit = async () => {
    let built: Built
    try { built = buildNote(f, mode, keep) } catch (e) { return setError(e instanceof Error ? e.message : String(e)) }
    setError(await onSave(built, editing))
  }

  const title = semNota ? 'Operação sem nota' : editing ? `Nota ${editing.number} · ${editing.broker}` : 'Nova nota'
  return (
    <div className="card">
      <div className="bar"><b style={{ color: '#fff' }}>{title}</b>{editing && <span className="muted">editar = apagar e salvar de novo; o histórico é recalculado</span>}</div>
      <div className="row" style={{ margin: '10px 0' }}>
        {!semNota && <label className="field"><span>Nº da nota</span><input className="in" autoFocus value={f.number} onChange={e => setF({ ...f, number: e.target.value })} /></label>}
        <label className="field"><span>Corretora</span><input className="in" value={f.broker} onChange={e => setF({ ...f, broker: e.target.value })} /></label>
        <div className="field"><span>{semNota ? 'Data' : 'Pregão'}</span><DateField ariaLabel={semNota ? 'Data' : 'Pregão'} value={f.tradeDate} onChange={v => setF({ ...f, tradeDate: v })} /></div>
        {!semNota && <div className="field"><span>Liquidação</span><DateField ariaLabel="Liquidação" value={f.settleDate} onChange={v => setF({ ...f, settleDate: v })} /></div>}
        {semNota && <label className="field"><span>Motivo</span><input className="in" autoFocus placeholder="IPO, subscrição…" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} /></label>}
      </div>
      <div className="table-scroll" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table>
        <thead><tr><th>C/V</th><th>Tipo</th><th>Ticker</th><th className="r">Qtd</th><th className="r">Preço</th><th className="r">Total</th><th className="r">Taxa rateada</th><th /></tr></thead>
        <tbody>
          {f.items.map((r, i) => {
            const total = /^\d+$/.test(r.qty.trim()) && /^[\d.]+(,\d{1,2})?$/.test(r.price.trim()) ? Number(r.qty) * Math.round(Number(r.price.replace(/\./g, '').replace(',', '.')) * 100) : null
            return (
              <tr key={i}>
                <td><Select small ariaLabel="Compra ou venda" disabled={semNota} value={r.side} onChange={v => setItem(i, { side: v as Side })} options={[{ value: 'C', label: 'C' }, { value: 'V', label: 'V' }]} /></td>
                <td><Select small ariaLabel="Tipo do ativo" value={r.assetType} onChange={v => setItem(i, { assetType: v as ItemRow['assetType'] })} options={ASSET_TYPES.map(t => ({ value: t, label: t }))} /></td>
                <td><input className="in" style={{ width: 90 }} autoFocus={focus === i} value={r.ticker} onChange={e => setItem(i, { ticker: e.target.value.toUpperCase() })} onKeyDown={onEnter} /></td>
                <td className="r"><input className="in" style={{ width: 70, textAlign: 'right' }} inputMode="numeric" value={r.qty} onChange={e => setItem(i, { qty: e.target.value })} onKeyDown={onEnter} /></td>
                <td className="r"><input className="in" style={{ width: 90, textAlign: 'right' }} inputMode="decimal" placeholder="0,00" value={r.price} onChange={e => setItem(i, { price: e.target.value })} onKeyDown={onEnter} /></td>
                <td className="r">{total === null ? '—' : formatCents(total)}</td>
                <td className="r t2">{preview ? formatCents(preview.trades[i].feesCents) : '—'}</td>
                <td className="r">{!semNota && f.items.length > 1 && <button className="link dn" tabIndex={-1} onClick={() => setF({ ...f, items: f.items.filter((_, n) => n !== i) })}>remover</button>}</td>
              </tr>
            )
          })}
          {!semNota && <tr><td colSpan={8}><button className="link t2" onClick={addItem}>+ adicionar item</button> <span className="muted">(Enter em qualquer campo também adiciona)</span></td></tr>}
        </tbody>
      </table></div>
      {!semNota && (
        <>
          <h5>Taxas da nota <span className="muted">· rateadas pelo valor de cada item{editing && ' · as taxas da nota original aparecem somadas em Outros'}</span></h5>
          <div className="row">
            {FEE_FIELDS.map(([k, name]) => (
              <label key={k} className="field"><span>{name}</span><input className="in" style={{ width: 90 }} inputMode="decimal" placeholder="0,00" value={f.fees[k]} onChange={e => setF({ ...f, fees: { ...f.fees, [k]: e.target.value } })} /></label>
            ))}
          </div>
        </>
      )}
      {error && <div className="note" style={{ marginTop: 8 }}>{error}</div>}
      <div className="bar" style={{ marginTop: 12 }}>
        <span className="t2">{preview && <>Líquido: <b className={noteNet(preview.trades) < 0 ? 'dn' : 'up'}>{formatCents(noteNet(preview.trades))}</b>{!semNota && ` para ${preview.note.settleDate.split('-').reverse().join('/')}`}</>}</span>
        <div className="btns"><button className="b" onClick={onCancel}>Cancelar</button><button className="b pri" onClick={() => void submit()}>Salvar</button></div>
      </div>
    </div>
  )
}
