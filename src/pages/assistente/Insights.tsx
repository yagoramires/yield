import { ArrowRight, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { CatalogModel } from '../../ai/catalog'
import { maskMoney } from '../../ai/check'
import { buildFacts, factsHash, type AiInput } from '../../ai/facts'
import { generateInsights } from '../../ai/insights'
import { ensureServer, tauriPost } from '../../ai/server'
import { getInsights, saveInsights, type SavedInsights } from '../../db/aiRepo'
import type { Month } from '../../domain/types'
import { useData } from '../../state/DataProvider'
import { useHideValues } from '../../ui/HideValues'
import type { Route } from '../../ui/routes'
import { NO_FILTER } from '../lancamentos/build'
import { errText, monthName } from '../lancamentos/GastosHeader'

const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Observações do mês. Guardadas por mês: gerar leva de 10 a 30 s, então só regera quando a pessoa pede. */
export function Insights({ model, month, input, onNavigate }: { model: CatalogModel; month: Month; input: AiInput | null; onNavigate(r: Route): void }) {
  const { db, gastos } = useData()
  useHideValues() // redesenha quando o olhinho muda
  const facts = useMemo(() => (input ? buildFacts(month, input) : null), [month, input])
  const [hash, setHash] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedInsights | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { let alive = true; setSaved(undefined); getInsights(db, month).then(s => alive && setSaved(s), () => alive && setSaved(null)); return () => { alive = false } }, [db, month])
  useEffect(() => { let alive = true; if (facts) void factsHash(facts).then(h => alive && setHash(h)); return () => { alive = false } }, [facts])

  const gerar = async () => {
    if (!facts || !hash) return
    setBusy(true); setError(null)
    try {
      await ensureServer(model)
      const insights = await generateInsights(tauriPost, facts)
      if (!insights.length) throw new Error('O modelo não trouxe observações que deem para conferir com os seus números. Tente gerar de novo.')
      const s = { month, factsHash: hash, model: model.id, insights, createdAt: new Date().toISOString() }
      await saveInsights(db, s)
      setSaved(s)
    } catch (e) { setError(errText(e)) }
    setBusy(false)
  }

  const mes = `${monthName(month).toLowerCase()} de ${month.slice(0, 4)}`
  const stale = !!saved && !!hash && saved.factsHash !== hash
  const open = (factId: string) => {
    const f = facts?.find(x => x.id === factId)
    if (!f) return
    if (f.categoryId) gastos.setFilter({ ...NO_FILTER, categoryId: f.categoryId })
    onNavigate(f.route)
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="bar">
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <h5 style={{ margin: 0 }}>Insights de {mes}</h5>
          {stale && <span className="tag">desatualizado</span>}
          {saved && <span className="muted">gerado em {when(saved.createdAt)}</span>}
        </div>
        {facts && facts.length > 0 && saved !== undefined && (
          <div className="btns"><button className={`b ${saved ? 'ghost' : 'pri'} with-ico`} disabled={busy || !hash} onClick={() => void gerar()}><RefreshCw size={13} aria-hidden />{saved ? 'Gerar de novo' : 'Gerar insights'}</button></div>
        )}
      </div>
      {!facts || saved === undefined ? <div className="muted">Juntando os números do mês…</div>
        : !facts.length ? <div className="muted">Ainda não há dados de {mes} para analisar.</div>
        : busy ? <div className="muted">Analisando o mês… (leva de 10 a 30 s)</div>
        : !saved ? <div className="muted">Clique em "Gerar insights" para a IA olhar os números de {mes}.</div>
        : (
          <div className="ai-grid">
            {saved.insights.map((i, n) => (
              <div key={n} className="ai-card">
                <b>{i.titulo}</b>
                <p>{maskMoney(i.texto)}</p>
                {i.recomendacao && <div className="ai-rec">{maskMoney(i.recomendacao)}</div>}
                {facts.some(f => f.id === i.factIds[0]) && <button className="link with-ico" onClick={() => open(i.factIds[0])}>ver<ArrowRight size={12} aria-hidden /></button>}
              </div>
            ))}
          </div>
        )}
      {error && <div className="alert-bad" style={{ marginTop: 8 }}><span>{error}</span></div>}
    </div>
  )
}
