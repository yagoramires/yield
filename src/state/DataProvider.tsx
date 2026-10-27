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
import { loadGastos, type Category, type GastosData, type Txn } from '../db/gastosRepo'
import { categorize } from '../domain/gastos'
import { detectSubscriptions, type Subscription } from '../domain/assinaturas'
import type { Month } from '../domain/types'
import { getPluggyCredentials } from '../openfinance/secrets'
import { syncPluggy, type SyncResult } from '../openfinance/sync'
import { needsSync, NO_FILTER, type TxnFilter } from '../pages/lancamentos/build'
import { loadOrcamento, type OrcamentoData } from '../db/orcamentoRepo'
import { defaultMonth } from '../pages/orcamento/build'

export interface Gastos {
  data: GastosData
  categorize(t: Txn): Category | null
  subscriptions: Subscription[]
  syncing: boolean
  lastSyncResult: SyncResult | null
  syncNow(): Promise<void>
  month: Month
  setMonth(m: Month): void
  filter: TxnFilter
  setFilter(f: TxnFilter): void
}

export interface Orcamento {
  data: OrcamentoData
  month: Month
  setMonth(m: Month): void
  reload(): Promise<void>
}

export interface AppData {
  data: Dataset
  derived: { replay: ReplayResult; tax: TaxMonth[]; darfs: DarfResult; portfolio: Portfolio }
  db: Db
  reload(): Promise<void>
  refreshing: boolean
  refreshQuotesNow(): Promise<void>
  lastRefresh: { at: string; ok: string[]; failed: string[] } | null
  gastos: Gastos
  orcamento: Orcamento
}

const Ctx = createContext<AppData | null>(null)

export function useData(): AppData {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData fora do DataProvider')
  return v
}

export const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Db | null>(null)
  const [data, setData] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<AppData['lastRefresh']>(null)
  const [gastosData, setGastosData] = useState<GastosData | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null)
  const [month, setMonth] = useState<Month>(monthOf(todayISO()))
  const [filter, setFilter] = useState<TxnFilter>(NO_FILTER)
  const [orcData, setOrcData] = useState<OrcamentoData | null>(null)
  const [orcMonth, setOrcMonth] = useState<Month | null>(null) // null: defaultMonth até o usuário navegar
  const dbRef = useRef<Db | null>(null)
  const syncingRef = useRef(false)

  const reload = useCallback(async () => {
    const d = dbRef.current
    if (!d) return
    const [ds, g, o] = await Promise.all([loadAll(d), loadGastos(d), loadOrcamento(d)])
    setData(ds); setGastosData(g); setOrcData(o)
  }, [])

  const reloadOrcamento = useCallback(async () => {
    if (dbRef.current) setOrcData(await loadOrcamento(dbRef.current))
  }, [])

  // Erros (inclusive credencial ausente) vão para lastSyncResult.errors e aparecem na linha de avisos.
  // `known`: credenciais já lidas na abertura, para não pedir o Keychain duas vezes.
  const syncNow = useCallback(async (known?: { clientId: string; clientSecret: string }) => {
    const d = dbRef.current
    if (!d || syncingRef.current) return
    syncingRef.current = true; setSyncing(true)
    const fail = (message: string): SyncResult => ({ accounts: 0, inserted: 0, removed: 0, errors: [{ itemId: '', label: 'Open Finance', message }] })
    try {
      const creds = known ?? (await getPluggyCredentials())
      const items = (await loadGastos(d)).pluggyItems
      if (!creds) setLastSyncResult(fail('Sem credenciais da Pluggy: configure em Configurações › Open Finance.'))
      else if (!items.length) setLastSyncResult(fail('Nenhum banco cadastrado em Configurações › Open Finance.'))
      else setLastSyncResult(await syncPluggy(d, creds, tauriFetch as typeof fetch, todayISO()))
      setGastosData(await loadGastos(d))
    } catch (e) { setLastSyncResult(fail(`Não foi possível sincronizar: ${e instanceof Error ? e.message : String(e)}`)) }
    syncingRef.current = false; setSyncing(false)
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
      setLastRefresh({ at: new Date().toISOString(), ...(await refreshQuotes(d, [...symbols], tauriFetch as typeof fetch)) })
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
        const [ds, g, o] = await Promise.all([loadAll(d), loadGastos(d), loadOrcamento(d)])
        setData(ds); setGastosData(g); setOrcData(o)
        void refreshQuotesNow()
        if (needsSync(g, Date.now())) {
          getPluggyCredentials().then(
            c => { if (c && !cancelled) void syncNow(c) },
            e => setLastSyncResult({ accounts: 0, inserted: 0, removed: 0, errors: [{ itemId: '', label: 'Open Finance', message: `Não foi possível ler as credenciais: ${e instanceof Error ? e.message : String(e)}` }] }),
          )
        }
        timer = setInterval(() => void refreshQuotesNow(), REFRESH_MS)
      } catch (e) {
        setError(`Não foi possível abrir o banco de dados: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [refreshQuotesNow, syncNow])

  const derived = useMemo(() => {
    if (!data) return null
    const rp = replay(data.trades, data.events)
    const today = todayISO()
    const firstSale = rp.sales.reduce((m, s) => (monthOf(s.tradeDate) < m ? monthOf(s.tradeDate) : m), '2020-01')
    const tax = computeTax(rp.sales, rp.warnings, firstSale, monthOf(today))
    return { replay: rp, tax, darfs: computeDarfs(tax, data.payments, today), portfolio: buildPortfolio(rp.positions, data.quotes, data.manualAssets, data.dividends, today) }
  }, [data])

  // Separado do derived de investimentos: trocar mês ou filtro não refaz o replay.
  const gastosDerived = useMemo(() => {
    if (!gastosData) return null
    const accounts = new Map(gastosData.accounts.map(a => [a.id, a]))
    const of = (t: Txn) => { const a = accounts.get(t.accountId); return a ? categorize(t, a, gastosData.rules, gastosData.overrides, gastosData.categories) : null }
    const byId = new Map(gastosData.txns.map(t => [t.id, of(t)]))
    const cat = (t: Txn) => (byId.has(t.id) ? byId.get(t.id)! : of(t))
    return { categorize: cat, subscriptions: detectSubscriptions(gastosData.txns, cat, gastosData.dismissed, todayISO()) }
  }, [gastosData])

  const value = useMemo<AppData | null>(() => {
    if (!db || !data || !derived || !gastosData || !gastosDerived || !orcData) return null
    return {
      data, db, reload, refreshing, refreshQuotesNow, lastRefresh, derived,
      gastos: { data: gastosData, ...gastosDerived, syncing, lastSyncResult, syncNow, month, setMonth, filter, setFilter },
      orcamento: { data: orcData, month: orcMonth ?? defaultMonth(orcData.months, todayISO()), setMonth: setOrcMonth, reload: reloadOrcamento },
    }
  }, [db, data, derived, gastosData, gastosDerived, reload, refreshing, refreshQuotesNow, lastRefresh, syncing, lastSyncResult, syncNow, month, filter, orcData, orcMonth, reloadOrcamento])

  if (error) return <main className="main"><h1>Yield</h1><div className="note">{error}</div></main>
  if (!value) return <main className="main"><div className="muted">Abrindo dados…</div></main>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
