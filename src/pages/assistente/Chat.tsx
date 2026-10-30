import { MessageSquare, Square } from 'lucide-react'
import { useRef, useState } from 'react'
import type { CatalogModel } from '../../ai/catalog'
import { runChat } from '../../ai/chat'
import { maskMoney } from '../../ai/check'
import type { AiInput } from '../../ai/facts'
import type { ChatMsg } from '../../ai/llm'
import { abort, ensureServer, tauriPost } from '../../ai/server'
import { useHideValues } from '../../ui/HideValues'
import { errText } from '../lancamentos/GastosHeader'

const TOOL_LABEL: Record<string, string> = {
  gastos: 'consultando gastos…', lancamentos: 'procurando lançamentos…', orcamento: 'olhando o orçamento…',
  carteira: 'olhando a carteira…', rentabilidade: 'comparando com o CDI…', proventos: 'somando proventos…',
}

interface Turn { q: string; a: string; unverified: string[]; error?: string }

/** Perguntas livres; a conversa vive só aqui (não é salva) e "Nova conversa" zera. */
export function Chat({ model, input, loadRent }: { model: CatalogModel; input: AiInput | null; loadRent(meses: number): Promise<AiInput['rent']> }) {
  useHideValues() // redesenha quando o olhinho muda
  const [history, setHistory] = useState<ChatMsg[]>([])
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [live, setLive] = useState<{ q: string; text: string; tool: string | null } | null>(null)
  const stop = useRef<AbortController | null>(null)

  const send = async () => {
    const question = q.trim()
    if (!question || live || !input) return
    setQ('')
    setLive({ q: question, text: '', tool: null })
    const ctrl = (stop.current = new AbortController())
    try {
      await ensureServer(model)
      const r = await runChat(tauriPost, [...history, { role: 'user', content: question }], input, loadRent, {
        delta: t => setLive(l => l && { ...l, text: l.text + t, tool: null }),
        tool: name => setLive(l => l && { ...l, text: '', tool: name }),
      }, ctrl.signal)
      setHistory(r.messages.filter(m => m.role !== 'system'))
      setTurns(ts => [...ts, { q: question, a: r.answer, unverified: r.unverified }])
    } catch (e) {
      const msg = errText(e)
      setTurns(ts => [...ts, { q: question, a: '', unverified: [], error: msg.startsWith('HTTP 400') ? 'A conversa ficou longa. Comece uma nova conversa.' : msg }])
    }
    setLive(null)
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="bar">
        <div className="row" style={{ alignItems: 'center', gap: 8 }}><MessageSquare size={14} aria-hidden /><h5 style={{ margin: 0 }}>Pergunte sobre os seus dados</h5></div>
        {turns.length > 0 && !live && <button className="link" onClick={() => { setHistory([]); setTurns([]) }}>Nova conversa</button>}
      </div>
      <div className="chat-log" aria-live="polite">
        {turns.map((t, i) => (
          <div key={i}>
            <div className="chat-q">{t.q}</div>
            {t.error ? <div className="alert-bad"><span>{t.error}</span></div> : (
              <div className="chat-a">{maskMoney(t.a)}
                {t.unverified.length > 0 && <span className="tag warn" title={`Não saiu das ferramentas: ${t.unverified.join(', ')}`}> valor não conferido</span>}
              </div>
            )}
          </div>
        ))}
        {live && <div><div className="chat-q">{live.q}</div><div className="chat-a muted">{live.tool ? TOOL_LABEL[live.tool] ?? 'consultando…' : live.text ? maskMoney(live.text) : 'pensando…'}</div></div>}
      </div>
      <form className="row" style={{ gap: 8, marginTop: 10 }} onSubmit={e => { e.preventDefault(); void send() }}>
        <input className="in" style={{ flex: 1 }} aria-label="Pergunta" placeholder="Ex.: quanto gastei com mercado este ano?" value={q} disabled={!!live || !input} onChange={e => setQ(e.target.value)} />
        {live
          ? <button type="button" className="b ghost with-ico" onClick={() => { stop.current?.abort(); void abort() }}><Square size={12} aria-hidden />Parar</button>
          : <button type="submit" className="b pri" disabled={!q.trim() || !input}>Enviar</button>}
      </form>
    </div>
  )
}
