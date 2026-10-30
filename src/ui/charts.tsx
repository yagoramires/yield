import { isMasked } from '../domain/money'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'

// Validadas para daltonismo sobre o fundo dos cartões; texto nunca usa estas cores.
export const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#a66bd9'] // validada (dataviz): luminosidade, croma, daltonismo e contraste no tema escuro
const color = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length]

/** Rótulo curto de eixo e barra: 6.482,17 → "6,5 mil"; abaixo de mil, o inteiro. */
export function shortBRL(cents: number): string {
  if (isMasked()) return '•••'
  const r = cents / 100
  if (Math.abs(r) < 1000) return String(Math.round(r))
  return `${(r / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
}

function niceTicks(max: number, n = 4): number[] {
  const raw = Math.max(max, 100) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw)!
  return Array.from({ length: n + 1 }, (_, i) => i * step)
}

// Eixo do menor ao maior valor (para índices e variações em %, que não começam em zero).
function rangeTicks(min: number, max: number, n = 4): number[] {
  const raw = Math.max(max - min, 2) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw)!
  const lo = Math.floor(min / step) * step, hi = Math.max(Math.ceil(max / step) * step, lo + step) // tudo igual: ainda um intervalo
  return Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step)
}

const swatch = (i: number, dashed?: boolean) => ({ background: dashed ? `repeating-linear-gradient(90deg, ${color(i)} 0 4px, transparent 4px 7px)` : color(i) })

function Legend({ items }: { items: { label: string; dashed?: boolean; i?: number /* cor da série, se a lista foi filtrada */ }[] }) {
  if (items.length < 2) return null
  return <div className="lg">{items.map((s, i) => <span key={s.label}><i style={swatch(s.i ?? i, s.dashed)} />{s.label}</span>)}</div>
}

function Tip({ x, w, title, lines }: { x: number; w: number; title: string; lines: { i?: number; dashed?: boolean; label: string; value: string }[] }) {
  return (
    <div className="tip" style={{ left: `${(x / w) * 100}%`, transform: x > w / 2 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}>
      <div className="t2">{title}</div>
      {lines.map(l => <div key={l.label}>{l.i !== undefined && <i style={swatch(l.i, l.dashed)} />}{l.label && `${l.label} `}<b>{l.value}</b></div>)}
    </div>
  )
}

export interface LineSeries { label: string; values: (number | null)[]; dashed?: boolean }

/** Linhas por índice (ex.: dia do mês), um eixo y em centavos. `marker` destaca um índice (ex.: hoje). Série com um único valor vira um ponto. */
export function LineChart({ series, xLabels, xTicks, tipTitle, marker, format, tickFormat = shortBRL, ariaLabel, height: minHeight = 140, fill = false, fitRange = false }: {
  series: LineSeries[]; xLabels: string[]; xTicks: number[]; tipTitle?(i: number): string; marker?: number
  format(v: number): string; tickFormat?(v: number): string; ariaLabel: string; height?: number; fill?: boolean; fitRange?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [box, size] = useSize<HTMLDivElement>()
  const W = size?.w || 420, L = 36, R = 10, T = 8, B = 18
  const height = fill ? Math.max(minHeight, size?.h ?? 0) : minHeight
  const n = Math.max(2, ...series.map(s => s.values.length))
  const vals = series.flatMap(s => s.values.filter((v): v is number => v !== null))
  const ticks = fitRange && vals.length ? rangeTicks(Math.min(...vals), Math.max(...vals)) : niceTicks(Math.max(0, ...vals))
  const lo = ticks[0], top = ticks[ticks.length - 1]
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R)
  const y = (v: number) => height - B - ((v - lo) / (top - lo)) * (height - B - T)
  const d = (vs: (number | null)[]) => {
    let out = '', pen = false
    vs.forEach((v, i) => { if (v === null) { pen = false; return } out += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; pen = true })
    return out
  }
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))))
  }
  const focus = hover ?? marker
  return (
    <div className={`chart${fill ? ' chart-fill' : ''}`}>
      <Legend items={series} />
      <div ref={box} className="chart-box" style={{ minHeight }}>
      <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} style={{ stroke: i ? 'var(--surface)' : 'var(--border)' }} />
            <text x={L - 6} y={y(t) + 3} textAnchor="end" className="ax">{tickFormat(t)}</text>
          </g>
        ))}
        {xTicks.map(i => <text key={i} x={x(i)} y={height - 5} textAnchor="middle" className="ax">{xLabels[i]}</text>)}
        {series.map((s, i) => ({ s, i })).reverse().map(({ s, i }) => (
          <path key={s.label} d={d(s.values)} fill="none" style={{ stroke: color(i) }} strokeWidth={2} strokeLinejoin="round" strokeDasharray={s.dashed ? '4 3' : undefined} />
        ))}
        {series.map((s, i) => {
          const pts = s.values.flatMap((v, k) => (v === null ? [] : [k]))
          return pts.length === 1 && <circle key={s.label} cx={x(pts[0])} cy={y(s.values[pts[0]]!)} r={4} style={{ fill: color(i), stroke: 'var(--sidebar)' }} strokeWidth={2} />
        })}
        {focus !== undefined && (
          <g>
            <line x1={x(focus)} x2={x(focus)} y1={T} y2={height - B} style={{ stroke: 'var(--border)' }} strokeDasharray="2 2" />
            {series.map((s, i) => s.values[focus] != null && <circle key={s.label} cx={x(focus)} cy={y(s.values[focus]!)} r={4} style={{ fill: color(i), stroke: 'var(--sidebar)' }} strokeWidth={2} />)}
          </g>
        )}
      </svg>
      </div>
      {hover !== null && (
        <Tip x={x(hover)} w={W} title={tipTitle?.(hover) ?? xLabels[hover]}
          lines={series.map((s, i) => ({ i, dashed: s.dashed, label: s.label, value: s.values[hover] == null ? '—' : format(s.values[hover]!) }))} />
      )}
    </div>
  )
}

export interface Bar { label: string; values: number[] /* uma por série, empilhadas */; partial?: boolean /* listrada: período incompleto */; tip?: string; target?: number /* traço de meta; acima dele a barra fica vermelha */ }

const roundTop = (x: number, y: number, w: number, h: number, r = 4) => {
  r = Math.min(r, h, w / 2)
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`
}

