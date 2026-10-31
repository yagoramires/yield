import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { useState } from 'react'
import { backupPasswordError } from './build'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Senha e destino do backup; o Rust exporta, criptografa e grava, sem o banco passar pelo webview. */
export function BackupExport({ onDone, onCancel }: { onDone(message: string): void; onCancel(): void }) {
  const [pw, setPw] = useState({ password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const exportar = async () => {
    const bad = backupPasswordError(pw.password, pw.confirm)
    if (bad) return setError(bad)
    setError(null)
    try {
      const to = await save({ defaultPath: `yield-backup-${today()}.yield`, filters: [{ name: 'Backup do Yield', extensions: ['yield'] }] })
      if (!to) return
      setBusy(true)
      await invoke('backup_export', { to, password: pw.password })
      onDone(`Backup com senha salvo em ${to}.`)
    } catch (e) { setError(`Não foi possível exportar o backup: ${errText(e)}`) }
    setBusy(false)
  }

  return (
    <div className="info" style={{ marginTop: 10 }}>
      Escolha uma senha para o backup. <b>Sem ela não dá para abrir o arquivo</b>: nem o Yield consegue recuperar.
      <div className="row" style={{ marginTop: 8 }}>
        <input className="in" type="password" autoComplete="new-password" placeholder="senha" aria-label="Senha do backup" value={pw.password} onChange={e => setPw({ ...pw, password: e.target.value })} />
        <input className="in" type="password" autoComplete="new-password" placeholder="repita a senha" aria-label="Repita a senha" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') void exportar() }} />
      </div>
      <div className="btns" style={{ marginTop: 8 }}>
        <button className="b" disabled={busy} onClick={onCancel}>Cancelar</button>
        <button className="b pri" disabled={busy} onClick={() => void exportar()}>{busy ? 'Salvando…' : 'Escolher onde salvar…'}</button>
      </div>
      {error && <div className="note" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  )
}
