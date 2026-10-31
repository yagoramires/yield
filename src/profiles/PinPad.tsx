import { Delete, Timer } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Avatar } from './ProfileAvatar'
import { PIN_LEN, formatWait, nowSecs, pinKey } from './pin'
import type { Profile } from './profiles'

interface Props {
  title: string
  profile?: Profile
  /** Fim da espera (segundos desde a época); enquanto não passa, o teclado fica desligado. */
  until?: number | null
  message?: string | null
  onComplete(pin: string): void | Promise<void>
  onBack?(): void
  footer?: ReactNode
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

export function PinPad({ title, profile, until = null, message = null, onComplete, onBack, footer }: Props) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(nowSecs)
  const locked = until !== null && until > now
  // durante a conferência só ignora as teclas: desligar o botão tiraria o foco dele
  const off = locked || busy

  // o relógio local conta a espera; ao chegar no `until` o teclado volta sozinho
  useEffect(() => { setNow(nowSecs()) }, [until])
  useEffect(() => {
    if (!locked) return
    const t = setInterval(() => setNow(nowSecs()), 1000)
    return () => clearInterval(t)
  }, [locked])

  function press(key: string) {
    if (off) return
    const next = pinKey(pin, key)
    if (next.length < PIN_LEN) { setPin(next); return }
    setPin(next)
    setBusy(true)
    void Promise.resolve()
      .then(() => onComplete(next))
      .finally(() => { setPin(''); setBusy(false) })
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // num campo de texto (ou com atalho) a tecla é de outra coisa
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Backspace' || /^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key) }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  })

  const waitAnnounce = until === null ? '' : `Muitas tentativas erradas. Tente de novo às ${new Date(until * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`

  return (
    <div className="pin-pad">
      {profile && <Avatar profile={profile} size={64} />}
      <div className="pin-title">{title}</div>
      <div className="pin-dots">
        <span className="pin-sr" aria-live="polite">{pin.length} de {PIN_LEN} dígitos</span>
        {Array.from({ length: PIN_LEN }, (_, i) => <i key={i} aria-hidden className={i < pin.length ? 'f' : undefined} />)}
      </div>
      {/* aviso único para leitor de tela: a contagem visível muda a cada segundo e não deve ser lida a cada tique */}
      <div className="pin-sr" role="status">{locked ? waitAnnounce : message}</div>
      {locked ? (
        <div className="pin-wait"><Timer size={15} aria-hidden /> Muitas tentativas erradas. Tente de novo em <b>{formatWait(until - now)}</b></div>
      ) : message && <div className="pin-msg">{message}</div>}
      <div className="pin-keys" role="group" aria-label="Teclado do PIN">
        {DIGITS.map(d => <button key={d} type="button" className="pin-key" disabled={locked} onClick={() => press(d)}>{d}</button>)}
        {onBack ? <button type="button" className="pin-key x" onClick={onBack}>Voltar</button> : <span />}
        <button type="button" className="pin-key" disabled={locked} onClick={() => press('0')}>0</button>
        <button type="button" className="pin-key x" disabled={locked} aria-label="Apagar dígito" onClick={() => press('Backspace')}><Delete size={18} aria-hidden /></button>
      </div>
      {footer}
    </div>
  )
}
