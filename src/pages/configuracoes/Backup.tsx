import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useRef, useState } from 'react'
import { BackupError, stageBackup } from '../../db/backup'
import { openDb } from '../../db/client'
import { migrateOnce } from '../../db/migrate'
import { MIGRATIONS } from '../../db/migrations'
import { renormalizeBrokers } from '../../db/repo'
import { useProfiles } from '../../profiles/Gate'
import { repairCryptoSymbols } from '../../quotes/yahoo'
import { useData } from '../../state/DataProvider'
import { BackupExport } from './BackupExport'
import { restoreBackup } from './build'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const BACKUP_FILTER = [{ name: 'Backup do Yield', extensions: ['yield', 'db'] }] // .db: backups antigos, sem senha

export function Backup() {
  const { db, reload } = useData()
  const { dbFile } = useProfiles().profile
  const [busy, setBusy] = useState(false) // backup em troca
  const [restore, setRestore] = useState(false) // backup já validado no restore.db, esperando confirmação
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false) // pedindo a senha do novo backup
  const [importPw, setImportPw] = useState<{ path: string; password: string } | null>(null) // backup com senha escolhido

  // restore.db é o backup já aberto: não fica no disco se a importação não for até o fim
  const discardRestore = () => { invoke('discard_restore').catch(() => {}) }
  const swapping = useRef(false) // a troca já começou no Rust: sair da seção não descarta o arquivo que ela está lendo
  useEffect(() => () => { if (!swapping.current) discardRestore() }, []) // saiu da seção com a importação pendente
  const resetBackup = () => { setBackupMsg(null); setBackupError(null); setRestore(false); setExporting(false); setImportPw(null); discardRestore() }

  const validar = async (path: string, password: string | null) => {
    await stageBackup(path, password)
    setRestore(true)
  }

  const escolherBackup = async () => {
    resetBackup()
    try {
      const path = await open({ multiple: false, directory: false, filters: BACKUP_FILTER })
      if (!path) return
      if (await invoke<boolean>('is_encrypted_backup', { path })) setImportPw({ path, password: '' })
      else await validar(path, null)
    } catch (e) { setBackupError(e instanceof BackupError ? e.message : `Não foi possível ler o backup: ${errText(e)}`) }
  }

  const abrirComSenha = async () => {
    if (!importPw) return
    setBusy(true); setBackupError(null)
    try {
      await validar(importPw.path, importPw.password)
      setImportPw(null)
    } catch (e) { setBackupError(e instanceof BackupError ? e.message : errText(e)) }
    setBusy(false)
  }

  const substituir = async () => {
    if (!restore) return
    setBusy(true)
    swapping.current = true
    const r = await restoreBackup({
      checkpoint: async () => { await db.execute('PRAGMA wal_checkpoint(TRUNCATE)') },
      close: () => db.close(),
      swap: () => invoke<string | null>('swap_database'),
      // `db_load` cria um pool novo e o põe no mapa pelo nome do arquivo do perfil;
      // o `db` do DataProvider resolve o pool por esse nome, então passa a ler o arquivo novo.
      // backup de versão antiga (ou de outro perfil) sobe para a versão do app pelo `migrate`, em qualquer perfil
      reopen: async () => { const d = await openDb(dbFile); await migrateOnce(dbFile, d, MIGRATIONS); await renormalizeBrokers(d); await repairCryptoSymbols(d) },
      reload,
    })
    if (r.ok) setBackupMsg(r.message)
    else { setBackupError(r.message); discardRestore() }
    swapping.current = false
    setRestore(false); setBusy(false)
  }

  return (
    <div className="card">
      <b style={{ color: 'var(--strong)' }}>Backup</b>
      <div className="muted" style={{ margin: '4px 0 10px' }}>Um arquivo .yield com todos os dados deste perfil, criptografado com uma senha sua (AES-256)</div>
      <div className="btns">
        <button className="b" disabled={busy} onClick={() => { resetBackup(); setExporting(true) }}>Exportar backup…</button>
        <button className="b" disabled={busy} onClick={() => void escolherBackup()}>Importar backup…</button>
      </div>
      {exporting && <BackupExport onBusy={setBusy} onDone={m => { setExporting(false); setBackupMsg(m) }} onCancel={resetBackup} />}
      {importPw && (
        <div className="info" style={{ marginTop: 10 }}>
          Este backup tem senha.
          <div className="row" style={{ marginTop: 8 }}>
            <input className="in" type="password" autoComplete="current-password" placeholder="senha do backup" aria-label="Senha do backup" value={importPw.password} autoFocus
              onChange={e => setImportPw({ ...importPw, password: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') void abrirComSenha() }} />
          </div>
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="b" disabled={busy} onClick={() => resetBackup()}>Cancelar</button>
            <button className="b pri" disabled={busy || !importPw.password} onClick={() => void abrirComSenha()}>{busy ? 'Abrindo…' : 'Abrir'}</button>
          </div>
        </div>
      )}
      {restore && (
        <div className="note" style={{ marginTop: 10 }}>
          Isso substitui todos os dados atuais. Uma cópia de segurança será guardada.
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="b" disabled={busy} onClick={() => { setRestore(false); discardRestore() }}>Cancelar</button>
            <button className="b pri" disabled={busy} onClick={() => void substituir()}>{busy ? 'Substituindo…' : 'Substituir dados'}</button>
          </div>
        </div>
      )}
      {backupError && <div className="note" style={{ marginTop: 10 }}>{backupError}</div>}
      {backupMsg && <div className="info" style={{ marginTop: 10 }}>{backupMsg}</div>}
    </div>
  )
}
