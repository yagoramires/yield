import { read, utils } from 'xlsx'
import type { Db } from '../db/client'
import { loadAll, saveEvent, saveNote, upsertDividends } from '../db/repo'
import { isBusinessDay } from '../domain/calendar'
import { normalizeTicker, replay } from '../domain/ledger'
import type { AssetType, Cents, Dividend, DividendKind, ISODate, NewCorporateEvent, Side } from '../domain/types'
import { normalizeBroker, parseBRDate, parseBRL, parseQty } from './parse'

export interface B3Trade { date: ISODate; broker: string; side: Side; ticker: string; qty: number; priceCents: Cents }
export interface B3Import {
  trades: B3Trade[]
  names: Record<string, string> // ticker → nome do produto, para deduzir o tipo
  dividends: Omit<Dividend, 'id'>[]
  events: (NewCorporateEvent & { sourceKey: string })[]
  ignored: number
  toReview: { date: ISODate; movimentacao: string; produto: string; nota?: string }[]
  checks: { date: ISODate; ticker: string; qty: number; produto: string }[] // "Atualização": a B3 reafirmando a posição inteira
  // "Leilão de Fração" e "Resgate": a B3 pagou pelas cotas, então viram venda
  sales: { kind: 'Leilão de Fração' | 'Resgate'; date: ISODate; ticker: string; qty: number; valueCents: Cents; broker: string; produto: string }[]
  subscriptions: { base: string; date: ISODate }[] // subscrição exercida: explica uma "Atualização" que credita cotas
}

type Cell = string | number | boolean | null
const PROVENTOS: Record<string, DividendKind> = { Rendimento: 'Rendimento', Dividendo: 'Dividendo', 'Juros Sobre Capital Próprio': 'JCP' }
const REVISAR = ['Amortização', 'Incorporação', 'Cisão']
const text = (v: Cell | undefined) => (v == null ? '' : String(v).trim())
const str = (v: Cell | undefined) => (typeof v === 'number' ? v : text(v))
const columns = (rows: Cell[][]) => new Map(rows[0]?.map((h, i) => [text(h), i]))
/** "HGLG11 - CSHG LOGÍSTICA FDO INV IMOB - FII" → HGLG11, guardando o nome. */
function tickerOf(out: B3Import, produto: string) {
  const [code, ...name] = produto.split(' - ')
  const ticker = normalizeTicker(code)
  if (name.length) out.names[ticker] = name.join(' - ')
  return ticker
}
// Linhas idênticas no mesmo arquivo ganham :#n (n = idênticas anteriores).
function uniqueKey(seen: Map<string, number>, base: string) {
  const n = seen.get(base) ?? 0
  seen.set(base, n + 1)
  return n ? `${base}:#${n}` : base
}

