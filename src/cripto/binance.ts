import type { Swap } from './aportado'

export const BINANCE_BASE = 'https://api.binance.com'
const ACCOUNT = '/api/v3/account'
const EARN = ['/sapi/v1/simple-earn/flexible/position', '/sapi/v1/simple-earn/locked/position']
const FIAT = '/sapi/v1/fiat/payments'
const CONVERT = '/sapi/v1/convert/tradeFlow'
const TRADES = '/api/v3/myTrades'
const ALLOWED = new Set([ACCOUNT, ...EARN, FIAT, CONVERT, TRADES].map(p => `GET ${p}`))

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

/** GET da URL (sem assinatura) assinado no Rust com a chave salva (comando `binance_get`): a secret não chega ao JavaScript. */
export type BinanceSend = (url: string) => Promise<Response>

async function signedGet(path: string, send: BinanceSend, now: () => number, params = ''): Promise<Response> {
  // shortcut: o Earn pagina (padrão 10 linhas); 100 é o máximo de uma página, paginar se alguém tiver mais produtos
  const query = `${params}${EARN.includes(path) ? 'size=100&' : ''}timestamp=${now()}&recvWindow=10000`
  const u = binanceRequest('GET', `${path}?${query}`)
  try { return await send(u.toString()) } catch (e) {
    throw e instanceof BinanceError ? e : new BinanceError('Sem conexão com a Binance', 'rede')
  }
}

const num = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN)

/**
 * Saldos da conta spot + Simple Earn. "LD<moeda>" no spot é o espelho do Earn flexível: sai só quando o Earn de <moeda> foi lido
 * (LDO é uma moeda de verdade; sem o Earn, o espelho é a única pista do saldo).
 * Sem permissão para o Earn a chave ainda serve: `earnSkipped` avisa a tela.
 */
export async function fetchBinanceBalances(send: BinanceSend, now: () => number = Date.now): Promise<{ balances: { asset: string; qty: number }[]; earnSkipped: boolean }> {
  const res = await signedGet(ACCOUNT, send, now)
  if (res.status === 401 || res.status === 403) throw new BinanceError('Chave da Binance inválida ou sem permissão de leitura', 'chave')
  const body = res.ok ? await res.json().catch(() => null) : null
  if (!body || !Array.isArray(body.balances)) throw new BinanceError(`A Binance respondeu com erro (HTTP ${res.status})`, 'resposta')

  const total = new Map<string, number>()
  const add = (asset: unknown, qty: number) => { if (typeof asset === 'string' && qty > 0) total.set(asset, (total.get(asset) ?? 0) + qty) }

  let earnSkipped = false
  const inFlexible = new Set<string>()
  // flexível e travado em paralelo; o resultado é tratado na ordem de EARN
  const earn = await Promise.all(EARN.map(async path => {
    const r = await signedGet(path, send, now)
    return { path, rows: r.ok ? (await r.json().catch(() => null))?.rows : null }
  }))
  for (const { path, rows } of earn) {
    if (!Array.isArray(rows)) { earnSkipped = true; continue }
    for (const row of rows) {
      add(row?.asset, num(row?.totalAmount ?? row?.amount))
      if (path === EARN[0] && typeof row?.asset === 'string') inFlexible.add(row.asset)
    }
  }
  for (const b of body.balances) {
    const asset = String(b?.asset ?? '')
    if (!(asset.startsWith('LD') && inFlexible.has(asset.slice(2)))) add(asset, num(b?.free) + num(b?.locked))
  }
  return { balances: [...total].map(([asset, qty]) => ({ asset, qty })), earnSkipped }
}

type Row = Record<string, unknown>
const DAY = 86_400_000

/**
 * Linhas da resposta (`key`: onde a lista está); null quando o símbolo não existe (-1121).
 * No limite de consultas (429/418) espera o Retry-After (60 s sem ele, no máximo 120 s) e tenta de novo uma vez.
 */
async function readRows(path: string, params: string, send: BinanceSend, now: () => number, sleep: (ms: number) => Promise<void>, key?: string): Promise<Row[] | null> {
  let res = await signedGet(path, send, now, params)
  if (res.status === 429 || res.status === 418) {
    const s = Number(res.headers.get('Retry-After') || 60)
    await sleep(Math.min(Number.isFinite(s) && s >= 0 ? s : 60, 120) * 1000)
    res = await signedGet(path, send, now, params)
  }
  const body = await res.json().catch(() => null) as Row | Row[] | null
  if (res.ok && body) {
    const rows = Array.isArray(body) ? body : body[key ?? ''] ?? []
    if (Array.isArray(rows)) return rows as Row[]
  }
  if (!Array.isArray(body) && body?.code === -1121) return null
  if (res.status === 401 || res.status === 403) throw new BinanceError('Chave da Binance sem permissão para este histórico', 'chave')
  if (res.status === 429 || res.status === 418) throw new BinanceError('A Binance limitou as consultas; tente de novo mais tarde', 'resposta')
  throw new BinanceError(`A Binance respondeu com erro (HTTP ${res.status})`, 'resposta')
}

/** Janelas [início, fim] de `size` ms, do agora até `from`, sem sobreposição. */
function windows(from: number, to: number, size: number): [number, number][] {
  const out: [number, number][] = []
  for (let end = to; end > from; end -= size) out.push([Math.max(from, end - size), end - 1])
  return out
}

