import { Channel, invoke } from '@tauri-apps/api/core'
import { Download, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { gb, machineLabel, pickModel, type CatalogModel, type Hardware } from '../../ai/catalog'
import { calibrate } from '../../ai/llm'
import { ensureServer, tauriPost } from '../../ai/server'
import { setAiSettings } from '../../ai/settings'
import { errText } from '../lancamentos/GastosHeader'

/** Primeiro uso: mostra a máquina e o modelo que cabe nela, baixa, liga e mede a velocidade. */
export function Ativar({ hw, target, onReady }: { hw: Hardware; target: CatalogModel | null; onReady(): void }) {
  const pick = pickModel(hw)
  const model = target ?? ('model' in pick ? pick.model : null)
  const [busy, setBusy] = useState<'baixando' | 'ligando' | null>(null)
  const [prog, setProg] = useState<{ received: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const baixar = async (m: CatalogModel) => {
    setError(null); setBusy('baixando'); setProg(null)
    try {
      const ch = new Channel<{ received: number; total: number }>()
      ch.onmessage = setProg
      await invoke('ai_download', { url: m.url, sha256: m.sha256, file: m.file, onProgress: ch })
      setAiSettings({ modelId: m.id, tokS: null })
      setBusy('ligando')
      try { await ensureServer(m); setAiSettings({ tokS: await calibrate(tauriPost) }) } catch { /* a velocidade fica sem medir; o resto funciona */ }
      onReady()
    } catch (e) { setError(errText(e)) }
    setBusy(null)
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
        {busy === 'baixando' && prog && (
          <div style={{ marginTop: 8 }}>
            <div className="meter big" aria-hidden><i style={{ width: `${prog.total ? (prog.received / prog.total) * 100 : 0}%` }} /></div>
            <div className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{gb(prog.received)} de {gb(prog.total)}</div>
          </div>
        )}
        {busy === 'ligando' && <div className="muted" style={{ marginTop: 8 }}>Ligando o modelo e medindo a velocidade…</div>}
        {error && <div className="alert-bad" style={{ marginTop: 8 }}><span>{error}</span></div>}
        <div className="btns" style={{ marginTop: 10 }}>
          {busy === 'baixando'
            ? <button className="b ghost" onClick={() => void invoke('ai_cancel_download')}>Cancelar</button>
            : <button className="b pri with-ico" disabled={busy !== null} onClick={() => void baixar(model)}><Download size={13} aria-hidden />{error ? 'Tentar de novo' : 'Baixar e ativar'}</button>}
        </div>
        <div className="muted" style={{ marginTop: 8 }}>O download é feito uma vez só, do Hugging Face. Se parar no meio, continua de onde parou.</div>
      </> : <div className="note" style={{ marginTop: 8 }}>{'unavailable' in pick ? pick.unavailable : ''}</div>}
    </div>
  )
}
