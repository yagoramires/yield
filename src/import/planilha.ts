import { read, utils, type WorkSheet } from 'xlsx'
import type { Db } from '../db/client'
import { saveManualAsset, saveNote, upsertDividends, type ManualAsset, type Note } from '../db/repo'
import { normalizeTicker } from '../domain/ledger'
import type { AssetType, Dividend, DividendKind } from '../domain/types'
import { normalizeBroker, parseBRDate, parseBRL, parseQty } from './parse'

export interface PlanilhaImport {
  notes: { note: Omit<Note, 'id'>; trades: Parameters<typeof saveNote>[2] }[]
  dividends: Omit<Dividend, 'id'>[]
  typeConflicts: string[] // avisos em pt-BR: ticker com tipos diferentes entre linhas
  manualAssets: Omit<ManualAsset, 'id'>[]
  ignored: string[] // mensagens em pt-BR para o resumo
}

type Cell = string | number | boolean | null
const ASSET_TYPES: AssetType[] = ['Ação', 'FII', 'ETF', 'BDR']
// Colunas de taxa já rateadas pela macro; o IRRF fica de fora (vai em irrfCents).
const FEE_COLS = ['Taxa Liquidação', 'Taxa Registro', 'Taxa Termo/Opções', 'Taxa A.N.A.', 'Emolumentos', 'Taxa Operacional', 'Taxa Execução', 'Taxa Custódia', 'Impostos', 'Outros']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DOLAR_BTC = 'Dólar e BTC: lance a quantidade em Carteira › Ativos manuais'

const rowsOf = (ws: WorkSheet): Cell[][] => utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true })
const text = (v: Cell | undefined) => (v == null ? '' : String(v).trim())
const money = (v: Cell | undefined) => (typeof v === 'number' || typeof v === 'string' ? parseBRL(v) : 0)
const reais = (v: Cell | undefined) => (typeof v === 'number' ? v : money(v) / 100)

function parseNotas(rows: Cell[][], ignored: string[]) {
  const col = new Map(rows[0]?.map((h, i) => [text(h), i]))
  const get = (r: Cell[], h: string) => r[col.get(h) ?? -1]
  const valid: { r: Cell[]; ticker: string; tipo: AssetType }[] = []
  rows.slice(1).forEach((r, i) => {
    const ticker = normalizeTicker(text(get(r, 'Ticker')))
    if (!ticker) return
    const line = i + 2
    const tipo = text(get(r, 'Tipo'))
    if (!ASSET_TYPES.includes(tipo as AssetType)) return void ignored.push(`Notas, linha ${line}: ${ticker} com tipo "${tipo}" não é importado`)
    if (!['C', 'V'].includes(text(get(r, 'C/V')).toUpperCase())) return void ignored.push(`Notas, linha ${line}: ${ticker} sem C/V válido`)
    if (get(r, 'Data Pregão') == null || get(r, 'Data Liquidação') == null) return void ignored.push(`Notas, linha ${line}: ${ticker} sem data de pregão ou de liquidação`)
    valid.push({ r, ticker, tipo: tipo as AssetType })
  })

  // Ticker com mais de um tipo: vale o mais frequente (empate → o primeiro que aparece).
  const counts = new Map<string, Map<AssetType, number>>()
  for (const v of valid) {
    const m = counts.get(v.ticker) ?? new Map<AssetType, number>()
    counts.set(v.ticker, m.set(v.tipo, (m.get(v.tipo) ?? 0) + 1))
  }
  const typeOf = new Map([...counts].map(([t, m]) => [t, [...m].reduce((a, b) => (b[1] > a[1] ? b : a))[0]]))
  const typeConflicts = [...counts].filter(([, m]) => m.size > 1).map(([t, m]) => {
    const types = [...m.keys()]
    return `${t} aparece como ${types.slice(0, -1).join(', ')} e ${types[types.length - 1]}; usei ${typeOf.get(t)}`
  })

  const notes = new Map<string, PlanilhaImport['notes'][number]>()
  for (const { r, ticker } of valid) {
    const broker = normalizeBroker(text(get(r, 'Corretora')))
    const number = text(get(r, 'Nota'))
    const tradeDate = parseBRDate(get(r, 'Data Pregão') as string | number)
    const key = `planilha:${broker}:${number}:${tradeDate}`
    const n = notes.get(key) ?? {
      note: { number, broker, tradeDate, settleDate: parseBRDate(get(r, 'Data Liquidação') as string | number), source: 'planilha' as const, sourceKey: key, label: null },
      trades: [],
    }
    notes.set(key, n)
    n.trades.push({
      seq: n.trades.length + 1, side: text(get(r, 'C/V')).toUpperCase() as 'C' | 'V', assetType: typeOf.get(ticker)!, ticker,
      qty: parseQty(get(r, 'Quantidade') as string | number | null), priceCents: money(get(r, 'Preço')),
      // Soma os valores brutos e arredonda uma vez, como a coluna Taxas da planilha.
      feesCents: parseBRL(FEE_COLS.reduce((a, h) => a + reais(get(r, h)), 0)), irrfCents: money(get(r, 'I.R.R.F.')),
    })
  }
  return { notes: [...notes.values()], typeConflicts, typeOf }
}

