import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useEffect, useState } from 'react'
import { normalizeTicker } from '../../domain/ledger'
import { addMonths } from '../../domain/money'
import { cdiIndex, closeIndex, portfolioIndex } from '../../domain/rentabilidade'
import type { Cents, CorporateEvent, Dividend, Month, Trade } from '../../domain/types'
import { fetchCdi, fetchMonthlyCloses } from '../../quotes/historico'
import { yahooSymbol } from '../../quotes/yahoo'
import { LineChart } from '../../ui/charts'
import { monthName } from '../lancamentos/GastosHeader'

type Hist = { closes: Map<string, Map<Month, Cents>>; ibov: Map<Month, Cents>; cdi: Map<Month, number>; missing: string[] }

// shortcut: histórico baixado uma vez por sessão e guardado só em memória; guardar no banco se a abertura ficar lenta.
const cache = new Map<string, Promise<Hist>>()

function loadHist(tickers: string[], from: Month, to: Month): Promise<Hist> {
  const key = `${tickers.join(',')}|${from}|${to}`
  if (!cache.has(key)) {
    const f = tauriFetch as typeof fetch
    const p = (async () => {
      const [cdi, ibov, ...each] = await Promise.allSettled([fetchCdi(from, to, f), fetchMonthlyCloses('^BVSP', f), ...tickers.map(t => fetchMonthlyCloses(yahooSymbol(t), f))])
      const closes = new Map<string, Map<Month, Cents>>()
      const missing: string[] = []
      each.forEach((r, i) => (r.status === 'fulfilled' && r.value.size ? closes.set(tickers[i], r.value) : missing.push(tickers[i])))
      if (cdi.status === 'rejected' && ibov.status === 'rejected' && !closes.size) throw new Error('sem conexão com o Yahoo nem com o Banco Central')
      // algo falhou (rede, limite do Yahoo): não guarda, para tentar de novo na próxima vez que a tela abrir
      if (missing.length || cdi.status === 'rejected' || ibov.status === 'rejected') cache.delete(key)
      return { closes, missing, cdi: cdi.status === 'fulfilled' ? cdi.value : new Map(), ibov: ibov.status === 'fulfilled' ? ibov.value : new Map() }
    })()
    cache.set(key, p)
    p.catch(() => cache.delete(key))
  }
  return cache.get(key)!
}

const pct = (v: number) => `${v >= 100 ? '+' : '−'}${Math.abs(v - 100).toFixed(1).replace('.', ',')}%`
const last = (vs: (number | null)[]) => [...vs].reverse().find((v): v is number => v !== null) ?? null

/** Carteira de bolsa × CDI × Ibovespa nos últimos 12 meses, os três começando em 100. */
export function Rentabilidade({ trades, events, dividends, thisMonth }: { trades: Trade[]; events: CorporateEvent[]; dividends: Dividend[]; thisMonth: Month }) {
  const months = Array.from({ length: 13 }, (_, i) => addMonths(thisMonth, i - 12))
  // mesmos nomes do replay (PETR4F → PETR4) e o ticker novo de cada mudança de ticker
  const tickers = [...new Set([...trades.map(t => normalizeTicker(t.ticker)), ...events.flatMap(e => (e.kind === 'mudanca_ticker' ? [normalizeTicker(e.newTicker)] : []))])].sort()
  const [hist, setHist] = useState<Hist | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    loadHist(tickers, months[0], thisMonth).then(h => alive && setHist(h), e => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => { alive = false }
  }, [tickers.join(','), thisMonth]) // eslint-disable-line react-hooks/exhaustive-deps

  const labels = months.map(m => `${monthName(m).slice(0, 3).toLowerCase()}/${m.slice(2, 4)}`)
  const series = hist ? [
    { label: 'carteira', values: portfolioIndex(trades, events, dividends, hist.closes, months) },
    { label: 'CDI', values: cdiIndex(hist.cdi, months) },
    { label: 'Ibovespa', values: closeIndex(hist.ibov, months), dashed: true },
  ] : []
  const lastCdi = hist ? [...months].reverse().find(m => hist.cdi.has(m)) : undefined

  return (
    <div className="card bench">
      <div className="bar">
        <h5 style={{ margin: 0 }}>Rentabilidade em 12 meses</h5>
        <span className="bench-sum">{series.map(s => { const v = last(s.values); return v === null ? null : <span key={s.label}>{s.label} <b className={v >= 100 ? 'up' : 'dn'}>{pct(v)}</b></span> })}</span>
      </div>
      {error ? <div className="muted" style={{ marginTop: 8 }}>Não foi possível baixar o histórico: {error}</div>
        : !hist ? <div className="muted" style={{ marginTop: 8 }}>Baixando o histórico de preços, do Ibovespa e do CDI…</div> : (
          <>
            <LineChart fitRange height={190} series={series} xLabels={labels} xTicks={[0, 3, 6, 9, 12]} tipTitle={i => labels[i]} format={pct} tickFormat={pct}
              ariaLabel={`Rentabilidade em 12 meses: ${series.map(s => `${s.label} ${last(s.values) === null ? 'sem dado' : pct(last(s.values)!)}`).join('; ')}`} />
            <div className="muted">
              Ações, FIIs, ETFs e BDRs, com proventos e sem contar compras e vendas como ganho (Dietz modificado), sobre fechamentos mensais do Yahoo. CDI do Banco Central{lastCdi ? ` até ${monthName(lastCdi).toLowerCase()}` : ''}.
              {hist.missing.length > 0 && ` Sem histórico para ${hist.missing.join(', ')}: entram pelo preço médio.`}
            </div>
          </>
        )}
    </div>
  )
}
