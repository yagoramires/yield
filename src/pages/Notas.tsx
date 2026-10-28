import { useState } from 'react'
import { deleteEvent, deleteNote, replaceNote, saveEvent, saveNote, setBonificacaoCost, type Note } from '../db/repo'
import { formatCents } from '../domain/money'
import type { CorporateEvent, NewCorporateEvent } from '../domain/types'
import { useData } from '../state/DataProvider'
import { DUP_MSG, emptyForm, formFromNote, noteNet, parseMoney, type Built, type NoteForm as Form } from './notas/build'
import { EVENT_LABEL, EventForm } from './notas/EventForm'
import { NoteForm } from './notas/NoteForm'
import { PdfImport } from './notas/PdfImport'

type Panel = { t: 'nota'; mode: 'manual' | 'sem_nota'; editing: Note | null; initial: Form } | { t: 'pdf' } | { t: 'evento' } | null
const ORIGIN: Record<Note['source'], string> = { pdf: 'PDF', manual: 'manual', planilha: 'planilha', sem_nota: 'sem nota' }
const br = (iso: string) => iso.split('-').reverse().join('/')
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const sign = (c: number) => (c > 0 ? '+' : c < 0 ? '−' : '') + formatCents(Math.abs(c))

export function Notas() {
  const { data, db, reload } = useData()
  const [view, setView] = useState<'notas' | 'eventos'>('notas')
  const [panel, setPanel] = useState<Panel>(null)
  const [confirm, setConfirm] = useState<string | null>(null) // 'nota:<id>' | 'evento:<id>'
  const [costFor, setCostFor] = useState<{ id: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Mutação + recarga (Carteira e Imposto recalculam). Devolve a mensagem de erro, se houver.
  const run = async (fn: () => Promise<string | null | void>): Promise<string | null> => {
    try {
      const msg = await fn()
      if (msg) return msg
      await reload(); setError(null); return null
    } catch (e) { return `Não foi possível salvar: ${errText(e)}` }
  }
  const act = async (fn: () => Promise<void>) => setError(await run(fn))

  const saveBuilt = (built: Built, editing: Note | null, closePanel = true) => run(async () => {
    if (editing) await replaceNote(db, editing.id, built.note, built.trades)
    else if ('skipped' in (await saveNote(db, built.note, built.trades))) return DUP_MSG
    if (closePanel) setPanel(null)
  })
  const saveEv = (ev: NewCorporateEvent) => run(async () => {
    if ('skipped' in (await saveEvent(db, ev))) return 'Esse evento já existe.'
    setPanel(null)
  })
  const saveCost = () => act(async () => {
    if (!costFor) return
    await setBonificacaoCost(db, costFor.id, parseMoney(costFor.text, 'Custo unitário'))
    setCostFor(null)
  })

  const notes = [...data.notes].sort((a, b) => (a.tradeDate === b.tradeDate ? (a.number < b.number ? 1 : -1) : a.tradeDate < b.tradeDate ? 1 : -1))
  const open = (mode: 'manual' | 'sem_nota') => setPanel({ t: 'nota', mode, editing: null, initial: emptyForm() })
  const edit = (n: Note) => setPanel({ t: 'nota', mode: n.source === 'sem_nota' ? 'sem_nota' : 'manual', editing: n, initial: formFromNote(n, data.trades.filter(t => t.noteId === n.id)) })

  const eventQty = (e: CorporateEvent) => (e.kind === 'mudanca_ticker' ? `→ ${e.newTicker}` : e.qtyDelta.toLocaleString('pt-BR'))
  const events = [...data.events].sort((a, b) => (a.date < b.date ? 1 : -1))

  const rowActions = (key: string, label: string, onEdit: (() => void) | null, onDelete: () => Promise<void>) => confirm === key ? (
    <span>{label} <button className="link dn" onClick={() => void act(async () => { await onDelete(); setConfirm(null) })}>Excluir</button> <button className="link" onClick={() => setConfirm(null)}>Cancelar</button></span>
  ) : (
    <>{onEdit && <><button className="link" onClick={onEdit}>editar</button> · </>}<button className="link" onClick={() => setConfirm(key)}>excluir</button></>
  )

  return (
    <>
      <div className="bar">
        <h1>Notas</h1>
        <div className="btns">
          <button className="b pri" onClick={() => open('manual')}>+ Nota</button>
          <button className="b" onClick={() => setPanel({ t: 'pdf' })}>Importar PDF da Clear</button>
          <button className="b" onClick={() => open('sem_nota')}>Operação sem nota</button>
          <button className="b" onClick={() => { setView('eventos'); setPanel({ t: 'evento' }) }}>Evento corporativo</button>
        </div>
      </div>
      {error && <div className="note" style={{ marginTop: 10 }}>{error}</div>}
      <div className={`notes-layout${panel ? ' split' : ''}`}>
        <div>
          <div className="row" style={{ marginBottom: 8 }}>
            <button className={`chip ${view === 'notas' ? 'on' : ''}`} onClick={() => setView('notas')}>Notas</button>
            <button className={`chip ${view === 'eventos' ? 'on' : ''}`} onClick={() => setView('eventos')}>Eventos</button>
          </div>
          {view === 'notas' ? (
            notes.length === 0 ? <div className="info">Nenhuma nota ainda. Lance uma nota, importe o PDF da Clear ou a Negociação da B3 em Configurações.</div> : (
              <div className="table-scroll" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table>
                <thead><tr><th>Pregão</th><th>Nº</th><th>Corretora</th><th>Itens</th><th className="r">Líquido</th><th /></tr></thead>
                <tbody>
                  {notes.map(n => {
                    const ts = data.trades.filter(t => t.noteId === n.id)
                    const net = noteNet(ts)
                    return (
                      <tr key={n.id} style={panel?.t === 'nota' && panel.editing?.id === n.id ? { background: 'var(--surface)' } : undefined}>
                        <td>{br(n.tradeDate)}</td>
                        <td>{n.source === 'sem_nota' ? '—' : n.number}</td>
                        <td>{n.broker} <span className="tag">{ORIGIN[n.source]}</span>{n.label && <span className="t2"> {n.label}</span>}</td>
                        <td className="t2">{ts.map(t => t.ticker).join(', ')}</td>
                        <td className={`r ${net < 0 ? 'dn' : 'up'}`}>{sign(net)}</td>
                        <td className="r t2">{rowActions(`nota:${n.id}`, `Excluir a nota ${n.number} e recalcular tudo?`, () => edit(n), () => deleteNote(db, n.id))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table></div>
            )
          ) : events.length === 0 ? <div className="info">Nenhum evento corporativo.</div> : (
            <div className="table-scroll" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table>
              <thead><tr><th>Data</th><th>Evento</th><th>Ativo</th><th className="r">Qtd</th><th>Origem</th><th /></tr></thead>
              <tbody>
                {events.map(e => {
                  const semCusto = e.kind === 'bonificacao' && e.unitCostCents === null
                  return (
                    <tr key={e.id} style={semCusto ? { background: '#241e0c' } : undefined}>
                      <td>{br(e.date)}</td><td>{EVENT_LABEL[e.kind]}</td><td>{e.ticker}</td><td className="r">{eventQty(e)}</td>
                      <td className="t2">{e.kind === 'bonificacao' && e.unitCostCents !== null ? `custo ${formatCents(e.unitCostCents)}` : ''}</td>
                      <td className="r t2">
                        {semCusto && (costFor?.id === e.id ? (
                          <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                            <input className="in" style={{ width: 80 }} autoFocus placeholder="0,00" value={costFor.text} onChange={ev => setCostFor({ id: e.id, text: ev.target.value })} onKeyDown={ev => ev.key === 'Enter' && void saveCost()} />
                            <button className="link" onClick={() => void saveCost()}>Salvar</button> <button className="link" onClick={() => setCostFor(null)}>Cancelar</button>
                          </span>
                        ) : <><span className="dn">sem custo</span> · <button className="link" onClick={() => setCostFor({ id: e.id, text: '' })}>informar custo</button> · </>)}
                        {!(costFor?.id === e.id) && rowActions(`evento:${e.id}`, 'Excluir o evento e recalcular tudo?', null, () => deleteEvent(db, e.id))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table></div>
          )}
        </div>
        {panel?.t === 'nota' && <NoteForm key={panel.editing?.id ?? panel.mode} mode={panel.mode} editing={panel.editing} initial={panel.initial} onSave={saveBuilt} onCancel={() => setPanel(null)} />}
        {panel?.t === 'pdf' && <PdfImport db={db} notes={data.notes} onSave={b => saveBuilt(b, null, false)} onClose={() => setPanel(null)} />}
        {panel?.t === 'evento' && <EventForm onSave={saveEv} onCancel={() => setPanel(null)} />}
      </div>
    </>
  )
}
