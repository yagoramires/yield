import { invoke } from '@tauri-apps/api/core'
import { appConfigDir } from '@tauri-apps/api/path'
import { useEffect, useState } from 'react'
import { useData } from '../state/DataProvider'
import { deleteActive } from './active'
import { useProfiles } from './Gate'
import { Avatar } from './ProfileAvatar'
import { deleteConfirmed, type Profile } from './profiles'
import { saveProfiles } from './store'

/** Confirma e apaga o perfil ativo. `onDeleted` segue para o próximo da lista (o perfil já saiu dela). */
export function DeleteProfileDialog({ profile, onCancel, onDeleted }: { profile: Profile; onCancel(): void; onDeleted(): void }) {
  const { profiles } = useProfiles()
  const { db } = useData()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // o perfil já saiu da lista, mas algo ficou para trás: só resta seguir
  const [leftover, setLeftover] = useState<string | null>(null)
  const locked = busy || leftover !== null

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !locked) onCancel() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [locked, onCancel])

  async function apagar(e: React.FormEvent) {
    e.preventDefault()
    if (locked || !deleteConfirmed(typed, profile)) return
    setBusy(true)
    setError(null)
    // a lista vai direto para o disco, sem o contexto: trocar o perfil do contexto faria o app abrir o banco do próximo
    const fail = await deleteActive(profiles, profile, {
      save: saveProfiles,
      close: () => db.close(),
      activate: p => invoke('profile_activate', { id: p.id, dbFile: p.dbFile }),
      removeFiles: p => invoke<string | null>('profile_remove_files', { id: p.id, dbFile: p.dbFile }),
      folder: appConfigDir,
    })
    if (!fail) return onDeleted()
    setBusy(false)
    if (fail.listed) setError(fail.message)
    else setLeftover(fail.message)
  }

  return (
    <div className="modal-bg" onClick={() => { if (!locked) onCancel() }}>
      <div className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="delete-profile-title" onClick={e => e.stopPropagation()}>
        <h2 id="delete-profile-title">Apagar perfil</h2>
        <div className="row" style={{ alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Avatar profile={profile} size={40} />
          <b style={{ color: 'var(--strong)' }}>{profile.name}</b>
        </div>
        <p>Apaga todos os dados deste perfil neste computador: lançamentos, carteira, orçamento, contas conectadas e credenciais. Não dá para desfazer. Se quiser guardar, exporte um backup antes.</p>
        {leftover ? (
          <>
            <div className="note" role="alert">{leftover}</div>
            <div className="profile-form-actions" style={{ marginTop: 12 }}>
              <button type="button" className="b pri" autoFocus onClick={onDeleted}>Continuar</button>
            </div>
          </>
        ) : (
          <form onSubmit={e => void apagar(e)}>
            <label className="field">
              <span>Digite {profile.name} para confirmar</span>
              <input className="in" autoFocus autoComplete="off" value={typed} disabled={busy} onChange={e => setTyped(e.target.value)} />
            </label>
            {error && <div className="profile-err" role="alert" style={{ marginTop: 8 }}>{error}</div>}
            <div className="profile-form-actions" style={{ marginTop: 12 }}>
              <button type="button" className="b ghost" disabled={busy} onClick={onCancel}>Cancelar</button>
              <button type="submit" className="b danger" disabled={busy || !deleteConfirmed(typed, profile)}>{busy ? 'Apagando…' : 'Apagar perfil'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
