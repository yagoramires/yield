import type { AccountKind } from '../db/gastosRepo'
import { normalizeTicker } from '../domain/ledger'
import type { AssetType, Cents, ISODate, Side } from '../domain/types'

export const PLUGGY_BASE = 'https://api.pluggy.ai'
const KEY_TTL_MS = 110 * 60 * 1000

export class PluggyError extends Error {
  constructor(message: string, public kind: 'credenciais' | 'item' | 'limite' | 'rede' | 'resposta') { super(message); this.name = 'PluggyError' }
}
export interface PluggyAccount { id: string; type: 'BANK' | 'CREDIT'; subtype: string; name: string; marketingName?: string | null; number?: string | null; itemId: string; balance?: number | null /* em reais: saldo da conta ou fatura do cartão */ }
export interface PluggyTxn { id: string; date: string; description: string; amount: number; type: 'DEBIT' | 'CREDIT'; status: 'PENDING' | 'POSTED'; operationType?: string | null; category?: string | null; creditCardMetadata?: { installmentNumber?: number; totalInstallments?: number } | null }
export interface PluggyInvestment { id: string; code?: string | null; name: string; type: string; subtype?: string | null; balance?: number | null /* saldo hoje, em reais */; amountOriginal?: number | null /* aplicado */ }
export interface PluggyInvestmentTxn { id: string; type: string; quantity?: number | null; value?: number | null; amount?: number | null; tradeDate?: string | null; date: string; expenses?: Record<string, number | null> | null }

const FORMAT = () => new PluggyError('A Pluggy devolveu dados fora do formato esperado', 'resposta')
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const str = (v: unknown) => typeof v === 'string' && v !== ''
const num = (v: unknown): v is number => typeof v === 'number' && isFinite(v)
const isDate = (v: unknown) => str(v) && !isNaN(Date.parse(v as string))

const ALLOWED = new Set(['GET /accounts', 'GET /v2/transactions', 'GET /investments'])
const INVESTMENT_TXNS = /^\/investments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/transactions$/i
const PAGE_SIZE = 500
const MAX_PAGES = 200

// Única porta de saída: o Yield só lê da Pluggy. Lança antes de qualquer fetch.
export function pluggyRequest(method: string, url: string): URL {
  let u: URL
  try { u = new URL(url, PLUGGY_BASE) } catch { throw new PluggyError('Chamada não permitida: o Yield só lê dados da Pluggy', 'resposta') }
  const allowed = ALLOWED.has(`${method} ${u.pathname}`) || (method === 'GET' && INVESTMENT_TXNS.test(u.pathname))
  if (u.origin !== PLUGGY_BASE || !allowed) throw new PluggyError('Chamada não permitida: o Yield só lê dados da Pluggy', 'resposta')
  return u
}

/** POST /auth com o Client ID e o Client Secret, feito fora do JavaScript (comando `pluggy_auth` do Rust, com limite próprio de 30 s). */
export type PluggyAuth = () => Promise<Response>