/** Tamanho real do elemento em px; null até a primeira medida. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

/**
 * Barras verticais, empilhadas quando há mais de uma série (`series` dá os nomes da legenda).
 * `fill`: ocupa a altura que sobrar no cartão (o pai precisa ser flex em coluna); o desenho usa o tamanho real, sem esticar o texto.
 */
export function BarChart({ bars, series = [], format, valueLabel = shortBRL, ariaLabel, height: minHeight = 132, fill = false, selected = null, onSelect }: {
  bars: Bar[]; series?: string[]; format(v: number): string; valueLabel?(v: number): string; ariaLabel: string; height?: number; fill?: boolean
  selected?: number | null; onSelect?(i: number): void // clicar numa barra escolhe aquele período; as outras ficam apagadas
}) {
  const id = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const [box, size] = useSize<HTMLDivElement>()
  const W = size?.w || 400, L = 8, R = 8, T = 16, B = 18
  const height = fill ? Math.max(minHeight, size?.h ?? 0) : minHeight
  const totals = bars.map(b => b.values.reduce((s, v) => s + v, 0))
  const top = Math.max(1, ...totals, ...bars.map(b => b.target ?? 0))
  const slot = (W - L - R) / Math.max(1, bars.length)
  const bw = Math.min(34, slot * 0.6)
  const base = height - B
  const h = (v: number) => (v / top) * (base - T)
  const nSeries = Math.max(1, series.length, ...bars.map(b => b.values.length))
  const cx = (i: number) => L + slot * (i + 0.5)
  return (
    <div className={`chart${fill ? ' chart-fill' : ''}`}>
      <Legend items={series.map((label, i) => ({ label, i })).filter(x => bars.some(b => (b.values[x.i] ?? 0) > 0))} />
      <div ref={box} className="chart-box" style={{ minHeight }}>
      <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <defs>
          {Array.from({ length: nSeries }, (_, i) => (
            <pattern key={i} id={`${id}-p${i}`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={6} height={6} style={{ fill: color(i) }} opacity={0.3} /><rect width={3} height={6} style={{ fill: color(i) }} />
            </pattern>
          ))}
        </defs>
        <line x1={L} x2={W - R} y1={base} y2={base} style={{ stroke: 'var(--border)' }} />
        {bars.map((b, i) => {
          const last = b.values.reduce((k, v, j) => (v > 0 ? j : k), -1)
          let acc = 0
          return (
            <g key={i} onMouseEnter={() => setHover(i)} opacity={selected !== null && selected !== i ? 0.4 : 1}
              {...(onSelect && { className: 'pick', role: 'button', tabIndex: 0, 'aria-label': `${b.tip ?? b.label}: ${format(totals[i])}`, 'aria-pressed': selected === i,
                onClick: () => onSelect(i), onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i) } } })}>
              <rect x={cx(i) - slot / 2} y={0} width={slot} height={height} fill="transparent" />
              {b.values.map((v, j) => {
                if (v <= 0) return null
                const y0 = base - h(acc + v), hh = h(v)
                acc += v
                const fill = b.target !== undefined && totals[i] > b.target ? 'var(--negative)' : b.partial ? `url(#${id}-p${j})` : color(j)
                return j === last ? <path key={j} d={roundTop(cx(i) - bw / 2, y0, bw, hh)} style={{ fill }} /> : <rect key={j} x={cx(i) - bw / 2} y={y0} width={bw} height={hh} style={{ fill }} />
              })}
              {b.target !== undefined && <line x1={cx(i) - bw / 2 - 6} x2={cx(i) + bw / 2 + 6} y1={base - h(b.target)} y2={base - h(b.target)} style={{ stroke: 'var(--text)' }} strokeWidth={2} strokeLinecap="round" />}
              {totals[i] > 0 && <text x={cx(i)} y={base - h(Math.max(totals[i], b.target ?? 0)) - 5} textAnchor="middle" className="vl">{valueLabel(totals[i])}</text>}
              <text x={cx(i)} y={height - 5} textAnchor="middle" className="ax">{b.label}</text>
            </g>
          )
        })}
      </svg>
      </div>
      {hover !== null && (
        <Tip x={cx(hover)} w={W} title={bars[hover].tip ?? bars[hover].label}
          lines={nSeries > 1
            ? [...series.map((label, i) => ({ i, label, value: format(bars[hover].values[i] ?? 0) })).filter(l => (bars[hover].values[l.i] ?? 0) !== 0), { label: 'total', value: format(totals[hover]) }]
            : [{ label: '', value: format(totals[hover]) }, ...(bars[hover].target !== undefined ? [{ label: 'orçamento', value: format(bars[hover].target!) }] : [])]} />
      )}
    </div>
  )
}

export interface HBar { label: string; cents: number; striped?: boolean; warn?: boolean; selected?: boolean; onClick?(): void }

/** Barras horizontais com rótulo e valor em texto; cada linha clicável quando tem `onClick`. */
export function HBars({ rows, format, ariaLabel }: { rows: HBar[]; format(v: number): string; ariaLabel: string }) {
  const max = Math.max(1, ...rows.map(r => r.cents))
  return (
    <div role="group" aria-label={ariaLabel}>
      {rows.map(r => (
        <button key={r.label} className={`barrow ${r.selected ? 'sel' : ''}`} disabled={!r.onClick} onClick={r.onClick} title={`${r.label}: ${format(r.cents)}`}>
          <span className={r.warn ? 'warn' : ''}>{r.label}</span>
          <div><div className={`tr ${r.striped ? 'striped' : ''} ${r.warn ? 'warn' : ''}`} style={{ width: `${(r.cents / max) * 100}%` }} /></div>
          <span className="r">{format(r.cents)}</span>
        </button>
      ))}
    </div>
  )
}
