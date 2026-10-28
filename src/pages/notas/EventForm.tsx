import { useState } from 'react'
import { buildEvent, emptyEvent, type EventForm as Form } from './build'
import type { NewCorporateEvent } from '../../domain/types'
import { DateField } from '../../ui/DateField'

export const EVENT_LABEL: Record<NewCorporateEvent['kind'], string> = { bonificacao: 'Bonificação', desdobramento: 'Desdobramento', grupamento: 'Grupamento', mudanca_ticker: 'Mudança de ticker' }

export function EventForm({ onSave, onCancel }: { onSave(e: NewCorporateEvent): Promise<string | null>; onCancel(): void }) {
  const [f, setF] = useState<Form>(emptyEvent())
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    let ev: NewCorporateEvent
    try { ev = buildEvent(f) } catch (e) { return setError(e instanceof Error ? e.message : String(e)) }
    setError(await onSave(ev))
  }
  return (
    <div className="card">
      <b style={{ color: '#fff' }}>Novo evento corporativo</b>
      <div className="row" style={{ margin: '10px 0' }}>
        <label className="field"><span>Evento</span>
          <select className="in" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as Form['kind'] })}>
            {Object.entries(EVENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Ativo</span><input className="in" autoFocus style={{ width: 90 }} value={f.ticker} onChange={e => setF({ ...f, ticker: e.target.value.toUpperCase() })} /></label>
        <div className="field"><span>Data</span><DateField ariaLabel="Data do evento" value={f.date} onChange={v => setF({ ...f, date: v })} /></div>
        {f.kind === 'mudanca_ticker' ? (
          <label className="field"><span>Novo ticker</span><input className="in" style={{ width: 90 }} value={f.newTicker} onChange={e => setF({ ...f, newTicker: e.target.value.toUpperCase() })} /></label>
        ) : (
          <label className="field"><span>{f.kind === 'grupamento' ? 'Qtd a menos' : 'Qtd a mais'}</span><input className="in" style={{ width: 90 }} inputMode="numeric" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></label>
        )}
        {f.kind === 'bonificacao' && <label className="field"><span>Custo unitário (opcional)</span><input className="in" style={{ width: 90 }} inputMode="decimal" placeholder="0,00" value={f.unitCost} onChange={e => setF({ ...f, unitCost: e.target.value })} /></label>}
      </div>
      {error && <div className="note" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="btns"><button className="b" onClick={onCancel}>Cancelar</button><button className="b pri" onClick={() => void submit()}>Salvar</button></div>
    </div>
  )
}
