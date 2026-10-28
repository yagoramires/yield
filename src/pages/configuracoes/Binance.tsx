import { useEffect, useState } from 'react'
import { clearBinanceCredentials, getBinanceCredentials, setBinanceCredentials } from '../../cripto/secrets'
import { saveCryptoBalances } from '../../db/rendaFixaRepo'
import { useData } from '../../state/DataProvider'
import { errText } from '../lancamentos/GastosHeader'

/** Chave só de leitura da Binance, guardada no Keychain; o segredo só fica na tela enquanto é digitado. */
export function Binance() {
  const { db, reload, binance, refreshQuotesNow } = useData()
  const [saved, setSaved] = useState<boolean | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [secret, setSecret] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { getBinanceCredentials().then(c => setSaved(c !== null), () => setSaved(false)) }, [])

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn(); setError(null) } catch (e) { setError(`${what}: ${errText(e)}`) }
    setBusy(false)
  }
  const save = () => run('Não foi possível salvar', async () => {
    await setBinanceCredentials(apiKey, secret)
    setApiKey(''); setSecret(''); setSaved(true)
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
      <h5 style={{ margin: 0 }}>Binance <span className="muted">· saldos de cripto, só leitura</span></h5>
      <ol className="muted" style={{ margin: '8px 0', paddingLeft: 18 }}>
        <li>No site da Binance, abra <b>Gerenciamento de API</b> e crie uma chave do tipo gerada pelo sistema.</li>
        <li>Deixe ligado <b>só “Enable Reading”</b>. Nada de trade, saque ou transferência. Restringir por IP é opcional.</li>
        <li>Cole a API Key e a Secret Key aqui. Elas ficam no Keychain do Mac; o Yield só lê saldos e recusa qualquer outra chamada.</li>
      </ol>
      {saved === null ? null : saved ? (
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <span>Chave salva</span>
          {confirm ? (
            <span>Remover a chave da Binance? Os saldos saem do patrimônio. <button className="link dn" disabled={busy} onClick={() => void remove()}>Remover</button> <button className="link" onClick={() => setConfirm(false)}>Cancelar</button></span>
          ) : <button className="link" onClick={() => setConfirm(true)}>Remover chave</button>}
        </div>
      ) : (
        <div className="field">
          <label className="field"><span>API Key</span><input className="in" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} /></label>
          <label className="field" style={{ marginTop: 6 }}><span>Secret Key</span><input className="in" type="password" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} /></label>
          <div className="btns" style={{ marginTop: 6 }}><button className="b pri" disabled={busy} onClick={() => void save()}>Salvar e ler saldos</button></div>
        </div>
      )}
      {error && <div className="note" style={{ marginTop: 8 }}>{error}</div>}
      {binance.error && saved && <div className="note" style={{ marginTop: 8 }}>{binance.error}</div>}
    </div>
  )
}
