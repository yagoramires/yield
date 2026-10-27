import { Check, Copy as CopyIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

/** Botão de copiar: o ícone vira ✓ por 1,5 s. `label` aparece ao lado do ícone quando informado. */
export function CopyButton({ text, label, what, primary, small }: { text: string; label?: string; what: string; primary?: boolean; small?: boolean }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1500)
    return () => clearTimeout(t)
  }, [done])
  const copy = () => { void navigator.clipboard?.writeText(text).then(() => setDone(true), () => {}) }
  if (label) return (
    <button className={`b with-ico ${primary ? 'pri' : ''} ${small ? 'copy-small' : ''}`} aria-label={`Copiar ${what}`} onClick={copy}>{done ? <Check size={13} aria-hidden /> : <CopyIcon size={13} aria-hidden />}{done && !small ? 'Copiado' : label}</button>
  )
  return (
    <button className={`icon-btn sq copy-btn ${done ? 'ok' : ''}`} aria-label={`Copiar ${what}`} title={`Copiar ${what}`} onClick={copy}>
      {done ? <Check size={12} aria-hidden /> : <CopyIcon size={12} aria-hidden />}
    </button>
  )
}