function parseMovimentacao(rows: Cell[][], out: B3Import) {
  const col = columns(rows)
  const seen = new Map<string, number>()
  for (const r of rows.slice(1)) {
    const get = (h: string) => r[col.get(h) ?? -1]
    const mov = text(get('Movimentação'))
    const produto = text(get('Produto'))
    const dataRaw = get('Data')
    if (!mov || dataRaw == null) continue
    const date = parseBRDate(dataRaw as string | number)
    const inst = text(get('Instituição'))
    const qtyCell = get('Quantidade')
    const valueCell = get('Valor da Operação')
    const ticker = tickerOf(out, produto)
    const sourceKey = uniqueKey(seen, `b3:${date}:${mov}:${produto}:${inst}:${text(qtyCell)}:${text(valueCell)}`)
    const qty = parseQty(str(qtyCell))
    const sign = /^d/i.test(text(get('Entrada/Saída'))) ? -1 : 1

    const amountCents = PROVENTOS[mov] ? parseBRL(str(valueCell)) : 0
    // Provento sem valor ou Grupamento a crédito (sinal não confirmado num extrato real) vão para revisão.
    if ((PROVENTOS[mov] && amountCents <= 0) || (mov === 'Grupamento' && sign > 0)) {
      out.toReview.push({ date, movimentacao: mov, produto })
    } else if (PROVENTOS[mov]) {
      out.dividends.push({ ticker, kind: PROVENTOS[mov], payDate: date, amountCents, broker: normalizeBroker(inst), source: 'b3', sourceKey })
    } else if (mov === 'Bonificação em Ativos') {
      out.events.push({ kind: 'bonificacao', ticker, date, qtyDelta: qty, unitCostCents: null, sourceKey })
    } else if (mov === 'Desdobro' || mov === 'Grupamento') {
      out.events.push({ kind: mov === 'Desdobro' ? 'desdobramento' : 'grupamento', ticker, date, qtyDelta: sign * qty, sourceKey })
    } else if (mov === 'Atualização') {
      out.checks.push({ date, ticker, qty, produto })
    } else if ((mov === 'Leilão de Fração' || mov === 'Resgate') && qty > 0 && parseBRL(str(valueCell)) > 0) {
      out.sales.push({ kind: mov, date, ticker, qty, valueCents: parseBRL(str(valueCell)), broker: normalizeBroker(inst), produto })
    } else if (REVISAR.includes(mov)) {
      out.toReview.push({ date, movimentacao: mov, produto })
    } else {
      // liquidação das compras e vendas (entram pela Negociação ou pelas notas), "Fração em Ativos" (quem tira a fração é a venda do leilão),
      // direitos e recibos de subscrição (as cotas chegam depois, numa "Atualização")
      if (/^(Direitos de Subscrição - Exercido|Recibo de Subscrição|Solicitação de Subscrição)$/.test(mov)) out.subscriptions.push({ base: ticker.slice(0, 4), date })
      out.ignored++
    }
  }
}

function parseNegociacao(rows: Cell[][], out: B3Import) {
  const col = columns(rows)
  for (const r of rows.slice(1)) {
    const get = (h: string) => r[col.get(h) ?? -1]
    const tipo = text(get('Tipo de Movimentação'))
    const dataRaw = get('Data do Negócio')
    if (!tipo || dataRaw == null) continue
    const date = parseBRDate(dataRaw as string | number)
    const codigo = text(get('Código de Negociação'))
    const ticker = normalizeTicker(codigo)
    const mercado = text(get('Mercado'))
    // Renda fixa, opções, termo e direitos de subscrição (12–15) não entram na carteira de renda variável.
    if (!['Mercado à Vista', 'Mercado Fracionário'].includes(mercado)) out.toReview.push({ date, movimentacao: `${tipo} em ${mercado}`, produto: codigo })
    else if (text(get('Prazo/Vencimento')).replace('-', '') || /1[2-5]$/.test(ticker)) out.toReview.push({ date, movimentacao: `${tipo} com vencimento`, produto: codigo })
    else out.trades.push({ date, broker: normalizeBroker(text(get('Instituição'))), side: tipo === 'Venda' ? 'V' : 'C', ticker, qty: parseQty(str(get('Quantidade'))), priceCents: parseBRL(str(get('Preço'))) })
  }
}

function parseProventos(rows: Cell[][], out: B3Import) {
  const col = columns(rows)
  const seen = new Map<string, number>()
  for (const r of rows.slice(1)) {
    const get = (h: string) => r[col.get(h) ?? -1]
    const produto = text(get('Produto'))
    const evento = text(get('Tipo de Evento'))
    const dataRaw = get('Pagamento')
    if (!produto || !evento || !text(dataRaw)) continue // a última linha é o total
    const date = parseBRDate(dataRaw as string | number)
    const inst = text(get('Instituição'))
    const valueCell = get('Valor líquido')
    const amountCents = parseBRL(str(valueCell))
    if (!PROVENTOS[evento] || amountCents <= 0) { out.toReview.push({ date, movimentacao: evento, produto }); continue }
    const sourceKey = uniqueKey(seen, `b3prov:${date}:${evento}:${produto}:${inst}:${text(get('Quantidade'))}:${text(valueCell)}`)
    out.dividends.push({ ticker: tickerOf(out, produto), kind: PROVENTOS[evento], payDate: date, amountCents, broker: normalizeBroker(inst), source: 'b3', sourceKey })
  }
}

