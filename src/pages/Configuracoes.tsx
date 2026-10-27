import { invoke } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { open, save } from '@tauri-apps/plugin-dialog'
import { useState } from 'react'
import { BackupError, exportBackup, validateBackup } from '../db/backup'
import { openDb, type Db } from '../db/client'
import { useData } from '../state/DataProvider'
import { backupPasswordError, refreshLine, restoreBackup } from './configuracoes/build'
import { FontesRenda, ImportarOrcamento } from './configuracoes/OrcamentoConfig'
import { Contas, OpenFinance } from './configuracoes/OpenFinance'
import { useB3Import } from './configuracoes/useB3Import'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dayTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const BACKUP_FILTER = [{ name: 'Backup do Yield', extensions: ['yield', 'db'] }] // .db: backups antigos, sem senha

export function Configuracoes() {
  const { data, db, reload, refreshing, refreshQuotesNow, lastRefresh } = useData()
  const b3 = useB3Import()
  const [busy, setBusy] = useState(false) // backup em troca
  const [restore, setRestore] = useState<string | null>(null) // caminho do backup já validado, esperando confirmação
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [exportPw, setExportPw] = useState<{ password: string; confirm: string } | null>(null) // pedindo a senha do novo backup
  const [importPw, setImportPw] = useState<{ path: string; password: string } | null>(null) // backup com senha escolhido

  const resetBackup = () => { setBackupMsg(null); setBackupError(null); setRestore(null); setExportPw(null); setImportPw(null) }

  const exportar = async () => {
    if (!exportPw) return
    const bad = backupPasswordError(exportPw.password, exportPw.confirm)
    if (bad) return setBackupError(bad)
    setBackupError(null)
    try {
      const dest = await save({ defaultPath: `yield-backup-${today()}.yield`, filters: [{ name: 'Backup do Yield', extensions: ['yield'] }] })
      if (!dest) return
      setBusy(true)
      // VACUUM INTO falha se o arquivo já existe: nome único por exportação
      const tmp = await join(await appDataDir(), `export-${Date.now()}.db`)
      await exportBackup(db, tmp, dest, (from, to) => invoke('encrypt_backup', { from, to, password: exportPw.password }))
      setExportPw(null)
      setBackupMsg(`Backup com senha salvo em ${dest}.`)
    } catch (e) { setBackupError(`Não foi possível exportar o backup: ${errText(e)}`) }
    setBusy(false)
  }

  const validar = async (path: string) => {
    let source: Db
    try { source = await openDb(`sqlite:${path}`) } catch { throw new BackupError('Este arquivo não é um backup do Yield.') }
    try { await validateBackup(source) } finally { await source.close() }
    setRestore(path)
  }

  const escolherBackup = async () => {
    resetBackup()
    try {
      const path = await open({ multiple: false, directory: false, filters: BACKUP_FILTER })
      if (!path) return
      if (await invoke<boolean>('is_encrypted_backup', { path })) setImportPw({ path, password: '' })
      else await validar(path)
    } catch (e) { setBackupError(e instanceof BackupError ? e.message : `Não foi possível ler o backup: ${errText(e)}`) }
  }

  const abrirComSenha = async () => {
    if (!importPw) return
    setBusy(true); setBackupError(null)
    try {
      await validar(await invoke<string>('decrypt_backup', { from: importPw.path, password: importPw.password }))
      setImportPw(null)
    } catch (e) { setBackupError(e instanceof BackupError ? e.message : errText(e)) }
    setBusy(false)
  }

  const substituir = async () => {
    if (!restore) return
    setBusy(true)
    const r = await restoreBackup({
      checkpoint: async () => { await db.execute('PRAGMA wal_checkpoint(TRUNCATE)') },
      close: () => db.close(),
      swap: () => invoke<string>('swap_database', { source: restore }),
      // `load` do plugin sempre cria um pool novo e substitui o fechado no mapa pelo mesmo nome
      // ('sqlite:yield.db'); o `db` do DataProvider resolve o pool por esse nome, então passa a ler o arquivo novo.
      reopen: async () => { await openDb() },
      reload,
    })
    if (r.ok) setBackupMsg(r.message)
    else setBackupError(r.message)
    setRestore(null); setBusy(false)
  }

  const yahooTimes = data.quotes.filter(q => q.source === 'yahoo').map(q => q.fetchedAt).sort()
  const lastQuote = yahooTimes[yahooTimes.length - 1]

  return (
    <>
      <h1>Configurações</h1>
      <div className="muted">Tudo fica neste computador. Saem da máquina só as cotações do Yahoo e a leitura dos seus bancos na Pluggy.</div>
      <div className="grid2" style={{ marginTop: 14 }}>
        <ImportarOrcamento />

        <div className="card">
          <b style={{ color: '#fff' }}>Importar da B3</b>
          <div className="muted" style={{ margin: '4px 0 10px' }}>Relatórios de Negociação, Proventos Recebidos e Movimentação (.xlsx) da Área do Investidor. Dá para escolher vários de uma vez; o que já existe é pulado.</div>
          {b3.button('Escolher arquivos…', 'b pri')}
          {b3.panel}
        </div>

        <div className="card">
          <b style={{ color: '#fff' }}>Backup</b>
          <div className="muted" style={{ margin: '4px 0 10px' }}>Um arquivo .yield com todos os seus dados, criptografado com uma senha sua (AES-256)</div>
          <div className="btns">
            <button className="b" disabled={busy} onClick={() => { resetBackup(); setExportPw({ password: '', confirm: '' }) }}>Exportar backup…</button>
            <button className="b" disabled={busy} onClick={() => void escolherBackup()}>Importar backup…</button>
          </div>
          {exportPw && (
            <div className="info" style={{ marginTop: 10 }}>
              Escolha uma senha para o backup. <b>Sem ela não dá para abrir o arquivo</b>: nem o Yield consegue recuperar.
              <div className="row" style={{ marginTop: 8 }}>
                <input className="in" type="password" autoComplete="new-password" placeholder="senha" aria-label="Senha do backup" value={exportPw.password} onChange={e => setExportPw({ ...exportPw, password: e.target.value })} />
                <input className="in" type="password" autoComplete="new-password" placeholder="repita a senha" aria-label="Repita a senha" value={exportPw.confirm} onChange={e => setExportPw({ ...exportPw, confirm: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') void exportar() }} />
              </div>
              <div className="btns" style={{ marginTop: 8 }}>
                <button className="b" disabled={busy} onClick={() => resetBackup()}>Cancelar</button>
                <button className="b pri" disabled={busy} onClick={() => void exportar()}>{busy ? 'Salvando…' : 'Escolher onde salvar…'}</button>
              </div>
            </div>
          )}
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
                <button className="b" disabled={busy} onClick={() => setRestore(null)}>Cancelar</button>
                <button className="b pri" disabled={busy} onClick={() => void substituir()}>{busy ? 'Substituindo…' : 'Substituir dados'}</button>
              </div>
            </div>
          )}
          {backupError && <div className="note" style={{ marginTop: 10 }}>{backupError}</div>}
          {backupMsg && <div className="info" style={{ marginTop: 10 }}>{backupMsg}</div>}
        </div>

        <div className="card">
          <b style={{ color: '#fff' }}>Cotações</b>
          <div className="muted" style={{ margin: '4px 0 10px' }}>Yahoo Finance, atraso de ~15 min</div>
          <div className="row"><span className="t2">Atualiza a cada 15 min</span><button className="b ghost" disabled={refreshing} onClick={() => void refreshQuotesNow()}>{refreshing ? 'Atualizando…' : '↻ Atualizar agora'}</button></div>
          <div className="muted" style={{ marginTop: 8 }}>
            Última: {lastRefresh ? `${dayTime(lastRefresh.at)} · ${refreshLine(lastRefresh)}` : lastQuote ? dayTime(lastQuote) : 'nenhuma ainda'}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}><FontesRenda /></div>
      <OpenFinance />
      <Contas />
    </>
  )
}
