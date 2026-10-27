import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { useEffect, useState } from 'react'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Procura versão nova nas Releases do GitHub (assinada; a chave pública está no tauri.conf.json). */
export function useUpdate(auto: boolean) {
  const [version, setVersion] = useState<string | null>(null)
  const [update, setUpdate] = useState<Update | null>(null)
  const [state, setState] = useState<{ checking?: boolean; progress?: number; error?: string; upToDate?: boolean }>({})

  const procurar = async (manual: boolean) => {
    setState({ checking: true })
    try {
      const u = await check()
      setUpdate(u)
      setState({ upToDate: !u })
    } catch (e) {
      setState(manual ? { error: `Não foi possível procurar atualização: ${errText(e)}` } : {}) // sem internet ao abrir: fica quieto
    }
  }

  const instalar = async () => {
    if (!update) return
    let total = 0, got = 0
    setState({ progress: 0 })
    try {
      await update.downloadAndInstall(ev => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0
        else if (ev.event === 'Progress') { got += ev.data.chunkLength; setState({ progress: total ? Math.round((got / total) * 100) : 0 }) }
      })
      await relaunch()
    } catch (e) { setState({ error: `Não foi possível atualizar: ${errText(e)}` }) }
  }

  useEffect(() => {
    void getVersion().then(setVersion, () => {})
    if (auto) void procurar(false)
  }, [auto])

  return { version, update, state, procurar, instalar }
}

/** Faixa no topo quando há versão nova; some com "Depois" até o próximo início. */
export function UpdateBanner() {
  const { update, state, instalar } = useUpdate(true)
  const [later, setLater] = useState(false)
  if (!update || later) return null
  const installing = state.progress !== undefined
  return (
    <div className="info update-banner" role="status">
      <span><b style={{ color: '#fff' }}>Yield {update.version} disponível.</b> {installing ? `Baixando… ${state.progress}%` : 'Atualiza e reinicia em segundos; seus dados ficam.'}</span>
      {state.error && <span className="warn">{state.error}</span>}
      <span className="btns">
        {!installing && <button className="b ghost" onClick={() => setLater(true)}>Depois</button>}
        <button className="b pri" disabled={installing} onClick={() => void instalar()}>{installing ? 'Atualizando…' : 'Atualizar e reiniciar'}</button>
      </span>
    </div>
  )
}

/** Cartão de Configurações: versão atual e busca manual. */
export function AtualizacaoCard() {
  const { version, update, state, procurar, instalar } = useUpdate(false)
  const installing = state.progress !== undefined
  return (
    <div className="card">
      <b style={{ color: '#fff' }}>Atualizações</b>
      <div className="muted" style={{ margin: '4px 0 10px' }}>Versão {version ?? '…'}. O Yield procura versão nova ao abrir e avisa no topo.</div>
      <div className="btns">
        {update
          ? <button className="b pri" disabled={installing} onClick={() => void instalar()}>{installing ? `Baixando… ${state.progress}%` : `Atualizar para ${update.version}`}</button>
          : <button className="b" disabled={state.checking} onClick={() => void procurar(true)}>{state.checking ? 'Procurando…' : 'Procurar atualização'}</button>}
      </div>
      {state.upToDate && <div className="muted" style={{ marginTop: 8 }}>Você está na versão mais recente.</div>}
      {state.error && <div className="note" style={{ marginTop: 8 }}>{state.error}</div>}
    </div>
  )
}
