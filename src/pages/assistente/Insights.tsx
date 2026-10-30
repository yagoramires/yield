import { invoke } from '@tauri-apps/api/core'
import { ArrowRight, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { installedModel, type CatalogModel } from '../../ai/catalog'
import { maskMoney } from '../../ai/check'
import { buildFacts, factsHash, type Area } from '../../ai/facts'
import { generateInsights } from '../../ai/insights'
import { ensureServer, tauriPost } from '../../ai/server'
import { useAiSettings } from '../../ai/settings'
import { getInsights, saveInsights, type SavedInsights } from '../../db/aiRepo'
import type { Month } from '../../domain/types'
import { useData } from '../../state/DataProvider'
import { useHideValues } from '../../ui/HideValues'
import type { Route } from '../../ui/routes'
import { NO_FILTER } from '../lancamentos/build'
import { errText, monthName } from '../lancamentos/GastosHeader'
import { useAiInput } from './useAiInput'

// hoje só a hora; outro dia, dia e hora
const when = (iso: string) => {
  const d = new Date(iso)
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? `às ${hm}` : `em ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hm}`
}
// fatos já tentados nesta sessão: se a geração falhar, não tenta de novo a cada visita (o botão continua lá)
const tried = new Set<string>()

/**
 * Insights da IA dentro dos Resumos. Só para quem ligou a IA e tem o modelo baixado: mostra o que está salvo e,
 * quando os números mudaram, gera de novo sozinho (o modelo leva de 10 a 30 s).
 */
export function Insights({ area, month, onNavigate }: { area: Area; month: Month; onNavigate(r: Route): void }) {
  const ai = useAiSettings()
  const [files, setFiles] = useState<string[] | null>(null)
  useEffect(() => {
    if (ai.off === false) invoke<{ file: string }[]>('ai_installed').then(l => setFiles(l.map(i => i.file)), () => setFiles([]))
  }, [ai.off, ai.modelId])
  const model = ai.off === false && files ? installedModel(ai.modelId, files) : null
  return model ? <Panel key={`${area}:${month}`} area={area} month={month} model={model} onNavigate={onNavigate} /> : null
}

function Panel({ area, month, model, onNavigate }: { area: Area; month: Month; model: CatalogModel; onNavigate(r: Route): void }) {
  const { db, gastos } = useData()
  useHideValues() // redesenha quando o olhinho muda
  const { input } = useAiInput(month)
  const key = `${area}:${month}` // guardado na coluna month da ai_insights: um por Resumo e mês
  const facts = useMemo(() => (input ? buildFacts(month, area, input) : null), [month, area, input])
  const [hash, setHash] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedInsights | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { let alive = true; getInsights(db, key).then(s => alive && setSaved(s), () => alive && setSaved(null)); return () => { alive = false } }, [db, key])
  useEffect(() => { let alive = true; if (facts && input) void factsHash(facts, input.today).then(h => alive && setHash(h)); return () => { alive = false } }, [facts, input])

  const gerar = async () => {
    if (!facts || !hash) return
    setBusy(true); setError(null)
    try {
      await ensureServer(model)
      const insights = await generateInsights(tauriPost, facts)
      if (!insights.length) throw new Error('O modelo não trouxe observações que deem para conferir com os seus números. Tente gerar de novo.')
      const s = { month: key, factsHash: hash, model: model.id, insights, createdAt: new Date().toISOString() }
      await saveInsights(db, s)
      setSaved(s)
    } catch (e) { setError(errText(e)) }
    setBusy(false)
  }

  const stale = !saved || (!!hash && saved.factsHash !== hash)
  useEffect(() => {
    if (!facts?.length || !hash || saved === undefined || busy || !stale || tried.has(`${key}|${hash}`)) return
    tried.add(`${key}|${hash}`)
    void gerar()
  }, [facts, hash, saved, busy, stale, key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!facts?.length || saved === undefined) return null
  const title = area === 'gastos' ? `Insights de ${monthName(month).toLowerCase()} de ${month.slice(0, 4)}` : 'Insights da carteira'
  const open = (factId: string) => {
    const f = facts.find(x => x.id === factId)
    if (!f) return
    if (f.categoryId) gastos.setFilter({ ...NO_FILTER, categoryId: f.categoryId })
    onNavigate(f.route)
  }

  return (
    <div className="card" style={{ marginTop: 12 }} aria-busy={busy}>
      <div className="ai-head">
        <Sparkles size={15} className="ai-ico" aria-hidden />
        <h5>{title}</h5>
        <span className="ai-status">
          {busy ? <><RefreshCw size={12} className="spin" aria-hidden />analisando…</>
            : saved && <>gerado {when(saved.createdAt)}<button className="icon-btn" aria-label="Gerar de novo" title="Gerar de novo" disabled={!hash} onClick={() => void gerar()}><RefreshCw size={12} aria-hidden /></button></>}
        </span>
      </div>
      {!saved ? (busy ? <>
        <div className="ai-grid" aria-hidden>{[0, 1, 2].map(n => <div key={n} className="ai-skel"><i style={{ width: '45%' }} /><i /><i style={{ width: '80%' }} /></div>)}</div>
        <div className="ai-note">A IA está lendo os números do mês. Leva de 10 a 30 segundos.</div>
      </> : <div className="muted">Não deu para gerar agora.</div>) : <>
        <div className={`ai-grid${busy ? ' dim' : ''}`}>
          {saved.insights.map((i, n) => (
            <div key={n} className="ai-card">
              <b>{maskMoney(i.titulo)}</b>
              <p>{maskMoney(i.texto)}</p>
              {i.recomendacao && <div className="ai-rec">{maskMoney(i.recomendacao)}</div>}
              {facts.some(f => f.id === i.factIds[0]) && <button className="link with-ico" onClick={() => open(i.factIds[0])}>ver<ArrowRight size={12} aria-hidden /></button>}
            </div>
          ))}
        </div>
        <div className="ai-note">Sugestões automáticas a partir dos seus dados; não são recomendação de investimento.</div>
      </>}
      {error && <div className="alert-bad" style={{ marginTop: 8 }}><span>{error}</span>{!busy && !saved && <button className="link" onClick={() => void gerar()}>Tentar de novo</button>}</div>}
    </div>
  )
}