export function createPluggyClient(authFn: PluggyAuth, fetchFn: typeof fetch) {
  let key: { value: string; at: number } | null = null

  async function net(call: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
    const signal = AbortSignal.timeout(30_000)
    try { return await call(signal) } catch (e) {
      if (e instanceof PluggyError) throw e
      // o fetch da plugin-http rejeita com Error('Request cancelled') ou string do Rust: o sinal é a prova
      const timedOut = signal.aborted || (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'))
      throw new PluggyError(timedOut ? 'A Pluggy não respondeu a tempo; tente de novo' : 'Sem conexão com a Pluggy', 'rede')
    }
  }
  const send = (url: string, init: RequestInit) => { const u = pluggyRequest('GET', url); return net(signal => fetchFn(u.toString(), { ...init, method: 'GET', signal })) }
  const BAD_CREDS = () => new PluggyError('Client ID ou Client Secret inválidos', 'credenciais')

  async function auth(): Promise<string> {
    const res = await net(() => authFn())
    if (res.status === 401 || res.status === 403) throw BAD_CREDS()
    if (res.status === 429) throw new PluggyError('A Pluggy pediu para esperar; tente mais tarde', 'limite')
    const apiKey = res.ok ? (await res.json().catch(() => null))?.apiKey : null
    if (typeof apiKey !== 'string' || !apiKey) throw new PluggyError('Resposta inesperada da Pluggy', 'resposta')
    key = { value: apiKey, at: Date.now() }
    return apiKey
  }

  async function get(path: string, notFound?: (status: number) => PluggyError): Promise<{ results: unknown[]; next?: unknown; totalPages?: unknown }> {
    const cached = !!key && Date.now() - key.at < KEY_TTL_MS
    const call = async (k: string) => send(path, { headers: { 'X-API-KEY': k } })
    let res = await call(cached ? key!.value : await auth())
    if (res.status === 401 && cached) res = await call(await auth())
    if (res.status === 401 || res.status === 403) throw BAD_CREDS()
    if (notFound && (res.status === 404 || res.status === 400)) throw notFound(res.status)
    if (res.status === 429) throw new PluggyError('A Pluggy pediu para esperar; tente mais tarde', 'limite')
    if (!res.ok) throw new PluggyError(`A Pluggy respondeu com erro (HTTP ${res.status})`, 'resposta')
    const body = await res.json().catch(() => null)
    if (!body || !Array.isArray(body.results)) throw new PluggyError('Resposta inesperada da Pluggy', 'resposta')
    return body
  }

  async function allPages(path: string, notFound?: (status: number) => PluggyError): Promise<unknown[]> {
    const out: unknown[] = []
    for (let page = 1; ; page++) {
      const body = await get(`${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=${PAGE_SIZE}`, notFound)
      const total = body.totalPages
      if (typeof total !== 'number' || !Number.isInteger(total) || total < 0 || total > MAX_PAGES) throw FORMAT()
      out.push(...body.results)
      if (page >= total) return out
    }
  }

  return {
    async listAccounts(itemId: string): Promise<PluggyAccount[]> {
      const results = (await get(`/accounts?itemId=${encodeURIComponent(itemId)}`, () => new PluggyError(`Item ${itemId} não encontrado: confira o itemId`, 'item'))).results
      if (!results.every(a => isObj(a) && str(a.id) && (a.type === 'BANK' || a.type === 'CREDIT') && str(a.name))) throw FORMAT()
      return results as PluggyAccount[]
    },
    async listTransactions(accountId: string, dateFrom: ISODate, dateTo: ISODate): Promise<PluggyTxn[]> {
      const out: PluggyTxn[] = []
      let q: string | null = `?accountId=${encodeURIComponent(accountId)}&dateFrom=${dateFrom}&dateTo=${dateTo}`
      const seen = new Set<string>()
      while (q) {
        if (seen.has(q)) throw FORMAT() // `next` repetido: evita laço infinito
        seen.add(q)
        const body = await get(`/v2/transactions${q}`)
        if (!body.results.every(t => isObj(t) && str(t.id) && typeof t.description === 'string' && str(t.date) && !isNaN(Date.parse(t.date as string)) && typeof t.amount === 'number' && isFinite(t.amount))) throw FORMAT()
        out.push(...(body.results as PluggyTxn[]))
        q = typeof body.next === 'string' && body.next ? body.next : null
      }
      return out
    },
    async listInvestments(itemId: string): Promise<PluggyInvestment[]> {
      const results = await allPages(`/investments?itemId=${encodeURIComponent(itemId)}`, s => new PluggyError(`a Pluggy não tem investimentos para este banco (HTTP ${s})`, 'resposta'))
      if (!results.every(i => isObj(i) && str(i.id) && typeof i.type === 'string' && typeof i.name === 'string')) throw FORMAT()
      return results as PluggyInvestment[]
    },
    async listInvestmentTransactions(investmentId: string): Promise<PluggyInvestmentTxn[]> {
      const results = await allPages(`/investments/${encodeURIComponent(investmentId)}/transactions`)
      // operação sem quantidade ou valor é pulada em toTradeRow; aqui só o formato básico derruba o item
      if (!results.every(t => isObj(t) && str(t.id) && typeof t.type === 'string' && isDate(t.tradeDate || t.date))) throw FORMAT()
      return results as PluggyInvestmentTxn[]
    },
  }
}

const TICKER = /^[A-Z]{4}\d{1,2}F?$/
const SUBTYPE: Record<string, AssetType> = { STOCK: 'Ação', REAL_ESTATE_FUND: 'FII', BDR: 'BDR', ETF: 'ETF' }

/** Ação, FII, BDR ou ETF negociado em bolsa; null para o resto (opção, derivativo, renda fixa, fundo). assetType null: a Pluggy não disse o subtipo. */
export function rendaVariavel(i: PluggyInvestment): { ticker: string; assetType: AssetType | null } | null {
  if (i.type !== 'EQUITY' && i.type !== 'ETF') return null
  const assetType = i.type === 'ETF' ? 'ETF' : i.subtype ? SUBTYPE[i.subtype] ?? null : null
  if (i.type === 'EQUITY' && i.subtype && !assetType) return null
  // `code` às vezes é o ISIN; o nome começa pelo ticker
  const code = (i.code ?? '').trim().toUpperCase(), first = i.name.trim().split(/\s+/)[0].toUpperCase()
  const raw = TICKER.test(code) ? code : TICKER.test(first) ? first : null
  return raw ? { ticker: normalizeTicker(raw), assetType } : null
}

export function toTradeRow(t: PluggyInvestmentTxn): { date: ISODate; side: Side; qty: number; priceCents: Cents; feesCents: Cents; irrfCents: Cents } | null {
  if (t.type !== 'BUY' && t.type !== 'SELL') return null
  const qty = t.quantity
  if (!num(qty) || qty <= 0) return null
  const price = num(t.value) && t.value > 0 ? t.value : Math.abs(t.amount ?? 0) / qty
  if (!(price > 0)) return null
  // iofProvision é a previsão do IOF, não o pago: somá-la contaria o IOF duas vezes
  const { incomeTax, iofProvision: _, ...fees } = t.expenses ?? {}
  return {
    date: pluggyDate(t.tradeDate || t.date), side: t.type === 'BUY' ? 'C' : 'V', qty,
    priceCents: Math.round(price * 100),
    feesCents: Math.round(Object.values(fees).reduce<number>((s, v) => s + (num(v) ? v : 0), 0) * 100),
    irrfCents: num(incomeTax) ? Math.round(incomeTax * 100) : 0,
  }
}

/** `offsetMin`: minutos a leste do UTC (Brasília: −180); por padrão, o fuso da máquina naquele instante. */
export function pluggyDate(iso: string, offsetMin = -new Date(iso).getTimezoneOffset()): ISODate {
  const d = new Date(iso)
  // Meia-noite UTC (Z ou +00:00) é data sem hora: o próprio dia.
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) return d.toISOString().slice(0, 10)
  return new Date(d.getTime() + offsetMin * 60_000).toISOString().slice(0, 10)
}

export function toTxnRow(t: PluggyTxn, kind: AccountKind) {
  const cents = Math.round(t.amount * 100)
  const { installmentNumber: n, totalInstallments: total } = t.creditCardMetadata ?? {}
  return {
    date: pluggyDate(t.date),
    description: t.description.trim(),
    amountCents: (kind === 'cartao' ? -cents : cents) + 0 as Cents,
    pending: t.status === 'PENDING',
    installment: typeof n === 'number' && typeof total === 'number' && total > 1 ? `${n}/${total}` : null,
    operationType: t.operationType ?? null,
    pluggyCategory: t.category ?? null,
  }
}
