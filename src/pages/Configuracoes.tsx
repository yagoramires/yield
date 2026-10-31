import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import { BackupError, stageBackup } from '../db/backup'
import { openDb } from '../db/client'
import { migrateOnce } from '../db/migrate'
import { MIGRATIONS } from '../db/migrations'
import { renormalizeBrokers } from '../db/repo'
import { repairCryptoSymbols } from '../quotes/yahoo'
import { useData } from '../state/DataProvider'
import { useProfiles } from '../profiles/Gate'
import { refreshLine, restoreBackup } from './configuracoes/build'
import { BackupExport } from './configuracoes/BackupExport'
import { AtualizacaoCard } from '../ui/Atualizacao'
import { FontesRenda, ImportarOrcamento } from './configuracoes/OrcamentoConfig'
import { Contas, OpenFinance } from './configuracoes/OpenFinance'
import { Binance } from './configuracoes/Binance'
import { Proventos } from './configuracoes/Proventos'
import { Modulos } from './configuracoes/Modulos'
import { Aparencia } from './configuracoes/Aparencia'
import { IaLocal } from './configuracoes/IaLocal'
import { Perfil } from './configuracoes/Perfil'
import { useB3Import } from './configuracoes/useB3Import'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const dayTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const BACKUP_FILTER = [{ name: 'Backup do Yield', extensions: ['yield', 'db'] }] // .db: backups antigos, sem senha

export function Configuracoes() {
  const { data, db, reload, refreshing, refreshQuotesNow, lastRefresh } = useData()
  const { dbFile } = useProfiles().profile
  const b3 = useB3Import()
  const [busy, setBusy] = useState(false) // backup em troca
  const [restore, setRestore] = useState(false) // backup já validado no restore.db, esperando confirmação
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false) // pedindo a senha do novo backup
  const [importPw, setImportPw] = useState<{ path: string; password: string } | null>(null) // backup com senha escolhido

  // restore.db é o backup já aberto: não fica no disco se a importação não for até o fim
  const discardRestore = () => { invoke('discard_restore').catch(() => {}) }
  useEffect(() => () => discardRestore(), []) // saiu da tela com a importação pendente
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
    const r = await restoreBackup({
      checkpoint: async () => { await db.execute('PRAGMA wal_checkpoint(TRUNCATE)') },
      close: () => db.close(),
      swap: async () => (await invoke<string | null>('swap_database')) ?? '',
      // `db_load` cria um pool novo e o põe no mapa pelo nome do arquivo do perfil;
      // o `db` do DataProvider resolve o pool por esse nome, então passa a ler o arquivo novo.
      // backup de versão antiga (ou de outro perfil) sobe para a versão do app pelo `migrate`, em qualquer perfil
      reopen: async () => { const d = await openDb(dbFile); await migrateOnce(dbFile, d, MIGRATIONS); await renormalizeBrokers(d); await repairCryptoSymbols(d) },
      reload,
    })
    if (r.ok) setBackupMsg(r.message)
    else { setBackupError(r.message); discardRestore() }
    setRestore(false); setBusy(false)
  }

  const yahooTimes = data.quotes.filter(q => q.source === 'yahoo').map(q => q.fetchedAt).sort()
  const lastQuote = yahooTimes[yahooTimes.length - 1]

  return (
    <>
      <h1>Configurações</h1>
      <div className="muted">Tudo fica neste computador. O app só fala com o Yahoo Finance (cotações), o Banco Central em api.bcb.gov.br (CDI), a Pluggy em api.pluggy.ai (leitura dos seus bancos), a Binance em api.binance.com (saldos de cripto) e o GitHub (atualizações do app).</div>
      <Perfil />
      <div className="grid2" style={{ marginTop: 14 }}>
        <ImportarOrcamento />

        <div className="card">
          <b style={{ color: 'var(--strong)' }}>Importar da B3</b>
          <div className="muted" style={{ margin: '4px 0 10px' }}>Relatórios de Negociação, Proventos Recebidos, Movimentação e Posição (.xlsx) da Área do Investidor; a Posição também preenche o cadastro de empresas do IR. Dá para escolher vários de uma vez; o que já existe é pulado.</div>
          {b3.button('Escolher arquivos…', 'b pri')}
          {b3.panel}
        </div>

        <div className="card">
          <b style={{ color: 'var(--strong)' }}>Backup</b>
          <div className="muted" style={{ margin: '4px 0 10px' }}>Um arquivo .yield com todos os seus dados, criptografado com uma senha sua (AES-256)</div>
          <div className="btns">
            <button className="b" disabled={busy} onClick={() => { resetBackup(); setExporting(true) }}>Exportar backup…</button>
            <button className="b" disabled={busy} onClick={() => void escolherBackup()}>Importar backup…</button>
          </div>
          {exporting && <BackupExport onDone={m => { setExporting(false); setBackupMsg(m) }} onCancel={resetBackup} />}
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

        <div className="card">
          <b style={{ color: 'var(--strong)' }}>Cotações</b>
          <div className="muted" style={{ margin: '4px 0 10px' }}>Yahoo Finance, atraso de ~15 min</div>
          <div className="row"><span className="t2">Atualiza a cada 15 min</span><button className="b ghost" disabled={refreshing} onClick={() => void refreshQuotesNow()}>{refreshing ? 'Atualizando…' : '↻ Atualizar agora'}</button></div>
          <div className="muted" style={{ marginTop: 8 }}>
            Última: {lastRefresh ? `${dayTime(lastRefresh.at)} · ${refreshLine(lastRefresh)}` : lastQuote ? dayTime(lastQuote) : 'nenhuma ainda'}
          </div>
        </div>
        <AtualizacaoCard />
      </div>
      <div style={{ marginTop: 12 }}><FontesRenda /></div>
      <Aparencia />
      <Modulos />
      <Proventos />
      <OpenFinance />
      <Binance />
      <IaLocal />
      <Contas />
    </>
  )
}
