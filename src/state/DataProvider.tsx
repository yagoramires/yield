import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { openDb, type Db } from '../db/client'
import { migrateOnce } from '../db/migrate'
import { MIGRATIONS } from '../db/migrations'
import { useProfiles } from '../profiles/Gate'
import { loadAll, renormalizeBrokers, type Dataset, type ManualAsset } from '../db/repo'
import { computeDarfs, type DarfResult } from '../domain/darf'
import { replay, type ReplayResult } from '../domain/ledger'
import { buildPortfolio, type Portfolio } from '../domain/portfolio'
import { rfHoldings } from '../domain/rendaFixa'
import { computeTax, type TaxMonth } from '../domain/tax'
import { REFRESH_MS, refreshQuotes, repairCryptoSymbols, yahooSymbol } from '../quotes/yahoo'
import { monthOf } from '../domain/money'
import { loadGastos, type Category, type GastosData, type Txn } from '../db/gastosRepo'
import { categorize } from '../domain/gastos'
import { pairTransfers, type TransferLink } from '../domain/transferencias'
import { detectSubscriptions, type Subscription } from '../domain/assinaturas'
import type { Month } from '../domain/types'
import { getPluggyAuth } from '../openfinance/secrets'
import { vaultStatus } from '../secrets/vault'
import { fetchBinanceBalances } from '../cripto/binance'
import { getBinanceSend } from '../cripto/secrets'
import { saveCryptoBalances } from '../db/rendaFixaRepo'
import { syncCryptoCosts } from '../cripto/aportado'
import { binanceErrorText, costSummaryText } from '../pages/configuracoes/build'
import { SYNC_EVERY_MS, syncPluggy, type SyncResult } from '../openfinance/sync'
import { needsSync, NO_FILTER, type TxnFilter } from '../pages/lancamentos/build'
import { loadOrcamento, type OrcamentoData } from '../db/orcamentoRepo'
import { bankAssets, reservaInvestments } from '../domain/bancoInvest'
import { defaultMonth } from '../pages/orcamento/build'