/** Lê os relatórios da Área do Investidor: Movimentação, Negociação ou Proventos Recebidos (reconhecidos pelo cabeçalho). */
export function parseB3(data: ArrayBuffer): B3Import {
  const wb = read(data, { cellDates: false })
  const rows = utils.sheet_to_json<Cell[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false })
  const header = new Set(rows[0]?.map(text))
  const out: B3Import = { trades: [], names: {}, dividends: [], events: [], ignored: 0, toReview: [], checks: [], sales: [], subscriptions: [] }
  if (header.has('Código de Negociação')) parseNegociacao(rows, out)
  else if (header.has('Tipo de Evento')) parseProventos(rows, out)
  else if (header.has('Movimentação')) parseMovimentacao(rows, out)
  else throw new Error('o arquivo não parece um relatório da B3 (Negociação, Proventos Recebidos ou Movimentação)')
  return out
}

/** Tipo inicial de um ticker novo. Final 11 pode ser FII, ETF ou unit: a tela pede confirmação. */
export function assetTypeOf(ticker: string): AssetType {
  if (/3[2-59]$/.test(ticker)) return 'BDR'
  return /11$/.test(ticker) ? 'FII' : 'Ação'
}

/** Tipo pelo nome do produto na B3 ("… FDO INV IMOB - FII", "… S/A", "ISHARES … FUNDO DE ÍNDICE"); null quando o nome não diz. */
export function typeFromName(name: string): AssetType | null {
  const s = name.toUpperCase()
  if (/\bFII\b|FDO\.? (DE )?INV(EST)?\.? IMOB|FUNDO DE INVESTIMENTO IMOBILI/.test(s)) return 'FII'
  if (/\bETF\b|[IÍ]NDICE|ISHARES/.test(s)) return 'ETF'
  if (/\bS[./] ?A\b|\bUNT\b/.test(s)) return 'Ação'
  return null
}

function settleDate(d: ISODate): ISODate { // D+2 em dias úteis
  let t = Date.parse(`${d}T00:00:00Z`)
  for (let n = 0; n < 2;) { t += 86_400_000; if (isBusinessDay(new Date(t).toISOString().slice(0, 10))) n++ }
  return new Date(t).toISOString().slice(0, 10)
}

