export const BINANCE_BASE = 'https://api.binance.com'
const ACCOUNT = '/api/v3/account'
const EARN = ['/sapi/v1/simple-earn/flexible/position', '/sapi/v1/simple-earn/locked/position']
const ALLOWED = new Set([ACCOUNT, ...EARN].map(p => `GET ${p}`))

export class BinanceError extends Error {
  constructor(message: string, public kind: 'chave' | 'rede' | 'resposta') { super(message); this.name = 'BinanceError' }
}

// Única porta de saída: o Yield só lê saldos da Binance. Lança antes de qualquer fetch.
export function binanceRequest(method: string, url: string): URL {
  let u: URL
  try { u = new URL(url, BINANCE_BASE) } catch { throw new BinanceError('Chamada não permitida: o Yield só lê dados da Binance', 'resposta') }
  if (u.origin !== BINANCE_BASE || !ALLOWED.has(`${method} ${u.pathname}`)) throw new BinanceError('Chamada não permitida: o Yield só lê dados da Binance', 'resposta')
  return u
}

export async function sign(secret: string, query: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(query)))].map(b => b.toString(16).padStart(2, '0')).join('')
}

type Creds = { apiKey: string; secret: string }

async function signedGet(path: string, creds: Creds, fetchFn: typeof fetch, now: () => number): Promise<Response> {
  const query = `timestamp=${now()}&recvWindow=10000`
  const u = binanceRequest('GET', `${path}?${query}&signature=${await sign(creds.secret, query)}`)
  try { return await fetchFn(u.toString(), { method: 'GET', headers: { 'X-MBX-APIKEY': creds.apiKey }, signal: AbortSignal.timeout(30_000) }) } catch {
    throw new BinanceError('Sem conexão com a Binance', 'rede')
  }
}

const num = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN)

/**
 * Saldos da conta spot + Simple Earn. "LD<moeda>" no spot é o espelho do Earn flexível: fica de fora para não contar duas vezes.
 * Sem permissão para o Earn a chave ainda serve: `earnSkipped` avisa a tela.
 */
export async function fetchBinanceBalances(creds: Creds, fetchFn: typeof fetch, now: () => number = Date.now): Promise<{ balances: { asset: string; qty: number }[]; earnSkipped: boolean }> {
  const res = await signedGet(ACCOUNT, creds, fetchFn, now)
  if (res.status === 401 || res.status === 403) throw new BinanceError('Chave da Binance inválida ou sem permissão de leitura', 'chave')
  const body = res.ok ? await res.json().catch(() => null) : null
  if (!body || !Array.isArray(body.balances)) throw new BinanceError(`A Binance respondeu com erro (HTTP ${res.status})`, 'resposta')

  const total = new Map<string, number>()
  const add = (asset: unknown, qty: number) => { if (typeof asset === 'string' && qty > 0) total.set(asset, (total.get(asset) ?? 0) + qty) }
  for (const b of body.balances) if (!/^LD/.test(b?.asset)) add(b?.asset, num(b?.free) + num(b?.locked))

  let earnSkipped = false
  for (const path of EARN) {
    const r = await signedGet(path, creds, fetchFn, now)
    const rows = r.ok ? (await r.json().catch(() => null))?.rows : null
    if (!Array.isArray(rows)) { earnSkipped = true; continue }
    for (const row of rows) add(row?.asset, num(row?.totalAmount ?? row?.amount))
  }
  return { balances: [...total].map(([asset, qty]) => ({ asset, qty })), earnSkipped }
}
