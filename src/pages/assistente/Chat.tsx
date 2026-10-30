import { ArrowUp, SquarePen, Sparkles, Square, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { CatalogModel } from '../../ai/catalog'
import { runChat } from '../../ai/chat'
import { maskMoney } from '../../ai/check'
import type { AiInput } from '../../ai/facts'
import type { ChatMsg } from '../../ai/llm'
import { abort, ensureServer, tauriPost } from '../../ai/server'
import { useHideValues } from '../../ui/HideValues'
import { errText } from '../lancamentos/GastosHeader'

const TOOL_LABEL: Record<string, string> = {
  gastos: 'Consultando seus gastos', lancamentos: 'Procurando lançamentos', orcamento: 'Olhando o orçamento',
  carteira: 'Olhando a carteira', rentabilidade: 'Comparando com o CDI', proventos: 'Somando proventos',
}
const SUGGESTIONS = ['Quanto gastei com mercado este ano?', 'Como está meu orçamento deste mês?', 'Minha carteira rendeu mais que o CDI?', 'Quanto recebi de proventos este ano?']

interface Turn { q: string; a: string; unverified: string[]; error?: string }

/** Perguntas livres, no formato de chat; a conversa vive só aqui (não é salva) e "Nova conversa" zera. */
export function Chat({ model, input, loadRent }: { model: CatalogModel; input: AiInput | null; loadRent(meses: number): Promise<AiInput['rent']> }) {
  useHideValues() // redesenha quando o olhinho muda
  const [history, setHistory] = useState<ChatMsg[]>([])
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [live, setLive] = useState<{ q: string; text: string; tool: string | null } | null>(null)
  const stop = useRef<AbortController | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // acompanha a resposta chegando, como num chat
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }) }, [turns, live])
  // a caixa cresce com o texto até umas 6 linhas
  useEffect(() => { const t = box.current; if (t) { t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 140)}px` } }, [q])

  const send = async (text = q) => {
    const question = text.trim()
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
      setTurns(ts => [...ts, { q: question, a: r.answer || 'Resposta interrompida.', unverified: r.unverified }])
    } catch (e) {
      const msg = errText(e)
      setTurns(ts => [...ts, { q: question, a: '', unverified: [], error: msg.startsWith('HTTP 400') ? 'A conversa ficou longa. Comece uma nova conversa.' : msg }])
    }
    setLive(null)
    box.current?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
  }
  const reset = () => { setHistory([]); setTurns([]); box.current?.focus() }
  const empty = !turns.length && !live

  return (
    <div className="chat">
      {!empty && !live && <button className="b ghost with-ico chat-new" onClick={reset}><SquarePen size={13} aria-hidden />Nova conversa</button>}
      <div className="chat-scroll" ref={scroll} aria-live="polite">
        <div className="chat-col">
          {empty ? (
            <div className="chat-empty">
              <div className="chat-avatar big"><Sparkles size={20} aria-hidden /></div>
              <h2>Como posso ajudar com suas finanças?</h2>
              <p className="muted">Pergunte sobre gastos, orçamento, carteira e proventos. Tudo roda neste computador.</p>
              <div className="chat-sugs">
                {SUGGESTIONS.map(s => <button key={s} className="chat-sug" disabled={!input} onClick={() => void send(s)}>{s}</button>)}
              </div>
            </div>
          ) : <>
            {turns.map((t, i) => (
              <div key={i} className="chat-turn">
                <div className="msg-user">{t.q}</div>
                <div className="msg-ai">
                  <div className="chat-avatar"><Sparkles size={13} aria-hidden /></div>
                  {t.error ? <div className="alert-bad"><span>{t.error}</span></div> : (
                    <div className="msg-body">
                      {maskMoney(t.a)}
                      {t.unverified.length > 0 && <div className="msg-warn" title={`Não saiu das ferramentas: ${t.unverified.join(', ')}`}><TriangleAlert size={12} aria-hidden />valor não conferido</div>}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {live && (
              <div className="chat-turn">
                <div className="msg-user">{live.q}</div>
                <div className="msg-ai">
                  <div className="chat-avatar"><Sparkles size={13} aria-hidden /></div>
                  <div className="msg-body">
                    {live.tool ? <span className="msg-tool">{TOOL_LABEL[live.tool] ?? 'Consultando'}…</span>
                      : live.text ? <>{maskMoney(live.text)}<span className="msg-caret" aria-hidden /></>
                      : <span className="msg-dots" aria-label="pensando"><i /><i /><i /></span>}
                  </div>
                </div>
              </div>
            )}
          </>}
        </div>
      </div>
      <div className="chat-col">
        <form className="chat-composer" onSubmit={e => { e.preventDefault(); void send() }}>
          <textarea ref={box} rows={1} aria-label="Pergunta" placeholder="Pergunte sobre os seus dados…" value={q} disabled={!input} onChange={e => setQ(e.target.value)} onKeyDown={onKey} />
          {live
            ? <button type="button" className="chat-send" aria-label="Parar" onClick={() => { stop.current?.abort(); void abort() }}><Square size={12} fill="currentColor" aria-hidden /></button>
            : <button type="submit" className="chat-send" aria-label="Enviar" disabled={!q.trim() || !input}><ArrowUp size={16} aria-hidden /></button>}
        </form>
        <div className="chat-foot">Respostas a partir dos seus dados; não são recomendação de investimento. Enter envia, Shift+Enter quebra a linha.</div>
      </div>
    </div>
  )
}
