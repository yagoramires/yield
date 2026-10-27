import { invoke } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { open, save } from '@tauri-apps/plugin-dialog'
import { useRef, useState } from 'react'
import { BackupError, exportBackup, validateBackup } from '../db/backup'
import { openDb, type Db } from '../db/client'
import { importPlanilha, parsePlanilha } from '../import/planilha'
import { useData } from '../state/DataProvider'
import { planilhaSummary, refreshLine, restoreBackup } from './configuracoes/build'
import { Contas, OpenFinance } from './configuracoes/OpenFinance'
import { useB3Import } from './configuracoes/useB3Import'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const brDay = (iso: string) => iso.split('-').reverse().join('/')
const dayTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const BACKUP_FILTER = [{ name: 'Backup do Yield', extensions: ['db'] }]

export function Configuracoes() {
  const { data, db, reload, refreshing, refreshQuotesNow, lastRefresh } = useData()
  const b3 = useB3Import()
  const planilhaInput = useRef<HTMLInputElement>(null)
  const [planilha, setPlanilha] = useState<ReturnType<typeof planilhaSummary> | null>(null)
  const [planilhaError, setPlanilhaError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false) // backup em troca
  const [restore, setRestore] = useState<string | null>(null) // caminho do backup já validado, esperando confirmação
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)

  const importFile = async (file: File) => {
    setImporting(true); setPlanilha(null); setPlanilhaError(null)
    try {
      const p = parsePlanilha(await file.arrayBuffer())
      setPlanilha(planilhaSummary(await importPlanilha(db, p), p))
    } catch (e) { setPlanilhaError(`Não foi possível importar ${file.name}: ${errText(e)}`) }
    try { await reload() } catch (e) { setPlanilhaError(`Não foi possível recarregar os dados: ${errText(e)}`) }
    setImporting(false)
  }

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
        <div className="card">
          <b style={{ color: '#fff' }}>Importar planilha antiga</b>
          <div className="muted" style={{ margin: '4px 0 10px' }}>Controle de Investimentos.xlsm · pode importar de novo: o que já existe é pulado</div>
          <button className="b pri" disabled={importing || busy} onClick={() => planilhaInput.current?.click()}>Escolher arquivo…</button>
          <input ref={planilhaInput} type="file" accept=".xlsm,.xlsx" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />
          {importing && <span className="muted"> Importando…</span>}
          {planilhaError && <div className="note" style={{ marginTop: 10 }}>{planilhaError}</div>}
          {planilha && (
            <div className="info" style={{ marginTop: 10 }}>
              Última importação ({brDay(today())})<br />{planilha.counts}
              {planilha.warnings.length > 0 && <><br /><span className="warn">Avisos:</span> {planilha.warnings.join(' · ')}</>}
            </div>
          )}
        </div>

        <div className="card">
          <b style={{ color: '#fff' }}>Importar extrato da B3</b>
          <div className="muted" style={{ margin: '4px 0 10px' }}>Movimentação (.xlsx) baixada da Área do Investidor</div>
          {b3.button('Escolher arquivo…', 'b pri')}
          {b3.panel}
        </div>

        <div className="card">
          <b style={{ color: '#fff' }}>Backup</b>
          <div className="muted" style={{ margin: '4px 0 10px' }}>Um arquivo .db com todos os seus dados</div>
          <div className="btns">
            <button className="b" disabled={busy || importing} onClick={() => void exportar()}>Exportar backup…</button>
            <button className="b" disabled={busy || importing} onClick={() => void escolherBackup()}>Importar backup…</button>
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
      <OpenFinance />
      <Contas />
    </>
  )
}
