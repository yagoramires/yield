import { read, utils } from 'xlsx'
import type { Db } from '../db/client'
import { addIssuers, type Issuer } from '../db/irRepo'
import { addTrades, loadAll, saveEvent, saveNote, upsertDividends, type Dataset } from '../db/repo'
import { upsertRfMoves, upsertRfPositions, type RfMove, type RfPosition } from '../db/rendaFixaRepo'
import { isBusinessDay } from '../domain/calendar'
import { normalizeTicker, replay } from '../domain/ledger'
import { formatCents } from '../domain/money'
import type { AssetType, Cents, Dividend, DividendKind, ISODate, NewCorporateEvent, Side } from '../domain/types'
import { normalizeBroker, parseBRDate, parseBRL, parseQty } from './parse'
import { isPosicao, isRendaFixa, parsePosicao, parsePosicaoIssuers, posicaoDate, rfKey, rfMoveKind } from './b3RendaFixa'

export interface B3Trade { date: ISODate; broker: string; side: Side; ticker: string; qty: number; priceCents: Cents; assetType?: AssetType /* só quando o relatório já diz o tipo */ }
export interface B3Import {
  trades: B3Trade[]
  names: Record<string, string> // ticker → nome do produto, para deduzir o tipo
  dividends: Omit<Dividend, 'id'>[]
  events: (NewCorporateEvent & { sourceKey: string })[]
  ignored: number
  toReview: { date: ISODate; movimentacao: string; produto: string; nota?: string }[]
  checks: { date: ISODate; ticker: string; qty: number; produto: string }[] // "Atualização": a B3 reafirmando a posição inteira
  // "Leilão de Fração": a B3 vendeu a fração e pagou, então vira venda
  sales: { kind: 'Leilão de Fração'; date: ISODate; ticker: string; qty: number; valueCents: Cents; broker: string; produto: string }[]
  subscriptions: { base: string; date: ISODate }[] // subscrição exercida: explica uma "Atualização" que credita cotas
  rfMoves: Omit<RfMove, 'id'>[] // renda fixa da Movimentação (Tesouro, CDB…)
  rfPositions: RfPosition[] // valor de hoje de cada título, do relatório Posição
  issuers: Issuer[] // empresas e fundos da Posição, para o cadastro do IR
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

