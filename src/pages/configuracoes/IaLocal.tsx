import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { CATALOG, fits, gb, machineLabel, type Hardware } from '../../ai/catalog'
import { getHardware, stopServer } from '../../ai/server'
import { setAiSettings, useAiSettings } from '../../ai/settings'
import { Select } from '../../ui/Select'
import { errText } from '../lancamentos/GastosHeader'

/** Máquina, modelo e velocidade do Assistente; trocar, remover o arquivo baixado e desligar tudo. */
export function IaLocal() {
  const s = useAiSettings()
  const [hw, setHw] = useState<Hardware | null>(null)
  const [installed, setInstalled] = useState<{ file: string; bytes: number }[]>([])
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => invoke<{ file: string; bytes: number }[]>('ai_installed').then(setInstalled, e => setError(errText(e)))
  useEffect(() => { getHardware().then(setHw, e => setError(errText(e))); void refresh() }, [])

  const current = CATALOG.find(m => m.id === s.modelId) ?? CATALOG.find(m => installed.some(i => i.file === m.file)) ?? null
  const size = installed.find(i => i.file === current?.file)?.bytes
  const options = hw ? CATALOG.filter(m => fits(m, hw)) : []

  const remove = async () => {
    if (!current) return
    try { await invoke('ai_delete_model', { file: current.file }); setAiSettings({ modelId: null, tokS: null }); setError(null) } catch (e) { setError(`Não foi possível remover: ${errText(e)}`) }
    setConfirm(false); void refresh()
  }
  const on = s.off === false
  const toggle = () => { setAiSettings({ off: on }); if (on) void stopServer().catch(() => {}) }
  const row = (label: string, value: React.ReactNode) => <div className="sum-row" style={{ cursor: 'default' }}><span className="grow">{label}</span><b>{value}</b></div>

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h5 style={{ margin: 0 }}>IA local <span className="muted">· Assistente que roda neste computador</span></h5>
      <label className="toggle-row" style={{ marginTop: 8 }}>
        <span>Usar o Assistente<small>insights do mês e perguntas sobre os seus dados; nenhum dado sai deste computador</small></span>
        <input type="checkbox" className="switch" role="switch" checked={on} onChange={toggle} />
      </label>
      {row('Este computador', hw ? machineLabel(hw) : '…')}
      {row('Modelo', current ? `${current.name}${size ? ` · ${gb(size)} no disco` : ' · não baixado'}` : 'nenhum')}
      {s.tokS !== null && row('Velocidade medida', `${s.tokS.toFixed(1).replace('.', ',')} tokens/s`)}
      <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {options.length > 1 && <Select ariaLabel="Trocar modelo" value={current?.id ?? ''} options={options.map(m => ({ value: m.id, label: `${m.name} · ${gb(m.bytes)}` }))} onChange={v => setAiSettings({ modelId: v, tokS: null })} />}
        {current && size !== undefined && (confirm
          ? <><span>Remover {current.name} ({gb(size)})?</span><button className="b ghost" onClick={() => void remove()}>Remover</button><button className="link" onClick={() => setConfirm(false)}>Cancelar</button></>
          : <button className="b ghost" onClick={() => setConfirm(true)}>Remover modelo</button>)}
      </div>
      {current && size === undefined && on && <div className="muted" style={{ marginTop: 8 }}>Abra o Assistente para baixar o {current.name}.</div>}
      {error && <div className="alert-bad" style={{ marginTop: 8 }}><span>{error}</span></div>}
    </div>
  )
}