const QUOTES = ['BRL', 'USDT', 'FDUSD', 'USDC', 'BUSD']

/**
 * Trocas do histórico para o aportado: compras/vendas com PIX ou cartão, Convert e negociações spot nos pares em real e em dólar.
 * Uma fonte que falha (sem permissão, rede, limite) vai para `failed` e as outras seguem.
 */
export async function fetchBinanceSwaps(send: BinanceSend, assets: string[], now: () => number = Date.now,
  sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)), onProgress?: (text: string) => void): Promise<{ swaps: Swap[]; failed: { source: string; error: unknown }[]; found: Record<string, number> }> {
  // a leitura leva minutos: cada fonte diz onde está, juntas numa linha só
  const stage: Record<string, string> = { 'PIX/cartão': '…', Convert: '…', 'à vista': '…' }
  const tell = (k: string, v: string) => { stage[k] = v; onProgress?.(Object.entries(stage).map(([a, b]) => `${a} ${b}`).join(' · ')) }
  const month = (ms: number) => { const d = new Date(ms); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` }
  const read = (path: string, params: string, key?: string) => readRows(path, params, send, now, sleep, key)
  const fiats = new Set(['BRL'])

  // sem beginTime/endTime a Binance só devolve 30 dias; o limite da janela não é documentado, 90 dias por segurança
  const fiat = async () => {
    const out: Swap[] = []
    for (const type of [0, 1]) for (const [a, b] of windows(Date.parse('2017-07-01T00:00:00Z'), now(), 90 * DAY)) {
      tell('PIX/cartão', month(a))
      for (let page = 1; ; page++) {
        const rows = await read(FIAT, `transactionType=${type}&beginTime=${a}&endTime=${b}&page=${page}&rows=500&`, 'data') ?? []
        for (const r of rows) {
          if (r.status !== 'Completed') continue
          const f = String(r.fiatCurrency), c = String(r.cryptoCurrency)
          fiats.add(f)
          // sourceAmount é o lado em moeda fiduciária (já com a taxa), obtainAmount o lado em cripto, nos dois sentidos
          out.push(type === 0 ? { time: num(r.createTime), get: c, getQty: num(r.obtainAmount), pay: f, payQty: num(r.sourceAmount) }
            : { time: num(r.createTime), get: f, getQty: num(r.sourceAmount), pay: c, payQty: num(r.obtainAmount) })
        }
        if (rows.length < 500) break
      }
    }
    tell('PIX/cartão', 'ok')
    return out
  }

  const convert = async () => {
    const out: Swap[] = []
    for (const [i, [a, b]] of windows(Date.parse('2018-01-01T00:00:00Z'), now(), 30 * DAY).entries()) {
      // peso 3000 por usuário (limite 180000/min): uma janela por segundo e pouco
      if (i) await sleep(1100)
      tell('Convert', month(a))
      // shortcut: 1000 trocas num mês é o máximo de uma página; dividir a janela se alguém chegar a isso
      for (const r of await read(CONVERT, `startTime=${a}&endTime=${b}&limit=1000&`, 'list') ?? []) {
        if (r.orderStatus === 'SUCCESS') out.push({ time: num(r.createTime), get: String(r.toAsset), getQty: num(r.toAmount), pay: String(r.fromAsset), payQty: num(r.fromAmount) })
      }
    }
    tell('Convert', 'ok')
    return out
  }

  const failed: { source: string; error: unknown }[] = []
  const swaps: Swap[] = []
  const found: Record<string, number> = {}
  const settle = async (source: string, run: () => Promise<Swap[]>) => {
    try { const got = await run(); found[source] = got.length; swaps.push(...got) } catch (error) { failed.push({ source, error }) }
  }
  await Promise.all([settle('compras com PIX/cartão', fiat), settle('Convert', convert)])

  // myTrades exige o par: cada moeda com saldo ou vista acima × as moedas de cotação em real e dólar
  const spot = async () => {
    const out: Swap[] = []
    const bases = new Set([...assets, ...swaps.flatMap(s => [s.get, s.pay])].filter(a => !fiats.has(a)))
    let first = true
    for (const base of bases) for (const quote of QUOTES) {
      if (base === quote) continue
      tell('à vista', `${base}${quote}`)
      for (let fromId = 0; ;) {
        // peso 20 por chamada (limite 6000/min): um respiro entre as chamadas para não estourar com muitas moedas
        if (!first) await sleep(250)
        first = false
        const rows = await read(TRADES, `symbol=${base}${quote}&fromId=${fromId}&limit=1000&`)
        if (!rows) break
        for (const r of rows) {
          const s: Swap = r.isBuyer ? { time: num(r.time), get: base, getQty: num(r.qty), pay: quote, payQty: num(r.quoteQty) }
            : { time: num(r.time), get: quote, getQty: num(r.quoteQty), pay: base, payQty: num(r.qty) }
          // taxa na moeda recebida reduz o que chegou; na paga, aumenta o que saiu (taxa em BNB fica de fora)
          if (r.commissionAsset === s.get) s.getQty -= num(r.commission)
          else if (r.commissionAsset === s.pay) s.payQty += num(r.commission)
          out.push(s)
        }
        if (rows.length < 1000) break
        fromId = num(rows.at(-1)!.id) + 1
      }
    }
    tell('à vista', 'ok')
    return out
  }
  await settle('negociações à vista', spot)
  return { swaps, failed, found }
}
