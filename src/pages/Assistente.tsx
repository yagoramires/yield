import { invoke } from '@tauri-apps/api/core'
import { Gauge } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CATALOG, lighter, type Hardware } from '../ai/catalog'
import { getHardware } from '../ai/server'
import { setAiSettings, useAiSettings } from '../ai/settings'
import { useData } from '../state/DataProvider'
import type { Route } from '../ui/routes'
import { Ativar } from './assistente/Ativar'
import { Chat } from './assistente/Chat'
import { Insights } from './assistente/Insights'
import { useAiInput } from './assistente/useAiInput'
import { errText, GastosHeader } from './lancamentos/GastosHeader'

export function Assistente({ onNavigate }: { onNavigate(r: Route): void }) {
  const settings = useAiSettings()
  const { gastos: { month } } = useData()
  const { input, loadRent } = useAiInput(month)
  const [hw, setHw] = useState<Hardware | null>(null)
  const [installed, setInstalled] = useState<{ file: string; bytes: number }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(() => invoke<{ file: string; bytes: number }[]>('ai_installed').then(setInstalled, e => setError(errText(e))), [])
  useEffect(() => { getHardware().then(setHw, e => setError(errText(e))); void refresh() }, [refresh])

  const has = (file: string) => !!installed?.some(i => i.file === file)
  const chosen = CATALOG.find(m => m.id === settings.modelId) ?? null
  // o escolhido se já está no disco; sem escolha, qualquer um do catálogo que já foi baixado
  const model = chosen ? (has(chosen.file) ? chosen : null) : CATALOG.find(m => has(m.file)) ?? null
  const light = model && settings.tokS !== null && settings.tokS < 8 ? lighter(model) : null

  return (
    <>
      <GastosHeader title="Assistente" />
      {settings.off !== false ? <div className="card" style={{ marginTop: 12 }}><span className="muted">O Assistente está desligado. Ligue de novo em Configurações › IA local.</span></div>
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
          <Insights key={month} model={model} month={month} input={input} onNavigate={onNavigate} />
          <Chat model={model} input={input} loadRent={loadRent} />
        </>}
      <div className="muted ai-foot">Sugestões automáticas a partir dos seus dados; não são recomendação de investimento.</div>
    </>
  )
}
