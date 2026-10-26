import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { openDb, type Db } from '../db/client'
import { loadAll, type Dataset } from '../db/repo'
import { computeDarfs, type DarfResult } from '../domain/darf'
import { replay, type ReplayResult } from '../domain/ledger'
import { buildPortfolio, type Portfolio } from '../domain/portfolio'
import { computeTax, type TaxMonth } from '../domain/tax'
import { REFRESH_MS, refreshQuotes, yahooSymbol } from '../quotes/yahoo'
import { monthOf } from '../domain/money'

export interface AppData {
  data: Dataset
  derived: { replay: ReplayResult; tax: TaxMonth[]; darfs: DarfResult; portfolio: Portfolio }
  db: Db
  reload(): Promise<void>
  refreshing: boolean
  refreshQuotesNow(): Promise<void>
}

const Ctx = createContext<AppData | null>(null)

export function useData(): AppData {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData fora do DataProvider')
  return v
}

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Db | null>(null)
  const [data, setData] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const dbRef = useRef<Db | null>(null)

  const reload = useCallback(async () => {
    if (dbRef.current) setData(await loadAll(dbRef.current))
  }, [])

  // Falha de cotação nunca derruba a tela: só deixa as cotações antigas.
  const refreshQuotesNow = useCallback(async () => {
    const d = dbRef.current
    if (!d) return
    setRefreshing(true)
    try {
      const ds = await loadAll(d)
      const { positions } = replay(ds.trades, ds.events)
      const symbols = new Set([...positions.filter(p => p.qty > 0).map(p => yahooSymbol(p.ticker)), ...ds.manualAssets.flatMap(a => (a.quoteSymbol ? [a.quoteSymbol] : []))])
      await refreshQuotes(d, [...symbols], tauriFetch as typeof fetch)
      setData(await loadAll(d))
    } catch { /* offline ou Yahoo fora do ar */ }
    setRefreshing(false)
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    let cancelled = false
    ;(async () => {
      try {
        const d = await openDb() // a migração só roda aqui, no primeiro Database.load
        if (cancelled) return
        dbRef.current = d
        setDb(d)
        setData(await loadAll(d))
        void refreshQuotesNow()
        timer = setInterval(() => void refreshQuotesNow(), REFRESH_MS)
      } catch (e) {
        setError(`Não foi possível abrir o banco de dados: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [refreshQuotesNow])

  const value = useMemo<AppData | null>(() => {
    if (!db || !data) return null
    const rp = replay(data.trades, data.events)
    const today = todayISO()
    const firstSale = rp.sales.reduce((m, s) => (monthOf(s.tradeDate) < m ? monthOf(s.tradeDate) : m), '2020-01')
    const tax = computeTax(rp.sales, rp.warnings, firstSale, monthOf(today))
    return {
      data, db, reload, refreshing, refreshQuotesNow,
      derived: { replay: rp, tax, darfs: computeDarfs(tax, data.payments, today), portfolio: buildPortfolio(rp.positions, data.quotes, data.manualAssets, data.dividends, today) },
    }
  }, [db, data, reload, refreshing, refreshQuotesNow])

  if (error) return <main className="main"><h1>Yield</h1><div className="note">{error}</div></main>
  if (!value) return <main className="main"><div className="muted">Abrindo dados…</div></main>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
