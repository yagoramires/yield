import { RefreshCw } from 'lucide-react'
import { useData } from '../state/DataProvider'

/** "agora", "há 5 min", "há 3 h", "ontem", "12/10": quando foi a última vez. */
export function ago(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return 'nunca'
  const min = Math.floor((nowMs - Date.parse(iso)) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  if (min < 24 * 60) return `há ${Math.floor(min / 60)} h`
  if (min < 48 * 60) return 'ontem'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}
const latest = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null

/** Quando cada fonte foi lida pela última vez, o erro se houver, e um botão que sincroniza tudo. Fica no menu, em todas as telas. */
export function SyncStatus() {
  const { data, gastos, binance, lastRefresh, refreshing, refreshQuotesNow } = useData()
  const g = gastos.data
  const hasPluggy = g.pluggyItems.length > 0
  const hasBinance = data.cryptoBalances.length > 0 || !!binance.error
  const busy = gastos.syncing || binance.syncing || refreshing
  const pluggyErr = gastos.lastSyncResult?.errors[0]
  const rows: { label: string; text: string; error?: string }[] = [
    ...(hasPluggy ? [{ label: 'Open Finance', text: gastos.syncing ? 'sincronizando…' : ago(latest(g.accounts.filter(a => a.source === 'pluggy').map(a => a.lastSyncAt))), error: pluggyErr && `${pluggyErr.label}: ${pluggyErr.message}` }] : []),
    ...(hasBinance ? [{ label: 'Binance', text: binance.syncing ? 'lendo…' : ago(latest(data.cryptoBalances.map(c => c.fetchedAt))), error: binance.error ?? undefined }] : []),
    { label: 'Cotações', text: refreshing ? 'atualizando…' : ago(lastRefresh?.at) },
  ]
  const syncAll = () => {
    if (hasPluggy) void gastos.syncNow()
    void (hasBinance ? binance.syncNow().then(refreshQuotesNow) : refreshQuotesNow())
  }
  return (
    <div className="sync-status">
      {rows.map(r => (
        <div key={r.label} className="sync-row" title={r.error}>
          <span className={`dot${r.error ? ' bad' : ''}`} aria-hidden />{r.label}<span className="t">{r.error ? 'erro' : r.text}</span>
        </div>
      ))}
      <button className="b ghost sm" disabled={busy} onClick={syncAll}><RefreshCw size={12} aria-hidden className={busy ? 'spin' : undefined} />{busy ? 'Sincronizando…' : 'Sincronizar tudo'}</button>
      {rows.find(r => r.error) && <div className="sync-err">{rows.find(r => r.error)!.error}</div>}
    </div>
  )
}
