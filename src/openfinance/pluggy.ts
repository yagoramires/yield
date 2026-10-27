import type { AccountKind } from '../db/gastosRepo'
import type { Cents, ISODate } from '../domain/types'

export const PLUGGY_BASE = 'https://api.pluggy.ai'
const KEY_TTL_MS = 110 * 60 * 1000

export class PluggyError extends Error {
  constructor(message: string, public kind: 'credenciais' | 'item' | 'limite' | 'rede' | 'resposta') { super(message); this.name = 'PluggyError' }
}
export interface PluggyAccount { id: string; type: 'BANK' | 'CREDIT'; subtype: string; name: string; marketingName?: string | null; number?: string | null; itemId: string }
export interface PluggyTxn { id: string; date: string; description: string; amount: number; type: 'DEBIT' | 'CREDIT'; status: 'PENDING' | 'POSTED'; operationType?: string | null; creditCardMetadata?: { installmentNumber?: number; totalInstallments?: number } | null }

const FORMAT = () => new PluggyError('A Pluggy devolveu dados fora do formato esperado', 'resposta')
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const str = (v: unknown) => typeof v === 'string' && v !== ''

const ALLOWED = new Set(['POST /auth', 'GET /accounts', 'GET /v2/transactions'])

// Única porta de saída: o Yield só lê da Pluggy. Lança antes de qualquer fetch.
export function pluggyRequest(method: string, url: string): URL {
  let u: URL
  try { u = new URL(url, PLUGGY_BASE) } catch { throw new PluggyError('Chamada não permitida: o Yield só lê dados da Pluggy', 'resposta') }
  if (u.origin !== PLUGGY_BASE || !ALLOWED.has(`${method} ${u.pathname}`)) throw new PluggyError('Chamada não permitida: o Yield só lê dados da Pluggy', 'resposta')
  return u
}

export function createPluggyClient(creds: { clientId: string; clientSecret: string }, fetchFn: typeof fetch) {
  let key: { value: string; at: number } | null = null

  async function send(method: 'GET' | 'POST', url: string, init: RequestInit = {}): Promise<Response> {
    const u = pluggyRequest(method, url)
    const signal = AbortSignal.timeout(30_000)
    try { return await fetchFn(u.toString(), { ...init, method, signal }) } catch (e) {
      // o fetch da plugin-http rejeita com Error('Request cancelled') ou string do Rust: o sinal é a prova
      const timedOut = signal.aborted || (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'))
      throw new PluggyError(timedOut ? 'A Pluggy não respondeu a tempo; tente de novo' : 'Sem conexão com a Pluggy', 'rede')
    }
  }
  const BAD_CREDS = () => new PluggyError('Client ID ou Client Secret inválidos', 'credenciais')

  async function auth(): Promise<string> {
    const res = await send('POST', '/auth', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds) })
    if (res.status === 401 || res.status === 403) throw BAD_CREDS()
    if (res.status === 429) throw new PluggyError('A Pluggy pediu para esperar; tente mais tarde', 'limite')
    const apiKey = res.ok ? (await res.json().catch(() => null))?.apiKey : null
    if (typeof apiKey !== 'string' || !apiKey) throw new PluggyError('Resposta inesperada da Pluggy', 'resposta')
    key = { value: apiKey, at: Date.now() }
    return apiKey
  }

  async function get(path: string, itemId?: string): Promise<{ results: unknown[]; next?: unknown }> {
    const cached = !!key && Date.now() - key.at < KEY_TTL_MS
    const call = async (k: string) => send('GET', path, { headers: { 'X-API-KEY': k } })
    let res = await call(cached ? key!.value : await auth())
    if (res.status === 401 && cached) res = await call(await auth())
    if (res.status === 401 || res.status === 403) throw BAD_CREDS()
    if (itemId && (res.status === 404 || res.status === 400)) throw new PluggyError(`Item ${itemId} não encontrado: confira o itemId`, 'item')
    if (res.status === 429) throw new PluggyError('A Pluggy pediu para esperar; tente mais tarde', 'limite')
    if (!res.ok) throw new PluggyError(`A Pluggy respondeu com erro (HTTP ${res.status})`, 'resposta')
    const body = await res.json().catch(() => null)
    if (!body || !Array.isArray(body.results)) throw new PluggyError('Resposta inesperada da Pluggy', 'resposta')
    return body
  }

  return {
    async listAccounts(itemId: string): Promise<PluggyAccount[]> {
      const results = (await get(`/accounts?itemId=${encodeURIComponent(itemId)}`, itemId)).results
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
  }
}

export function pluggyDate(iso: string): ISODate {
  const d = new Date(iso)
  // Meia-noite UTC (Z ou +00:00) é data sem hora: o próprio dia.
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) return d.toISOString().slice(0, 10)
  // Brasília não tem horário de verão: UTC−3 fixo.
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10)
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
  }
}
