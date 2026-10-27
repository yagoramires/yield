import { invoke } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { open, save } from '@tauri-apps/plugin-dialog'
import { useState } from 'react'
import { BackupError, exportBackup, validateBackup } from '../db/backup'
import { openDb, type Db } from '../db/client'
import { useData } from '../state/DataProvider'
import { refreshLine, restoreBackup } from './configuracoes/build'
import { FontesRenda, ImportarOrcamento } from './configuracoes/OrcamentoConfig'
import { Contas, OpenFinance } from './configuracoes/OpenFinance'
import { useB3Import } from './configuracoes/useB3Import'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dayTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const BACKUP_FILTER = [{ name: 'Backup do Yield', extensions: ['db'] }]

export function Configuracoes() {
  const { data, db, reload, refreshing, refreshQuotesNow, lastRefresh } = useData()
  const b3 = useB3Import()
  const [busy, setBusy] = useState(false) // backup em troca
  const [restore, setRestore] = useState<string | null>(null) // caminho do backup já validado, esperando confirmação
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)

  const resetBackup = () => { setBackupMsg(null); setBackupError(null); setRestore(null) }

  const exportar = async () => {
    resetBackup()
    try {
      const dest = await save({ defaultPath: `yield-backup-${today()}.db`, filters: BACKUP_FILTER })
      if (!dest) return
      // VACUUM INTO falha se o arquivo já existe: nome único por exportação
      const tmp = await join(await appDataDir(), `export-${Date.now()}.db`)
      await exportBackup(db, tmp, dest, (from, to) => invoke('move_file', { from, to }))
      setBackupMsg(`Backup salvo em ${dest}.`)
    } catch (e) { setBackupError(`Não foi possível exportar o backup: ${errText(e)}`) }
  }

  const escolherBackup = async () => {
    resetBackup()
    try {
      const path = await open({ multiple: false, directory: false, filters: BACKUP_FILTER })
      if (!path) return
      let source: Db
      try { source = await openDb(`sqlite:${path}`) } catch { throw new BackupError('Este arquivo não é um backup do Yield.') }
      try { await validateBackup(source) } finally { await source.close() }
      setRestore(path)
    } catch (e) { setBackupError(e instanceof BackupError ? e.message : `Não foi possível ler o backup: ${errText(e)}`) }
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
          <div className="muted" style={{ margin: '4px 0 10px' }}>Um arquivo .db com todos os seus dados</div>
          <div className="btns">
            <button className="b" disabled={busy} onClick={() => void exportar()}>Exportar backup…</button>
            <button className="b" disabled={busy} onClick={() => void escolherBackup()}>Importar backup…</button>
          </div>
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