    if (isRendaFixa(produto)) {
      const kind = rfMoveKind(mov, sign > 0)
      const value = parseBRL(str(valueCell))
      if (!kind) out.toReview.push({ date, movimentacao: mov, produto, nota: 'movimentação de renda fixa que o Yield não conhece' })
      // "VENCIMENTO" vem com valor 0: a B3 não informa quanto foi resgatado
      else out.rfMoves.push({ key: rfKey(produto), product: produto, date, kind, qty, valueCents: value > 0 ? value : null, sourceKey: uniqueKey(seen, `b3rf:${date}:${mov}:${produto}:${inst}:${text(qtyCell)}:${text(valueCell)}`) })
      continue
    }

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
    } else if (mov === 'Resgate') {
      // liquidação do fundo (venda) ou parte em dinheiro de uma incorporação (não é venda): só o usuário sabe
      out.toReview.push({ date, movimentacao: mov, produto, nota: `R$ ${formatCents(parseBRL(str(valueCell)))}: se o fundo foi liquidado, lance a venda; se foi incorporado por outro, lance a troca em Notas › Evento` })
    } else if (mov === 'Leilão de Fração') {
      const valueCents = parseBRL(str(valueCell))
      if (qty > 0 && valueCents > 0) out.sales.push({ kind: mov, date, ticker, qty, valueCents, broker: normalizeBroker(inst), produto })
      else out.toReview.push({ date, movimentacao: mov, produto }) // sem quantidade ou valor não dá para lançar a venda
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
    // ETF de renda fixa (IMAB11…) vem no mercado "Renda Fixa", mas é cota negociada em bolsa
    const etfRf = mercado === 'Renda Fixa' && /^[A-Z]{4}11$/.test(ticker) && !text(get('Prazo/Vencimento')).replace('-', '')
    const trade = (): B3Trade => ({ date, broker: normalizeBroker(text(get('Instituição'))), side: tipo === 'Venda' ? 'V' : 'C', ticker, qty: parseQty(str(get('Quantidade'))), priceCents: parseBRL(str(get('Preço'))) })
    if (etfRf) out.trades.push({ ...trade(), assetType: 'ETF RF' })
    else if (!['Mercado à Vista', 'Mercado Fracionário'].includes(mercado)) out.toReview.push({ date, movimentacao: `${tipo} em ${mercado}`, produto: codigo })
    else if (text(get('Prazo/Vencimento')).replace('-', '') || /1[2-5]$/.test(ticker)) out.toReview.push({ date, movimentacao: `${tipo} com vencimento`, produto: codigo })
    else out.trades.push(trade())
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

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** Lê os relatórios da Área do Investidor: Movimentação, Negociação, Proventos Recebidos (pelo cabeçalho) ou Posição (pelas abas). */
export function parseB3(data: ArrayBuffer, fileName = '', today: ISODate = localToday()): B3Import {
  const wb = read(data, { cellDates: false })
  const out: B3Import = { trades: [], names: {}, dividends: [], events: [], ignored: 0, toReview: [], checks: [], sales: [], subscriptions: [], rfMoves: [], rfPositions: [], issuers: [] }
  if (isPosicao(wb)) {
    out.rfPositions = parsePosicao(wb, posicaoDate(fileName) ?? today)
    out.issuers = parsePosicaoIssuers(wb)
    return out
  }
  const rows = utils.sheet_to_json<Cell[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false })
  const header = new Set(rows[0]?.map(text))
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

export function settleDate(d: ISODate): ISODate { // D+2 em dias úteis
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
    const typeOf = (t: B3Trade) => t.assetType ?? types.get(t.ticker) ?? assetTypeOf(t.ticker)
    // dia já importado: completa a nota só com o que versões antigas do importador não liam (ETF de renda fixa);
    // o resto da nota pode ter sido editado à mão e não volta
    const [day] = await db.select<{ id: string }>('SELECT id FROM notes WHERE source_key = ?', [`b3neg:${date}:${broker}`])
    if (day) {
      const pool = await db.select<{ ticker: string; side: string; qty: number; priceCents: number; seq: number }>('SELECT ticker, side, qty, price_cents AS priceCents, seq FROM trades WHERE note_id = ?', [day.id])
      const maxSeq = Math.max(0, ...pool.map(h => h.seq))
      const missing = fresh.filter(t => t.assetType).filter(t => {
        const i = pool.findIndex(h => h.ticker === t.ticker && h.side === t.side && h.qty === t.qty && h.priceCents === t.priceCents)
        if (i < 0) return true
        pool.splice(i, 1)
        return false
      })
      if (!missing.length) { notesSkipped++; continue }
      await addTrades(db, day.id, missing.map((t, i) => ({ seq: maxSeq + i + 1, side: t.side, assetType: typeOf(t), ticker: t.ticker, qty: t.qty, priceCents: t.priceCents, feesCents: 0, irrfCents: 0 })))
      trades += missing.length
      continue
    }
    const r = await saveNote(db,
      { number: `B3 ${date}`, broker, tradeDate: date, settleDate: settleDate(date), source: 'sem_nota', sourceKey: `b3neg:${date}:${broker}`, label: 'Negociação da B3 (sem taxas)' },
      fresh.map((t, i) => ({ seq: i + 1, side: t.side, assetType: typeOf(t), ticker: t.ticker, qty: t.qty, priceCents: t.priceCents, feesCents: 0, irrfCents: 0 })))
    if ('skipped' in r) notesSkipped++
    else { notes++; trades += fresh.length }
  }
  const d = await upsertDividends(db, p.dividends)
  const applied: B3Import['events'] = []
  let eventsSkipped = 0
  for (const e of p.events) ('skipped' in (await saveEvent(db, e)) ? eventsSkipped++ : applied.push(e))

  // Com tudo gravado: o leilão de fração vira venda da fração e a "Atualização" confere a posição (pela liquidação, como a custódia).
  const review: B3Import['toReview'] = []
  // carrega só se houver leilão ou Atualização, e de novo só depois de gravar uma venda
  let ds: Dataset | null = null
  const positionAt = async (date: ISODate, ticker: string) => {
    const all = (ds ??= await loadAll(db))
    return replay(all.trades.filter(t => t.settleDate <= date), all.events.filter(e => e.date <= date)).positions.find(x => x.ticker === ticker)?.qty ?? 0
  }
  let sales = 0
  for (const a of p.sales) {
    const sourceKey = `b3leilao:${a.date}:${a.ticker}:${a.qty}`
    if ((await db.select('SELECT 1 FROM notes WHERE source_key = ?', [sourceKey])).length) continue
    const have = await positionAt(a.date, a.ticker)
    if (have <= 1e-9) { review.push({ date: a.date, movimentacao: a.kind, produto: a.produto, nota: 'o Yield não tem essa posição' }); continue }
    const qty = Math.min(a.qty, have)
    const [known] = await db.select<{ assetType: AssetType }>('SELECT asset_type AS assetType FROM trades WHERE ticker = ? LIMIT 1', [a.ticker])
    await saveNote(db, { number: `Leilão ${a.date}`, broker: a.broker, tradeDate: a.date, settleDate: a.date, source: 'sem_nota', sourceKey, label: 'Leilão de fração da B3' },
      [{ seq: 1, side: 'V', assetType: known?.assetType ?? types.get(a.ticker) ?? assetTypeOf(a.ticker), ticker: a.ticker, qty, priceCents: Math.round(a.valueCents / a.qty), feesCents: 0, irrfCents: 0 }])
    ds = null
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
  const rfMoves = await upsertRfMoves(db, p.rfMoves)
  const rfPositions = await upsertRfPositions(db, p.rfPositions)
  const issuers = await addIssuers(db, p.issuers)
  return { notes, notesSkipped, trades, tradesSkipped, dividends: d.inserted, dividendsSkipped: d.skipped, replaced: d.replaced, applied, eventsSkipped, sales, checked, review, rfMoves, rfPositions, issuers }
}
