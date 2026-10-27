import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useEffect, useState } from 'react'
import { deleteAccount, deletePluggyItem, savePluggyItem, type Account } from '../../db/gastosRepo'
import { createPluggyClient, PluggyError } from '../../openfinance/pluggy'
import { clearPluggyCredentials, getPluggyCredentials, setPluggyCredentials } from '../../openfinance/secrets'
import { useData } from '../../state/DataProvider'
import { errText } from '../lancamentos/GastosHeader'
import { parseItemId } from './build'
import { PluggyGuia } from './PluggyGuia'

const short = (id: string) => `${id.slice(0, 4)}…${id.slice(-4)}`
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

type Status = { ok: boolean; text: string }

export function OpenFinance() {
  const { db, reload, gastos: { data, syncNow, syncing, lastSyncResult } } = useData()
  const [saved, setSaved] = useState<boolean | null>(null) // só presença: o secret nunca entra no estado
  const [editing, setEditing] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [confirm, setConfirm] = useState<'apagar-creds' | { itemId: string; label: string } | null>(null)
  const [name, setName] = useState('')
  const [itemText, setItemText] = useState('')
  const [tests, setTests] = useState<Record<string, Status> | null>(null)
  const [testing, setTesting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guide, setGuide] = useState(false)

  useEffect(() => {
    getPluggyCredentials().then(c => setSaved(c !== null), () => setSaved(false))
  }, [])

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn(); setError(null) } catch (e) { setError(`${what}: ${errText(e)}`) }
    setBusy(false)
  }

  const saveCreds = () => run('Não foi possível salvar', async () => {
    await setPluggyCredentials(clientId, clientSecret)
    setClientId(''); setClientSecret(''); setEditing(false); setSaved(true)
  })
  const clearCreds = () => run('Não foi possível apagar', async () => {
    await clearPluggyCredentials()
    setSaved(false); setConfirm(null)
  })
  const addItem = () => run('Não foi possível adicionar', async () => {
    const label = name.trim()
    if (!label) throw new Error('Dê um nome para o banco')
    await savePluggyItem(db, parseItemId(itemText), label)
    await reload()
    setName(''); setItemText('')
  })
  const removeItem = (itemId: string) => run('Não foi possível tirar', async () => {
    await deletePluggyItem(db, itemId)
    await reload()
    setConfirm(null)
  })

  const test = async () => {
    setTesting(true); setError(null)
    const creds = await getPluggyCredentials().catch(() => null)
    if (!creds) { setError('Salve o Client ID e o Client Secret primeiro'); setTesting(false); return }
    const client = createPluggyClient(creds, tauriFetch as typeof fetch)
    const out: Record<string, Status> = {}
    for (const it of data.pluggyItems) {
      try { out[it.itemId] = { ok: true, text: plural((await client.listAccounts(it.itemId)).length, 'conta', 'contas') } }
      catch (e) { out[it.itemId] = { ok: false, text: e instanceof PluggyError ? e.message : errText(e) } }
    }
    setTests(out); setTesting(false)
  }

  const status = (itemId: string): Status | null => {
    if (tests?.[itemId]) return tests[itemId]
    const err = lastSyncResult?.errors.find(e => e.itemId === itemId)
    return err ? { ok: false, text: err.message } : null
  }

  const generalErrors = lastSyncResult?.errors.filter(e => !e.itemId) ?? []
  const credsForm = saved === false || editing
  const confirmItem = typeof confirm === 'object' && confirm ? confirm : null

  const credentials = saved === null ? null : credsForm ? (
    <div className="field">
      <label className="field"><span>Client ID</span><input className="in" autoComplete="off" value={clientId} onChange={e => setClientId(e.target.value)} /></label>
      <label className="field" style={{ marginTop: 6 }}><span>Client Secret</span><input className="in" type="password" autoComplete="off" value={clientSecret} onChange={e => setClientSecret(e.target.value)} /></label>
      <div className="btns" style={{ marginTop: 6 }}>
        <button className="b pri" disabled={busy} onClick={() => void saveCreds()}>Salvar no cofre</button>
        {editing && <button className="b" disabled={busy} onClick={() => { setEditing(false); setClientId(''); setClientSecret('') }}>Cancelar</button>}
      </div>
      {guide && error && <div className="note" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  ) : (
    <>
      <div className="row" style={{ alignItems: 'center' }}>
        <span className="t2">Client ID e Client Secret salvos no cofre do sistema</span>
        <button className="b ghost" disabled={busy} onClick={() => setEditing(true)}>Trocar</button>
        <button className="b ghost" disabled={busy} style={{ color: 'var(--negative)' }} onClick={() => setConfirm('apagar-creds')}>Apagar</button>
      </div>
      {confirm === 'apagar-creds' && (
        <div className="note" style={{ marginTop: 8 }}>
          Apagar o Client ID e o Client Secret do cofre? Sem eles o Yield não consegue sincronizar.
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="b" disabled={busy} onClick={() => setConfirm(null)}>Cancelar</button>
            <button className="b pri" disabled={busy} onClick={() => void clearCreds()}>Apagar</button>
          </div>
        </div>
      )}
    </>
  )

  const banks = data.pluggyItems.length > 0 && (
    <table>
      <thead><tr><th>Banco</th><th>itemId</th><th>Situação</th><th></th></tr></thead>
      <tbody>
        {data.pluggyItems.map(it => {
          const s = status(it.itemId)
          return (
            <tr key={it.itemId}>
              <td>{it.label}</td><td className="t2">{short(it.itemId)}</td>
              <td>{s ? <span className={`pill ${s.ok ? 'ok' : 'bad'}`}>{s.text}</span> : <span className="muted">—</span>}</td>
              <td><button className="b ghost" disabled={busy} onClick={() => setConfirm(it)}>tirar</button></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  const addBank = (
    <>
      <div className="row">
        <input className="in" style={{ width: 120 }} placeholder="nome do banco" aria-label="Nome do banco" value={name} onChange={e => setName(e.target.value)} />
        <input className="in" style={{ flex: 1, minWidth: 200 }} placeholder="cole o itemId" aria-label="itemId" value={itemText} onChange={e => setItemText(e.target.value)} />
        <button className="b pri" disabled={busy} onClick={() => void addItem()}>Adicionar</button>
      </div>
      {error && <div className="note" style={{ marginTop: 8 }}>{error}</div>}
      {data.pluggyItems.length > 0 && <div style={{ marginTop: 8 }}>{banks}</div>}
      {data.pluggyItems.length > 0 && (
        <button className="b" style={{ marginTop: 8 }} disabled={testing || busy} onClick={() => void test()}>{testing ? 'Testando…' : 'Testar conexão'}</button>
      )}
    </>
  )

  const configured = saved === true || data.pluggyItems.length > 0
  const done = [false, false, false, false, saved === true, data.pluggyItems.length > 0]

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="bar">
        <b style={{ color: '#fff' }}>Open Finance (Pluggy + Meu Pluggy)</b>
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="pill ok">{plural(data.pluggyItems.length, 'banco conectado', 'bancos conectados')}</span>
          {configured && <button className="b" onClick={() => setGuide(true)}>Passo a passo</button>}
        </div>
      </div>
      <div className="info" style={{ marginTop: 8 }}><b>O Yield só lê seus dados: não move dinheiro nem inicia pagamentos.</b> Ele só lista contas e transações.</div>
      {!configured ? (
        <div style={{ marginTop: 10 }}>
          <div className="t2" style={{ marginBottom: 8 }}>Traga contas e cartões automaticamente, de graça, pelo Meu Pluggy. Leva uns 15 minutos, uma vez só.</div>
          <button className="b pri" onClick={() => setGuide(true)}>Conectar bancos</button>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          {credentials}
          <div style={{ marginTop: 10 }}>{banks}</div>
          {confirmItem && (
            <div className="note" style={{ marginTop: 8 }}>
              Tirar {confirmItem.label}? As contas e os lançamentos já baixados continuam no Yield; só deixa de sincronizar.
              <div className="btns" style={{ marginTop: 8 }}>
                <button className="b" disabled={busy} onClick={() => setConfirm(null)}>Cancelar</button>
                <button className="b pri" disabled={busy} onClick={() => void removeItem(confirmItem.itemId)}>Tirar</button>
              </div>
            </div>
          )}
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="b ghost" onClick={() => setGuide(true)}>+ Adicionar banco</button>
            <button className="b" disabled={testing || busy} onClick={() => void test()}>{testing ? 'Testando…' : 'Testar conexão'}</button>
            <button className="b pri" disabled={syncing} onClick={() => void syncNow()}>{syncing ? 'Sincronizando…' : '↻ Sincronizar agora'}</button>
          </div>
          {!guide && error && <div className="note" style={{ marginTop: 8 }}>{error}</div>}
          {generalErrors.map(e => <div key={e.message} className="note" style={{ marginTop: 8 }}>{e.message}</div>)}
          {lastSyncResult && !syncing && lastSyncResult.errors.length === 0 && (
            <div className="info" style={{ marginTop: 8 }}>Sincronizado: {plural(lastSyncResult.accounts, 'conta', 'contas')}, {plural(lastSyncResult.inserted, 'lançamento novo', 'lançamentos novos')}.</div>
          )}
          <div className="muted" style={{ marginTop: 8 }}>Sincroniza sozinho ao abrir o Yield (se passaram mais de 6 h). Os bancos atualizam no Meu Pluggy uma vez por dia.</div>
        </div>
      )}
      {guide && (
        <PluggyGuia start={saved ? 5 : 0} done={done} credentials={credentials} addBank={addBank} onClose={() => { setGuide(false); setError(null) }} />
      )}
    </div>
  )
}

export function Contas() {
  const { db, reload, gastos: { data } } = useData()
  const [del, setDel] = useState<Account | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const count = (id: string) => data.txns.filter(t => t.accountId === id).length

  const apagar = async (a: Account) => {
    setBusy(true)
    try { await deleteAccount(db, a.id); await reload(); setDel(null); setError(null) }
    catch (e) { setError(`Não foi possível apagar a conta: ${errText(e)}`) }
    setBusy(false)
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <b style={{ color: '#fff' }}>Contas</b>
      <div className="muted" style={{ margin: '4px 0 10px' }}>Contas e cartões trazidos da Pluggy ou de extratos. Apague uma conta repetida para o saldo não contar em dobro.</div>
      {data.accounts.length === 0 ? <div className="muted">Nenhuma conta ainda.</div> : (
        <table>
          <thead><tr><th>Instituição</th><th>Conta</th><th>Origem</th><th>Lançamentos</th><th></th></tr></thead>
          <tbody>
            {data.accounts.map(a => (
              <tr key={a.id}>
                <td>{a.institution}</td>
                <td>{a.name}{a.number ? <span className="t2"> ···{a.number.replace(/\D/g, '').slice(-4)}</span> : null}</td>
                <td className="t2">{a.source === 'pluggy' ? 'Pluggy' : 'extrato'}</td>
                <td className="t2">{count(a.id)}</td>
                <td><button className="b ghost" disabled={busy} onClick={() => setDel(a)}>apagar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {del && (
        <div className="note" style={{ marginTop: 10 }}>
          Apagar a conta {del.name}? Os {count(del.id)} lançamentos dela também serão apagados.
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="b" disabled={busy} onClick={() => setDel(null)}>Cancelar</button>
            <button className="b pri" disabled={busy} onClick={() => void apagar(del)}>Apagar</button>
          </div>
        </div>
      )}
      {error && <div className="note" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  )
}
