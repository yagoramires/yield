import { useEffect, useState } from 'react'
import { clearBinanceCredentials, setBinanceCredentials } from '../../cripto/secrets'
import { vaultStatus } from '../../secrets/vault'
import { saveCryptoBalances } from '../../db/rendaFixaRepo'
import { useData } from '../../state/DataProvider'
import { errText } from '../lancamentos/GastosHeader'

/** Chave só de leitura da Binance, guardada no cofre do sistema; o segredo só fica na tela enquanto é digitado. */
export function Binance() {
  const { db, reload, binance, refreshQuotesNow } = useData()
  const [saved, setSaved] = useState<boolean | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [secret, setSecret] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [connecting, setConnecting] = useState(false) // instruções e campos só depois de "Conectar"
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { vaultStatus().then(s => setSaved(s.binance), () => setSaved(false)) }, [])

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn(); setError(null) } catch (e) { setError(`${what}: ${errText(e)}`) }
    setBusy(false)
  }
  const save = () => run('Não foi possível salvar', async () => {
    await setBinanceCredentials(apiKey, secret)
    setApiKey(''); setSecret(''); setSaved(true); setConnecting(false)
    await binance.syncNow(); await refreshQuotesNow()
  })
  // os saldos zeram (somem do patrimônio), mas o aportado digitado fica guardado para quando a chave voltar
  const remove = () => run('Não foi possível remover', async () => {
    await clearBinanceCredentials(); await saveCryptoBalances(db, [], new Date().toISOString()); await reload()
    binance.reset()
    setSaved(false); setConfirm(false)
  })

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h5 style={{ margin: 0 }}>Cripto <span className="muted">· saldos, só leitura</span></h5>
      <div className="conn-list" style={{ marginTop: 8 }}>
        <div className="conn-row">
          <span className="conn-logo" aria-hidden>B</span>
          <div className="grow">
            <b>Binance</b>
            <div className={saved && binance.error ? 'conn-err' : 'muted'}>{saved === null ? '…' : saved ? binance.error ?? 'Chave salva no cofre do sistema' : 'Não conectada'}</div>
          </div>
          {saved && (binance.error ? <span className="pill bad">erro</span> : <span className="pill ok">ok</span>)}
          {saved && !confirm && <button className="b ghost sm" onClick={() => setConfirm(true)}>Remover chave</button>}
          {saved === false && !connecting && <button className="b sm" onClick={() => setConnecting(true)}>Conectar</button>}
        </div>
      </div>
      {saved && confirm && (
        <div className="note" style={{ marginTop: 8 }}>
          Remover a chave da Binance? Os saldos saem do patrimônio.
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="b" disabled={busy} onClick={() => setConfirm(false)}>Cancelar</button>
            <button className="b pri" disabled={busy} onClick={() => void remove()}>Remover</button>
          </div>
        </div>
      )}
      {saved === false && connecting && <>
        <ol className="muted" style={{ margin: '10px 0 8px', paddingLeft: 18 }}>
          <li>No site da Binance, abra <b>Gerenciamento de API</b> e crie uma chave do tipo gerada pelo sistema.</li>
          <li>Deixe ligado <b>só “Enable Reading”</b>. Nada de trade, saque ou transferência. Restringir por IP é opcional.</li>
          <li>Cole a API Key e a Secret Key aqui. Elas ficam no cofre do sistema (Keychain no Mac, Gerenciador de Credenciais no Windows); o Yield só lê saldos e recusa qualquer outra chamada.</li>
        </ol>
        <div className="field">
          <label className="field"><span>API Key</span><input className="in" autoComplete="off" autoFocus value={apiKey} onChange={e => setApiKey(e.target.value)} /></label>
          <label className="field" style={{ marginTop: 6 }}><span>Secret Key</span><input className="in" type="password" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} /></label>
          <div className="btns" style={{ marginTop: 6 }}>
            <button className="b" disabled={busy} onClick={() => { setConnecting(false); setApiKey(''); setSecret('') }}>Cancelar</button>
            <button className="b pri" disabled={busy} onClick={() => void save()}>Salvar e ler saldos</button>
          </div>
        </div>
      </>}
      {error && <div className="note" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  )
}
