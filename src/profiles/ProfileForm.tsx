import { Camera } from 'lucide-react'
import { useRef, useState } from 'react'
import { Avatar } from './ProfileAvatar'
import { cropAvatar } from './avatar'
import { PROFILE_COLORS, validateProfileName, type Profile } from './profiles'

const COLOR_NAMES = ['Verde', 'Azul', 'Vermelho', 'Roxo', 'Turquesa', 'Amarelo']

interface Props {
  initial?: Profile
  others: Profile[]
  submitLabel: string
  onSubmit(v: { name: string; color: string; avatar: string | null }): Promise<void>
  onCancel(): void
  /** Falso onde o formulário já aparece aberto na tela (Configurações), para não roubar o foco ao entrar nela. */
  autoFocus?: boolean
}

export function ProfileForm({ initial, others, submitLabel, onSubmit, onCancel, autoFocus = true }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? PROFILE_COLORS[0])
  const [avatar, setAvatar] = useState<string | null>(initial?.avatar ?? null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  async function pickPhoto(f: File | undefined) {
    if (!f) return
    setError(null)
    try { setAvatar(await cropAvatar(f)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const invalid = validateProfileName(name, others)
    setNameError(invalid)
    if (invalid || busy) return
    setBusy(true)
    setError(null)
    try { await onSubmit({ name: name.trim(), color, avatar }) } catch (err) { setError(err instanceof Error ? err.message : String(err)); setBusy(false) }
  }

  return (
    <form className="profile-form" onSubmit={e => void submit(e)} onKeyDown={e => { if (e.key === 'Escape') onCancel() }}>
      <div className="profile-form-photo">
        <button type="button" className="profile-photo-btn" tabIndex={-1} aria-hidden onClick={() => file.current?.click()}>
          <Avatar profile={{ name, color, avatar }} size={72} />
          <span className="profile-photo-cam" aria-hidden><Camera size={14} /></span>
        </button>
        <input ref={file} type="file" accept="image/*" hidden onChange={e => { void pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
        <button type="button" className="b ghost sm" onClick={() => file.current?.click()}>Escolher foto…</button>
        {avatar && <button type="button" className="b ghost sm" onClick={() => setAvatar(null)}>Remover foto</button>}
      </div>
      <div className="profile-form-fields">
        <label className="field">
          <span>Nome</span>
          <input className="in" autoFocus={autoFocus} maxLength={30} value={name} aria-invalid={nameError !== null} aria-describedby={nameError ? 'profile-name-err' : undefined}
            onChange={e => { setName(e.target.value); setNameError(null) }} />
        </label>
        {nameError && <div id="profile-name-err" className="profile-err" role="alert">{nameError}</div>}
        <div className="profile-colors" role="radiogroup" aria-label="Cor do perfil">
          {PROFILE_COLORS.map((c, i) => (
            <label key={c} className="profile-swatch">
              <input type="radio" name="profile-color" value={c} checked={color === c} aria-label={COLOR_NAMES[i] ?? c} onChange={() => setColor(c)} />
              <span style={{ background: c }} />
            </label>
          ))}
        </div>
        <div className="muted">Sem foto, o perfil usa a inicial sobre a cor.</div>
        {error && <div className="profile-err" role="alert">{error}</div>}
        <div className="profile-form-actions">
          <button type="button" className="b ghost" onClick={onCancel}>Cancelar</button>
          <button type="submit" className="b pri" disabled={busy}>{submitLabel}</button>
        </div>
      </div>
    </form>
  )
}
