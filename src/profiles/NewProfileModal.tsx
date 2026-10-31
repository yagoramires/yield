import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useRef, useState } from 'react'
import { BackupError, stageBackup } from '../db/backup'
import { createAndSwitch, createFromBackup, switchTo } from './active'
import { ProfileForm } from './ProfileForm'
import { randomId, type Profile, type ProfilesFile } from './profiles'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const BACKUP_FILTER = [{ name: 'Backup do Yield', extensions: ['yield', 'db'] }]

type Stage = { kind: 'new' } | { kind: 'password'; path: string; password: string } | { kind: 'restore' } | { kind: 'failed'; profile: Profile; message: string }

/** "Novo perfil": vazio, ou com os dados de um backup (o perfil novo fica sem PIN). */
export function NewProfileModal({ profiles, save, onCancel }: { profiles: Profile[]; save(next: ProfilesFile): Promise<void>; onCancel(): void }) {
  const [stage, setStage] = useState<Stage>({ kind: 'new' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const staged = useRef(false) // restore.db aberto: não fica no disco se o modal fechar antes de restaurar

  const discard = async () => { staged.current = false; await invoke('discard_restore').catch(() => {}) }
  useEffect(() => () => { if (staged.current) void invoke('discard_restore').catch(() => {}) }, [])
  const cancel = () => { void discard(); onCancel() }

  const validar = async (path: string, password: string | null) => {
    await stageBackup(path, password)
    staged.current = true
    setStage({ kind: 'restore' })
  }

  const escolher = async () => {
    setError(null)
    try {
      const path = await open({ multiple: false, directory: false, filters: BACKUP_FILTER })
      if (!path) return
      if (await invoke<boolean>('is_encrypted_backup', { path })) setStage({ kind: 'password', path, password: '' })
      else await validar(path, null)
    } catch (e) { setError(e instanceof BackupError ? e.message : `Não foi possível ler o backup: ${errText(e)}`) }
  }

  const abrirComSenha = async () => {
    if (stage.kind !== 'password') return
    setBusy(true); setError(null)
    try { await validar(stage.path, stage.password) } catch (e) { setError(e instanceof BackupError ? e.message : errText(e)) }
    setBusy(false)
  }

  const restaurar = async (v: { name: string; color: string; avatar: string | null }) => {
    const r = await createFromBackup(profiles, v, {
      save,
      activate: p => invoke('profile_activate', { id: p.id, dbFile: p.dbFile }),
      swap: () => invoke('swap_database'),
      discard,
    }, new Date().toISOString(), randomId)
    staged.current = false
    // o restore.db já foi descartado: escolher o arquivo de novo, em vez de criar um perfil vazio na segunda tentativa
    if (!r.profile) { setError(r.error); setStage({ kind: 'new' }); return }
    if (r.error) return setStage({ kind: 'failed', profile: r.profile, message: r.error })
    await switchTo(r.profile.id)
  }

  return (
    <div className="modal-bg">
      <div className="modal profile-modal" role="dialog" aria-modal="true" aria-label="Novo perfil">
        <h2>Novo perfil</h2>
        {stage.kind === 'new' && <>
          <ProfileForm others={profiles} submitLabel="Criar perfil" onSubmit={v => createAndSwitch(profiles, v, save)} onCancel={cancel} />
          <div className="muted" style={{ marginTop: 14, textAlign: 'center' }}>
            Tem um backup .yield? <button type="button" className="link" onClick={() => void escolher()}>Restaurar de um backup…</button>
          </div>
        </>}
        {stage.kind === 'password' && (
          <div>
            <div className="muted">Este backup tem senha.</div>
            <div className="row" style={{ marginTop: 8 }}>
              <input className="in" style={{ flex: 1 }} type="password" autoComplete="current-password" placeholder="senha do backup" aria-label="Senha do backup" value={stage.password} autoFocus
                onChange={e => setStage({ ...stage, password: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') void abrirComSenha() }} />
            </div>
            <div className="btns" style={{ marginTop: 10 }}>
              <button className="b" disabled={busy} onClick={() => { setError(null); setStage({ kind: 'new' }) }}>Voltar</button>
              <button className="b pri" disabled={busy || !stage.password} onClick={() => void abrirComSenha()}>{busy ? 'Abrindo…' : 'Abrir'}</button>
            </div>
          </div>
        )}
        {stage.kind === 'restore' && <>
          <div className="info" style={{ marginBottom: 12 }}>Backup aberto. Dê um nome ao perfil: ele começa com os dados do backup, sem PIN.</div>
          <ProfileForm others={profiles} submitLabel="Criar e restaurar" onSubmit={restaurar} onCancel={cancel} />
        </>}
        {stage.kind === 'failed' && <>
          <div className="note">{stage.message}</div>
          <div className="btns" style={{ marginTop: 10 }}>
            <button className="b pri" onClick={() => void switchTo(stage.profile.id)}>Entrar no perfil</button>
          </div>
        </>}
        {error && <div className="note" style={{ marginTop: 10 }}>{error}</div>}
      </div>
    </div>
  )
}
