import { invoke } from '@tauri-apps/api/core'
import { Gauge } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CATALOG, installedModel, lighter, type Hardware } from '../ai/catalog'
import { getHardware } from '../ai/server'
import { setAiSettings, useAiSettings } from '../ai/settings'
import { monthOf } from '../domain/money'
import { todayISO } from '../state/DataProvider'
import { Ativar } from './assistente/Ativar'
import { Chat } from './assistente/Chat'
import { useAiInput } from './assistente/useAiInput'
import { errText } from './lancamentos/GastosHeader'

/** Ativação do modelo e o chat. Os insights do mês ficam nos Resumos de gastos e de investimentos. */
export function Assistente() {
  const settings = useAiSettings()
  const on = settings.off === false
  const { input, loadRent } = useAiInput(monthOf(todayISO()))
  const [hw, setHw] = useState<Hardware | null>(null)
  const [installed, setInstalled] = useState<{ file: string; bytes: number }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(() => invoke<{ file: string; bytes: number }[]>('ai_installed').then(setInstalled, e => setError(errText(e))), [])
  // desligada, nada de detectar hardware nem criar a pasta de modelos
  useEffect(() => { if (on) { getHardware().then(setHw, e => setError(errText(e))); void refresh() } }, [on, refresh])

  const model = installed ? installedModel(settings.modelId, installed.map(i => i.file)) : null
  const chosen = CATALOG.find(m => m.id === settings.modelId) ?? null
  const light = model && settings.tokS !== null && settings.tokS < 8 ? lighter(model) : null

  return (
    <div className="chat-page">
      <h1 style={{ margin: 0 }}>Assistente</h1>
      {!on ? <div className="card" style={{ marginTop: 12 }}><span className="muted">O Assistente está desligado. Ligue de novo em Configurações › IA local.</span></div>
        : error ? <div className="alert-bad" style={{ marginTop: 12 }}><span>{error}</span></div>
        : !hw || !installed ? <div className="muted" style={{ marginTop: 12 }}>Verificando este computador…</div>
        : !model ? <Ativar hw={hw} target={chosen} onReady={() => void refresh()} />
        : <>
          {light && (
            <div className="note row" style={{ marginTop: 12, alignItems: 'center', gap: 8 }}>
              <Gauge size={14} aria-hidden />
              <span className="grow">Neste computador o {model.name} gerou {settings.tokS!.toFixed(1).replace('.', ',')} tokens/s; o {light.name} responde mais rápido.</span>
              <button className="link" onClick={() => setAiSettings({ modelId: light.id, tokS: null })}>Usar o {light.name}</button>
            </div>
          )}
          <Chat model={model} input={input} loadRent={loadRent} />
        </>}
    </div>
  )
}