export interface Gastos {
  data: GastosData
  categorize(t: Txn): Category | null
  transfers: Map<string, TransferLink> // id do lançamento → o outro lado do par entre contas suas
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
  derived: { replay: ReplayResult; tax: TaxMonth[]; darfs: DarfResult; portfolio: Portfolio; bank: ManualAsset[] /* investimentos do banco na Carteira, só leitura */ }
  db: Db
  reload(): Promise<void>
  refreshing: boolean
  refreshQuotesNow(): Promise<void>
  lastRefresh: { at: string; ok: string[]; failed: string[] } | null
  gastos: Gastos
  orcamento: Orcamento
  binance: { syncing: boolean; error: string | null; earnSkipped: boolean; syncNow(): Promise<void>; reset(): void
    cost: { loading: boolean; note: string | null; progress: string | null }; fetchCost(): Promise<void> /* aportado pelo histórico: só quando o dono pede */ }
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
  const { dbFile } = useProfiles().profile
  const [db, setDb] = useState<Db | null>(null)
  const [data, setData] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<AppData['lastRefresh']>(null)
  const [gastosData, setGastosData] = useState<GastosData | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null)
  const [binance, setBinance] = useState<{ syncing: boolean; error: string | null; earnSkipped: boolean }>({ syncing: false, error: null, earnSkipped: false })
  const [costState, setCostState] = useState<{ loading: boolean; note: string | null; progress: string | null }>({ loading: false, note: null, progress: null })
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
  const syncNow = useCallback(async () => {
    const d = dbRef.current
    if (!d || syncingRef.current) return
    syncingRef.current = true; setSyncing(true)
    const fail = (message: string): SyncResult => ({ accounts: 0, inserted: 0, removed: 0, errors: [{ itemId: '', label: 'Open Finance', message }], investments: [] })
    try {
      const auth = await getPluggyAuth()
      const items = (await loadGastos(d)).pluggyItems
      if (!auth) setLastSyncResult(fail('Sem credenciais da Pluggy: configure em Configurações › Contas conectadas.'))
      else if (!items.length) setLastSyncResult(fail('Nenhum banco cadastrado em Configurações › Contas conectadas.'))
      else setLastSyncResult(await syncPluggy(d, auth, tauriFetch as typeof fetch, todayISO()))
      const [ds, g] = await Promise.all([loadAll(d), loadGastos(d)]) // compras e vendas da Pluggy mudam a carteira
      setData(ds); setGastosData(g)
    } catch (e) { setLastSyncResult(fail(`Não foi possível sincronizar: ${e instanceof Error ? e.message : String(e)}`)) }
    syncingRef.current = false; setSyncing(false)
  }, [])

  // Saldos da Binance: só leitura; erro fica no aviso do card Cripto e os últimos saldos continuam guardados.
  const binanceFailed = useRef(false) // falhou (sem chave, Keychain recusado, erro): o ciclo automático para até a pessoa sincronizar à mão
  const pluggyAuto = useRef({ last: 0, off: false }) // última tentativa automática do Open Finance e se o Keychain foi recusado
  const syncBinance = useCallback(async () => {
    const d = dbRef.current
    if (!d) return
    setBinance(b => ({ ...b, syncing: true }))
    try {
      const send = await getBinanceSend()
      if (!send) { binanceFailed.current = true; return setBinance({ syncing: false, error: 'Sem chave da Binance: configure em Configurações › Contas conectadas.', earnSkipped: false }) }
      const r = await fetchBinanceBalances(send)
      await saveCryptoBalances(d, r.balances, new Date().toISOString())
      setData(await loadAll(d))
      binanceFailed.current = false
      setBinance({ syncing: false, error: null, earnSkipped: r.earnSkipped })
    } catch (e) { binanceFailed.current = true; setBinance({ syncing: false, error: binanceErrorText(e), earnSkipped: false }) }
  }, [])

  // Histórico inteiro da Binance (centenas de chamadas): fonte que falha vira aviso e o resto é gravado.
  const fetchCryptoCost = useCallback(async () => {
    const d = dbRef.current
    if (!d) return
    setCostState({ loading: true, note: null, progress: null })
    try {
      const send = await getBinanceSend()
      if (!send) return setCostState({ loading: false, note: 'Sem chave da Binance: configure em Configurações › Contas conectadas.', progress: null })
      const r = await syncCryptoCosts(d, send, tauriFetch as typeof fetch, undefined, undefined, progress => setCostState(s => ({ ...s, progress })))
      setData(await loadAll(d))
      setCostState({ loading: false, note: costSummaryText(r), progress: null })
    } catch (e) { setCostState({ loading: false, note: binanceErrorText(e), progress: null }) }
  }, [])

  // Falha de cotação nunca derruba a tela: só deixa as cotações antigas.
  const refreshQuotesNow = useCallback(async () => {
    const d = dbRef.current
    if (!d) return
    setRefreshing(true)
    try {
      const ds = await loadAll(d)
      const { positions } = replay(ds.trades, ds.events)
      const symbols = new Set([...positions.filter(p => p.qty > 0).map(p => yahooSymbol(p.ticker)), ...ds.manualAssets.flatMap(a => (a.quoteSymbol ? [a.quoteSymbol] : [])),
        // exterior é cotado em US$ e convertido pelo dólar do dia; cripto da Binance pela cotação em real
        ...(ds.manualAssets.some(a => a.currency === 'USD') || ds.cryptoBalances.some(c => c.qty > 0) ? ['BRL=X'] : []), ...ds.cryptoBalances.flatMap(c => (c.qty > 0 && c.asset !== 'BRL' ? [`${c.asset}-USD`] : []))])
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
        // todo banco de perfil é migrado aqui, pelo `meta.schema_version` (o Rust não migra nenhum)
        const d = await openDb(dbFile)
        await migrateOnce(dbFile, d, MIGRATIONS)
        if (cancelled) return
        dbRef.current = d
        setDb(d)
        await renormalizeBrokers(d)
        await repairCryptoSymbols(d)
        const [ds, g, o] = await Promise.all([loadAll(d), loadGastos(d), loadOrcamento(d)])
        setData(ds); setGastosData(g); setOrcData(o)
        // a Binance só é lida na abertura de quem já salvou saldos (evita pedir o Keychain a quem não usa)
        void (ds.cryptoBalances.some(c => c.qty > 0) ? syncBinance().then(refreshQuotesNow) : refreshQuotesNow())
        if (needsSync(g, Date.now())) {
          pluggyAuto.current.last = Date.now()
          vaultStatus().then(
            s => { if (s.pluggy && !cancelled) void syncNow() },
            e => setLastSyncResult({ accounts: 0, inserted: 0, removed: 0, errors: [{ itemId: '', label: 'Open Finance', message: `Não foi possível ler as credenciais: ${e instanceof Error ? e.message : String(e)}` }], investments: [] }),
          )
        }
        // com o app aberto: cotações (e a Binance, de quem usa) a cada 15 min; o Open Finance quando passar do intervalo dele
        // (item com erro na Pluggy segue pedindo sync: no máximo uma tentativa a cada SYNC_EVERY_MS; Keychain recusado para o automático)
        timer = setInterval(async () => {
          const cur = await loadAll(d).catch(() => null)
          void (!binanceFailed.current && cur?.cryptoBalances.some(c => c.qty > 0) ? syncBinance().then(refreshQuotesNow) : refreshQuotesNow())
          const gNow = await loadGastos(d).catch(() => null)
          const auto = pluggyAuto.current
          if (gNow && !auto.off && Date.now() - auto.last > SYNC_EVERY_MS && needsSync(gNow, Date.now())) {
            auto.last = Date.now()
            vaultStatus().then(s => { if (s.pluggy && !cancelled) void syncNow() }, () => { auto.off = true })
          }
        }, REFRESH_MS)
      } catch (e) {
        if (!cancelled) setError(`Não foi possível abrir o banco de dados: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [dbFile, refreshQuotesNow, syncNow, syncBinance])

  // replay, imposto e DARF só dependem da carteira: editar o orçamento não refaz essas contas
  const core = useMemo(() => {
    if (!data) return null
    const rp = replay(data.trades, data.events)
    const today = todayISO()
    const firstSale = rp.sales.reduce((m, s) => (monthOf(s.tradeDate) < m ? monthOf(s.tradeDate) : m), '2020-01')
    const from = data.openingLoss && data.openingLoss.month < firstSale ? data.openingLoss.month : firstSale
    const tax = computeTax(rp.sales, rp.warnings, from, monthOf(today), data.openingLoss)
    return { replay: rp, tax, darfs: computeDarfs(tax, data.payments, today), today }
  }, [data])
  const derived = useMemo(() => {
    if (!data || !core) return null
    // investimentos do banco (Pluggy) entram como itens só de leitura: só de bancos ainda conectados e fora os ligados a uma reserva;
    // com títulos abertos da B3, o que a Posição já mostra (CDB, LCI, Tesouro…) não entra de novo
    const live = data.bankInvestments.filter(b => gastosData?.pluggyItems.some(i => i.itemId === b.itemId) ?? true)
    const reserved = new Set([...reservaInvestments(orcData?.reservas ?? [], live, orcData?.reservaLinks ?? {}).values()].flat().map(b => b.id))
    const rf = rfHoldings(data.rfMoves, data.rfPositions)
    const bank = bankAssets(live, reserved, rf.some(h => !h.closed))
    return { replay: core.replay, tax: core.tax, darfs: core.darfs, bank,
      portfolio: buildPortfolio(core.replay.positions, data.quotes, [...data.manualAssets, ...bank], data.dividends, core.today, { rf, crypto: data.cryptoBalances }) }
  }, [data, core, gastosData?.pluggyItems, orcData?.reservas, orcData?.reservaLinks])

  // Separado do derived de investimentos: trocar mês ou filtro não refaz o replay.
  const gastosDerived = useMemo(() => {
    if (!gastosData) return null
    const accounts = new Map(gastosData.accounts.map(a => [a.id, a]))
    const transfers = pairTransfers(gastosData.txns, gastosData.accounts, gastosData.overrides)
    const of = (t: Txn) => {
      const a = accounts.get(t.accountId)
      return a ? categorize(t, a, gastosData.rules, gastosData.overrides, gastosData.categories, { paired: transfers.has(t.id), ownerNames: gastosData.ownerNames, companyNames: gastosData.companyNames }) : null
    }
    const byId = new Map(gastosData.txns.map(t => [t.id, of(t)]))
    const cat = (t: Txn) => (byId.has(t.id) ? byId.get(t.id)! : of(t))
    return { categorize: cat, transfers, subscriptions: detectSubscriptions(gastosData.txns, cat, gastosData.dismissed, todayISO()) }
  }, [gastosData])

  const value = useMemo<AppData | null>(() => {
    if (!db || !data || !derived || !gastosData || !gastosDerived || !orcData) return null
    return {
      data, db, reload, refreshing, refreshQuotesNow, lastRefresh, derived,
      gastos: { data: gastosData, ...gastosDerived, syncing, lastSyncResult, syncNow, month, setMonth, filter, setFilter },
      orcamento: { data: orcData, month: orcMonth ?? defaultMonth(orcData.months, todayISO()), setMonth: setOrcMonth, reload: reloadOrcamento },
      binance: { ...binance, syncNow: syncBinance, reset: () => { setBinance({ syncing: false, error: null, earnSkipped: false }); setCostState({ loading: false, note: null, progress: null }) }, cost: costState, fetchCost: fetchCryptoCost },
    }
  }, [db, data, derived, gastosData, gastosDerived, reload, refreshing, refreshQuotesNow, lastRefresh, syncing, lastSyncResult, syncNow, month, filter, orcData, orcMonth, reloadOrcamento, binance, syncBinance, costState, fetchCryptoCost])

  if (error) return <main className="main"><h1>Yield</h1><div className="note" style={{ marginTop: 10 }}>{error}</div></main>
  if (!value) return <main className="main"><div className="muted">Abrindo dados…</div></main>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
