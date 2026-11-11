import { useState } from 'react'
import { saveSegmentTargets, type AssetSegment } from '../../db/repo'
import { useData } from '../../state/DataProvider'
import { useHideValues } from '../../ui/HideValues'
import { SERIES, TINT } from '../../ui/palette'
import { BOLSA, type ClassKey } from '../carteira/build'
import { classLabel, FII_SEGMENTS, segmentSlices } from './build'

const pctText = (p: number) => `${(p * 100).toFixed(1).replace('.', ',')}%`
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Sugestões do campo de segmento (Carteira e metas): os de FII e os que já existem nos ativos. */
export function SegmentOptions({ id, segments }: { id: string; segments: AssetSegment[] }) {
  const all = [...new Set([...FII_SEGMENTS, ...segments.map(s => s.segment).filter((s): s is string => !!s)])]
  return <datalist id={id}>{all.map(s => <option key={s} value={s} />)}</datalist>
}

/** Card do Resumo: a classe da bolsa repartida por segmento (hoje × meta) e quanto falta aportar em cada um para chegar na meta. */
export function Segmentos({ onOpenCarteira }: { onOpenCarteira(cls: string): void }) {
  const { data, db, derived, reload } = useData()
  const { brl, cents } = useHideValues()
  const p = derived.portfolio
  const [pick, setPick] = useState<ClassKey | null>(null)
  const [draft, setDraft] = useState<{ seg: string; pct: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const classes = BOLSA.filter(k => p.rows.some(r => r.assetType === k && (r.valueCents ?? 0) > 0))
  if (!classes.length) return null

  const cls = pick && classes.includes(pick) ? pick : classes.includes('FII') ? 'FII' : classes[0]
  const targets = data.segmentTargets[cls] ?? {}
  const slices = segmentSlices(p, cls, data.segments, targets)
  const total = slices.reduce((s, x) => s + x.valueCents, 0)
  const named = slices.map(s => s.segment).filter((s): s is string => s !== null)
  const color = (s: string | null) => (s === null ? TINT.cinza : SERIES[named.indexOf(s) % SERIES.length])
  const hasTargets = slices.some(s => s.targetPct !== null)
  const targetSum = Object.values(targets).reduce((s, v) => s + v, 0)

  const edit = () => { setError(null); setDraft([...named.map(seg => ({ seg, pct: targets[seg] === undefined ? '' : String(targets[seg]).replace('.', ',') })), { seg: '', pct: '' }]) }
  // linha sem nome ou sem % é ignorada (apagar o % tira a meta)
  const parsed = (draft ?? []).filter(r => r.seg.trim() && r.pct.trim()).map(r => ({ seg: r.seg.trim(), pct: Number(r.pct.trim().replace(',', '.')) }))
  const draftSum = parsed.reduce((s, r) => s + (Number.isFinite(r.pct) ? r.pct : 0), 0)
  const save = async () => {
    if (parsed.some(r => !(r.pct > 0 && r.pct <= 100))) return setError('Cada meta é um número entre 0 e 100.')
    const next = { ...data.segmentTargets }
    if (parsed.length) next[cls] = Object.fromEntries(parsed.map(r => [r.seg, r.pct]))
    else delete next[cls]
    try { await saveSegmentTargets(db, next); await reload(); setDraft(null) } catch (e) { setError(`Não foi possível salvar: ${errText(e)}`) }
  }
  const gapText = (gap: number | null) => {
    if (gap === null) return null
    if (Math.abs(gap) <= total * 0.005) return 'na meta'
    return gap > 0 ? `faltam ${brl(gap)}` : `${brl(-gap)} acima`
  }

  return (
    <div className="card">
      <div className="bar">
        <h5 style={{ margin: 0 }}>Por segmento</h5>
        {classes.length > 1 && (
          <div className="seg" role="group" aria-label="Classe">
            {classes.map(k => <button key={k} className={k === cls ? 'on' : ''} aria-pressed={k === cls} onClick={() => { setPick(k); setDraft(null) }}>{classLabel(k)}</button>)}
          </div>
        )}
      </div>

      {draft ? (
        <div className="seg-goals">
          <SegmentOptions id="seg-metas" segments={data.segments} />
          {draft.map((r, i) => (
            <div key={i} className="seg-goal">
              <input className="in" list="seg-metas" aria-label="Segmento" placeholder="novo segmento" value={r.seg} onChange={e => setDraft(draft.map((x, j) => (j === i ? { ...x, seg: e.target.value } : x)))} />
              <input className="in r" inputMode="decimal" aria-label={`Meta de ${r.seg || 'novo segmento'} em %`} placeholder="—" value={r.pct} onChange={e => setDraft(draft.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
              <span className="muted">%</span>
            </div>
          ))}
          <div className="muted">Soma das metas: <b className={Math.abs(draftSum - 100) < 0.05 ? '' : 'dn'}>{String(Math.round(draftSum * 10) / 10).replace('.', ',')}%</b>{Math.abs(draftSum - 100) >= 0.05 && ' (o ideal é fechar 100%)'}</div>
          {error && <div className="alert-bad">{error}</div>}
          <div className="btns">
            <button className="b ghost" onClick={() => setDraft([...draft, { seg: '', pct: '' }])}>+ segmento</button>
            <button className="b ghost" onClick={() => setDraft(null)}>Cancelar</button>
            <button className="b pri" onClick={() => void save()}>Salvar metas</button>
          </div>
        </div>
      ) : <>
        <div className="seg-bar"><span className="muted">hoje</span><div className="class-stack" aria-hidden>{slices.filter(s => s.valueCents > 0).map(s => <i key={s.segment ?? '-'} style={{ width: `${s.pct * 100}%`, background: color(s.segment) }} />)}</div></div>
        {hasTargets && <div className="seg-bar"><span className="muted">meta</span><div className="class-stack" aria-hidden>{slices.filter(s => s.targetPct).map(s => <i key={s.segment!} style={{ width: `${s.targetPct}%`, background: color(s.segment) }} />)}</div></div>}
        <div className="sum-rows">
          {slices.map(s => (
            <button key={s.segment ?? '-'} className="sum-row" onClick={() => onOpenCarteira(cls)}>
              <span className="class-dot" style={{ background: color(s.segment) }} />
              <span className="lmid">
                <span className="sum-name">{s.segment ?? 'Sem segmento'} <span className="muted">{pctText(s.pct)}{s.targetPct !== null && ` · meta ${String(s.targetPct).replace('.', ',')}%`}</span></span>
                {s.segment === null && <span className="muted">defina na Carteira, coluna Segmento</span>}
              </span>
              <span className="sum-val">{cents(s.valueCents)}{s.gapCents !== null && <small className={s.gapCents > total * 0.005 ? 'up' : ''}>{gapText(s.gapCents)}</small>}</span>
            </button>
          ))}
        </div>
        <div className="bar" style={{ marginTop: 6 }}>
          <span className="muted">{hasTargets ? `metas somam ${String(Math.round(targetSum * 10) / 10).replace('.', ',')}% · "faltam" é quanto aportar para chegar na meta com o total de hoje` : 'Defina a % que quer em cada segmento para ver quanto falta aportar.'}</span>
          <button className="link" onClick={edit}>{hasTargets ? 'Editar metas' : 'Definir metas'}</button>
        </div>
      </>}
    </div>
  )
}
