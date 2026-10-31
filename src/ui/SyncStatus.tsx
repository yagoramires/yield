import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useData } from '../state/DataProvider'

/** "agora", "há 5 min", "há 3 h", "ontem", "12/10": quando foi a última vez. */
export function ago(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return 'nunca'
  const min = Math.floor((nowMs - Date.parse(iso)) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  if (min < 24 * 60) return `há ${Math.floor(min / 60)} h`
  if (min < 48 * 60) return 'ontem'
  const d = new Date(iso) // gravado em UTC; a data mostrada é a local
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** "30/10 às 14:05" no horário local a partir de um ISO em UTC. */
export function localStamp(iso: string): string {
  const d = new Date(iso), p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}`
}
/** A linha que fica no menu: a fonte mais desatualizada manda (fonte nunca lida não conta); erro e sincronizando vêm antes. */
export function syncSummary(rows: { at: string | null; error?: string }[], busy: boolean, nowMs = Date.now()): string {
  if (busy) return 'Sincronizando…'
  if (rows.some(r => r.error)) return 'Erro ao sincronizar'
  const oldest = rows.map(r => r.at).filter((x): x is string => !!x).sort()[0]
  return oldest ? `Sincronizado ${ago(oldest, nowMs)}` : 'Ainda não sincronizado'
}

const latest = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null

/** Quando cada fonte foi lida pela última vez, o erro se houver, e um botão que sincroniza tudo. Fica no menu, em todas as telas. */
export function SyncStatus({ mini = false }: { mini?: boolean }) {
  const { data, gastos, binance, lastRefresh, refreshing, refreshQuotesNow } = useData()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  // popover: o foco entra nele ao abrir; fecha ao clicar fora ou com Esc (só ele)
  useEffect(() => {
    if (!open) return
    box.current?.querySelector<HTMLElement>('.sync-pop')?.focus() // o próprio popover, não o "Sincronizar tudo": um Enter solto não dispara nada
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', esc, true) }
  }, [open])
  const g = gastos.data
  const hasPluggy = g.pluggyItems.length > 0
  const hasBinance = data.cryptoBalances.length > 0 || !!binance.error
  const busy = gastos.syncing || binance.syncing || refreshing
  const pluggyErr = gastos.lastSyncResult?.errors[0]
  const pluggyAt = latest(g.accounts.filter(a => a.source === 'pluggy').map(a => a.lastSyncAt))
  const binanceAt = latest(data.cryptoBalances.map(c => c.fetchedAt))
  // a última cotação gravada vale também logo depois de abrir o app, antes da primeira atualização
  const quotesAt = lastRefresh?.at ?? latest(data.quotes.filter(q => q.source !== 'manual').map(q => q.fetchedAt))
  const rows: { label: string; text: string; at: string | null; error?: string }[] = [
    ...(hasPluggy ? [{ label: 'Open Finance', at: pluggyAt, text: gastos.syncing ? 'sincronizando…' : ago(pluggyAt), error: pluggyErr && `${pluggyErr.label}: ${pluggyErr.message}` }] : []),
    ...(hasBinance ? [{ label: 'Binance', at: binanceAt, text: binance.syncing ? 'lendo…' : ago(binanceAt), error: binance.error ?? undefined }] : []),
    { label: 'Cotações', at: quotesAt, text: refreshing ? 'atualizando…' : ago(quotesAt) },
  ]
  const syncAll = () => {
    if (hasPluggy) void gastos.syncNow()
    void (hasBinance ? binance.syncNow().then(refreshQuotesNow) : refreshQuotesNow())
  }
  const err = rows.find(r => r.error)
  // menu recolhido: só o botão, com o resumo no título e uma bolinha vermelha se alguma fonte falhou
  if (mini) return (
    <div className="sync-status">
      <button className="icon-btn sq sync-mini" aria-label={busy ? 'Sincronizando' : 'Sincronizar tudo'} disabled={busy} onClick={syncAll}
        title={rows.map(r => `${r.label}: ${r.error ? `erro (${r.error})` : r.text}`).join('\n')}>
        <RefreshCw size={14} aria-hidden className={busy ? 'spin' : undefined} />{err && <span className="dot bad" aria-hidden />}
      </button>
    </div>
  )
  // uma linha no menu; o detalhe de cada fonte abre num popover para cima
  return (
    <div className="sync-status" ref={box} onBlur={e => { if (open && e.relatedTarget && !box.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
      {open && (
        <div className="sync-pop" role="dialog" aria-label="Sincronização" tabIndex={-1}>
          {rows.map(r => (
            <div key={r.label} className="sync-row" title={r.error}>
              <span className={`dot${r.error ? ' bad' : ''}`} aria-hidden />{r.label}<span className="t">{r.error ? 'erro' : r.text}</span>
            </div>
          ))}
          {err && <div className="sync-err">{err.error}</div>}
          <button className="b ghost sm" disabled={busy} onClick={syncAll}><RefreshCw size={12} aria-hidden className={busy ? 'spin' : undefined} />{busy ? 'Sincronizando…' : 'Sincronizar tudo'}</button>
        </div>
      )}
      <div className="sync-line">
        <button ref={trigger} className="sync-sum" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
          <span className={`dot${err ? ' bad' : ''}`} aria-hidden /><span className="lbl">{syncSummary(rows, busy)}</span>
        </button>
        <button className="icon-btn sq" aria-label="Sincronizar tudo" title="Sincronizar tudo" disabled={busy} onClick={syncAll}><RefreshCw size={13} aria-hidden className={busy ? 'spin' : undefined} /></button>
      </div>
    </div>
  )
}
