import { invoke } from '@tauri-apps/api/core'
import { Download, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { gb, machineLabel, pickModel, type CatalogModel, type Hardware } from '../../ai/catalog'
import { calibrate } from '../../ai/llm'
import { ensureServer, tauriPost } from '../../ai/server'
import { setAiSettings } from '../../ai/settings'
import { errText } from '../lancamentos/GastosHeader'

type Progress = { received: number; total: number }
// o andamento do download vem do Rust (sobrevive a sair da tela); aqui fica só o que acontece depois dele e o erro
type Dl = { ligando: boolean; error: string | null }
let dl: Dl = { ligando: false, error: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<Dl>) => { dl = { ...dl, ...patch }; listeners.forEach(l => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** Primeiro uso: mostra a máquina e o modelo que cabe nela, baixa, liga e mede a velocidade. */
export function Ativar({ hw, target, onReady }: { hw: Hardware; target: CatalogModel | null; onReady(): void }) {
  const pick = pickModel(hw)
  const model = target ?? ('model' in pick ? pick.model : null)
  const { ligando, error } = useSyncExternalStore(subscribe, () => dl)
  const [prog, setProg] = useState<Progress | null>(null)
  const ready = useRef(onReady)
  ready.current = onReady
  // pergunta ao Rust a cada segundo: quando o download some (terminou ou falhou), a tela confere o que está instalado
  useEffect(() => {
    let was = false
    const tick = () => invoke<Progress | null>('ai_download_status').then(p => { setProg(p); if (was && !p) ready.current(); was = !!p }, () => {})
    void tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  const busy = prog ? 'baixando' : ligando ? 'ligando' : null

  const baixar = async (m: CatalogModel) => {
    set({ error: null })
    setProg({ received: 0, total: 0 })
    try {
      await invoke('ai_download', { url: m.url, sha256: m.sha256, file: m.file, bytes: m.bytes })
      setAiSettings({ modelId: m.id, tokS: null })
      set({ ligando: true })
      try { await ensureServer(m); setAiSettings({ tokS: await calibrate(tauriPost) }) } catch { /* a velocidade fica sem medir; o resto funciona */ }
      ready.current()
    } catch (e) { set({ error: errText(e) }) }
    set({ ligando: false })
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}><Sparkles size={16} aria-hidden /><b style={{ color: '#fff' }}>Assistente com IA local</b></div>
      <div className="muted" style={{ margin: '6px 0 10px' }}>
        Lê os números do app e aponta o que importa no mês, e responde perguntas sobre os seus dados. Roda neste computador: nenhum dado financeiro sai daqui.
      </div>
      <div className="sum-row" style={{ cursor: 'default' }}><span className="grow">Este computador</span><b>{machineLabel(hw)}</b></div>
      {model ? <>
        <div className="sum-row" style={{ cursor: 'default' }}><span className="grow">Modelo recomendado</span><b>{model.name} · {gb(model.bytes)}</b></div>
        {busy === 'baixando' && prog && (prog.total > 0 && prog.received >= prog.total
          ? <div className="muted" style={{ marginTop: 8 }}>Conferindo o arquivo baixado…</div>
          : (
          <div style={{ marginTop: 8 }}>
            <div className="meter big" aria-hidden><i style={{ width: `${prog.total ? (prog.received / prog.total) * 100 : 0}%` }} /></div>
            <div className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{gb(prog.received)} de {gb(prog.total)}</div>
          </div>
        ))}
        {busy === 'ligando' && <div className="muted" style={{ marginTop: 8 }}>Ligando o modelo e medindo a velocidade…</div>}
        {error && <div className="alert-bad" style={{ marginTop: 8 }}><span>{error}</span></div>}
        <div className="btns" style={{ marginTop: 10 }}>
          {/* conferindo o arquivo ou ligando o modelo: nada para clicar */}
          {busy === null && <button className="b pri with-ico" onClick={() => void baixar(model)}><Download size={13} aria-hidden />{error ? 'Tentar de novo' : 'Baixar e ativar'}</button>}
          {busy === 'baixando' && !(prog && prog.total > 0 && prog.received >= prog.total) && <button className="b ghost" onClick={() => void invoke('ai_cancel_download')}>Cancelar</button>}
        </div>
        <div className="muted" style={{ marginTop: 8 }}>O download é feito uma vez só, do Hugging Face. Se parar no meio, continua de onde parou.</div>
      </> : <div className="note" style={{ marginTop: 8 }}>{'unavailable' in pick ? pick.unavailable : ''}</div>}
    </div>
  )
}