/** `types` traz o tipo confirmado na tela para os tickers novos; o resto usa `assetTypeOf`. */
export async function importB3(db: Db, p: B3Import, types: Map<string, AssetType> = new Map()) {
  let notes = 0, notesSkipped = 0, trades = 0, tradesSkipped = 0
  const days = new Map<string, B3Trade[]>()
  for (const t of p.trades) days.set(`${t.date}|${t.broker}`, [...(days.get(`${t.date}|${t.broker}`) ?? []), t])
  for (const [key, list] of days) {
    const [date, broker] = key.split('|')
    const fresh: B3Trade[] = []
    for (const t of list) {
      // Já lançada por nota (PDF ou à mão) no mesmo dia: a nota tem as taxas, então ela vale.
      const dup = await db.select("SELECT 1 FROM trades t JOIN notes n ON n.id = t.note_id WHERE n.trade_date = ? AND t.ticker = ? AND t.side = ? AND coalesce(n.source_key, '') NOT LIKE 'b3neg:%'", [t.date, t.ticker, t.side])
      if (dup.length) tradesSkipped++
      else fresh.push(t)
    }
    if (!fresh.length) continue
    const r = await saveNote(db,
      { number: `B3 ${date}`, broker, tradeDate: date, settleDate: settleDate(date), source: 'sem_nota', sourceKey: `b3neg:${date}:${broker}`, label: 'Negociação da B3 (sem taxas)' },
      fresh.map((t, i) => ({ seq: i + 1, side: t.side, assetType: types.get(t.ticker) ?? assetTypeOf(t.ticker), ticker: t.ticker, qty: t.qty, priceCents: t.priceCents, feesCents: 0, irrfCents: 0 })))
    if ('skipped' in r) notesSkipped++
    else { notes++; trades += fresh.length }
  }
  const d = await upsertDividends(db, p.dividends)
  const applied: B3Import['events'] = []
  let eventsSkipped = 0
  for (const e of p.events) ('skipped' in (await saveEvent(db, e)) ? eventsSkipped++ : applied.push(e))

  // Com tudo gravado: o leilão de fração vira venda da fração e a "Atualização" confere a posição (pela liquidação, como a custódia).
  const review: B3Import['toReview'] = []
  const positionAt = async (date: ISODate, ticker: string) => {
    const { trades: ts, events: es } = await loadAll(db)
    return replay(ts.filter(t => t.settleDate <= date), es.filter(e => e.date <= date)).positions.find(x => x.ticker === ticker)?.qty ?? 0
  }
  let sales = 0
  for (const a of p.sales) {
    const leilao = a.kind === 'Leilão de Fração'
    const sourceKey = `b3${leilao ? 'leilao' : 'resgate'}:${a.date}:${a.ticker}:${a.qty}`
    if ((await db.select('SELECT 1 FROM notes WHERE source_key = ?', [sourceKey])).length) continue
    const have = await positionAt(a.date, a.ticker)
    if (have <= 1e-9) { review.push({ date: a.date, movimentacao: a.kind, produto: a.produto, nota: 'o Yield não tem essa posição' }); continue }
    // resgate maior que a posição do app (ex.: cotas de subscrição não lançadas): vende o que o app tem, pelo mesmo preço, e avisa
    const qty = Math.min(a.qty, have)
    if (qty + 1e-9 < a.qty) review.push({ date: a.date, movimentacao: a.kind, produto: a.produto, nota: `vendidas as ${String(qty).replace('.', ',')} cotas do Yield; a B3 resgatou ${String(a.qty).replace('.', ',')} — a diferença veio de algo que falta lançar (ex.: subscrição)` })
    const [known] = await db.select<{ assetType: AssetType }>('SELECT asset_type AS assetType FROM trades WHERE ticker = ? LIMIT 1', [a.ticker])
    await saveNote(db, { number: `${leilao ? 'Leilão' : 'Resgate'} ${a.date}`, broker: a.broker, tradeDate: a.date, settleDate: a.date, source: 'sem_nota', sourceKey, label: leilao ? 'Leilão de fração da B3' : 'Resgate da B3' },
      [{ seq: 1, side: 'V', assetType: known?.assetType ?? types.get(a.ticker) ?? assetTypeOf(a.ticker), ticker: a.ticker, qty, priceCents: Math.round(a.valueCents / a.qty), feesCents: 0, irrfCents: 0 }])
    sales++
  }
  const daysBetween = (a: ISODate, b: ISODate) => (Date.parse(a) - Date.parse(b)) / 86_400_000
  let checked = 0
  for (const c of p.checks) {
    const have = await positionAt(c.date, c.ticker)
    if (Math.abs(have - c.qty) < 1e-6) checked++
    else {
      // a B3 usa "Atualização" tanto para reafirmar a posição quanto para creditar cotas de uma subscrição exercida
      const sub = p.subscriptions.some(x => x.base === c.ticker.slice(0, 4) && daysBetween(c.date, x.date) >= 0 && daysBetween(c.date, x.date) <= 90)
      const q = (x: number) => String(Math.round(x * 1e6) / 1e6).replace('.', ',')
      review.push({ date: c.date, movimentacao: 'Atualização', produto: c.produto, nota: sub ? `provável crédito de subscrição (+${q(c.qty)}): lance a compra em Notas com o preço pago` : `B3: ${q(c.qty)}, Yield: ${q(have)}` })
    }
  }
  return { notes, notesSkipped, trades, tradesSkipped, dividends: d.inserted, dividendsSkipped: d.skipped, replaced: d.replaced, applied, eventsSkipped, sales, checked, review }
}