function kindOf(label: string): DividendKind | null {
  if (/jcp/i.test(label)) return 'JCP'
  if (/fii/i.test(label)) return 'Rendimento'
  return /dividendo/i.test(label) ? 'Dividendo' : null
}

// Grade ativo × mês em blocos: rótulo do bloco, linha "Ativo" com os meses, linhas de ativos e linha "Total".
function parseRendimentos(year: string, rows: Cell[][], typeOf: Map<string, AssetType>): Omit<Dividend, 'id'>[] {
  const out: Omit<Dividend, 'id'>[] = []
  let kind: DividendKind | null = null
  let months: [col: number, month: string][] | null = null
  for (const r of rows) {
    const a = text(r[0])
    if (a === 'Ativo') {
      months = r.flatMap((h, i) => { const m = MESES.indexOf(text(h).toLowerCase()); return m < 0 ? [] : [[i, `${year}-${String(m + 1).padStart(2, '0')}`] as [number, string]] })
      continue
    }
    if (a === 'Total') { months = null; continue }
    if (!months) { kind = kindOf(a) ?? kind; continue }
    if (!a || !kind) continue
    const ticker = normalizeTicker(a)
    // Bloco "Dividendos" genérico mistura FIIs e ações: FII paga rendimento.
    const k = kind === 'Dividendo' && typeOf.get(ticker) === 'FII' ? 'Rendimento' : kind
    for (const [c, month] of months) {
      const amountCents = money(r[c])
      if (amountCents > 0) out.push({ ticker, kind: k, payDate: `${month}-01`, amountCents, broker: null, source: 'planilha', sourceKey: `planilha:${ticker}:${month}:${k}` })
    }
  }
  return out
}

function parseVisaoGeral(rows: Cell[][], ignored: string[]): Omit<ManualAsset, 'id'>[] {
  const atual = rows[0]?.findIndex(h => text(h) === 'Valor Atual') ?? -1
  const today = new Date().toISOString().slice(0, 10)
  const out: Omit<ManualAsset, 'id'>[] = []
  for (const r of rows.slice(1)) {
    const name = text(r[0])
    if (/^(tesouro selic|pr[ée][\s-]?fixado)$/i.test(name)) {
      out.push({ name, assetClass: 'renda_fixa', quoteSymbol: null, quantity: null, valueCents: money(r[atual]), updatedAt: today, sourceKey: `planilha:visao-geral:${name}` })
    } else if (/^(dólar|btc)$/i.test(name) && !ignored.includes(DOLAR_BTC)) ignored.push(DOLAR_BTC)
  }
  return out
}

export function parsePlanilha(data: ArrayBuffer): PlanilhaImport {
  const wb = read(data, { cellDates: false })
  const ignored: string[] = []
  const sheet = (name: string) => (wb.Sheets[name] ? rowsOf(wb.Sheets[name]) : (ignored.push(`Aba "${name}" não encontrada`), null))

  const notas = sheet('Notas')
  const { notes, typeConflicts, typeOf } = notas ? parseNotas(notas, ignored) : { notes: [], typeConflicts: [], typeOf: new Map<string, AssetType>() }

  const rend = wb.SheetNames.filter(n => /^Rendimentos \d{4}$/.test(n))
  if (!rend.length) ignored.push('Nenhuma aba "Rendimentos AAAA" encontrada')
  const dividends = rend.flatMap(n => parseRendimentos(n.slice(-4), rowsOf(wb.Sheets[n]), typeOf))

  const visao = sheet('Visão Geral')
  const manualAssets = visao ? parseVisaoGeral(visao, ignored) : []
  return { notes, dividends, typeConflicts, manualAssets, ignored }
}

export async function importPlanilha(db: Db, p: PlanilhaImport): Promise<{ notes: number; notesSkipped: number; dividends: number; dividendsSkipped: number; manualAssets: number }> {
  let notes = 0, notesSkipped = 0, manualAssets = 0
  for (const n of p.notes) {
    if ('id' in (await saveNote(db, n.note, n.trades))) notes++
    else notesSkipped++
  }
  const d = await upsertDividends(db, p.dividends)
  for (const a of p.manualAssets) if (typeof (await saveManualAsset(db, a)) === 'string') manualAssets++
  return { notes, notesSkipped, dividends: d.inserted, dividendsSkipped: d.skipped, manualAssets }
}
