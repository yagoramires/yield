import type { Broker, Issuer } from '../db/irRepo'
import type { RfMove, RfPosition } from '../db/rendaFixaRepo'
import { normalizeBroker } from '../import/parse'
import { replay } from './ledger'
import { nameOf, rfInstitution, rfOpenByKey } from './rendaFixa'
import type { TaxMonth } from './tax'
import type { AssetType, Cents, CorporateEvent, DarfPayment, Dividend, Month, Trade } from './types'

/**
 * "11222333000181" ou "11.222.333/0001-81" → "11.222.333/0001-81". Aceita o CNPJ alfanumérico (IN RFB 2.229/2024):
 * letras nas 12 primeiras posições, valendo o código ASCII − 48 no cálculo; os dois verificadores são sempre números.
 */
export function formatCnpj(text: string): string {
  const d = text.toUpperCase().replace(/[^0-9A-Z]/g, '')
  const dv = (base: string) => {
    const w = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const r = [...base].reduce((s, c, i) => s + (c.charCodeAt(0) - 48) * w[i], 0) % 11
    return r < 2 ? 0 : 11 - r
  }
  if (!/^[0-9A-Z]{12}\d{2}$/.test(d) || /^(.)\1+$/.test(d) || dv(d.slice(0, 12)) !== Number(d[12]) || dv(d.slice(0, 13)) !== Number(d[13])) throw new Error('CNPJ inválido: confira os 14 números')
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

// shortcut: códigos da ficha Bens e Direitos do IRPF 2026 (ano-calendário 2025); conferir no programa da Receita a cada ano.
export const BEM_CODES: Record<AssetType, { grupo: string; codigo: string; label: string; classe: string }> = {
  Ação: { grupo: '03', codigo: '01', label: '03 – Participações societárias / 01 – Ações', classe: 'Ações' },
  FII: { grupo: '07', codigo: '03', label: '07 – Fundos / 03 – Fundos de Investimento Imobiliário (FII)', classe: 'Fundos imobiliários' },
  ETF: { grupo: '07', codigo: '09', label: '07 – Fundos / 09 – Demais fundos de índice de mercado (ETF)', classe: 'ETFs' },
  BDR: { grupo: '04', codigo: '04', label: '04 – Aplicações e investimentos / 04 – Ativos negociados em bolsa no Brasil (BDR)', classe: 'BDRs' },
  // fundo de índice também; o ganho na venda é de tributação exclusiva (retido na fonte), não entra na renda variável
  'ETF RF': { grupo: '07', codigo: '09', label: '07 – Fundos / 09 – Demais fundos de índice de mercado (ETF)', classe: 'ETFs de renda fixa' },
}
export const LOCALIZACAO = '105 – Brasil'

export interface Bem { ticker: string; oldTickers: string[]; assetType: AssetType; qtyPrev: number; costPrevCents: Cents; qty: number; costCents: Cents; brokers: string[] }

/** Posição em 31/12 pela data de liquidação, como a planilha; a cadeia de mudanças de ticker vira um ativo só. */
export function bensDoAno(trades: Trade[], events: CorporateEvent[], year: number): Bem[] {
  const end = `${year}-12-31`, endPrev = `${year - 1}-12-31`
  const at = (d: string) => new Map(replay(trades.filter(t => t.settleDate <= d), events.filter(e => e.date <= d)).positions.filter(p => p.qty > 0).map(p => [p.ticker, p]))
  const now = at(end), before = at(endPrev)
  const renames = new Map(events.flatMap(e => (e.kind === 'mudanca_ticker' && e.date <= end ? [[e.ticker, e.newTicker] as const] : [])))
  const resolve = (t: string) => { let x = t; for (let i = 0; renames.has(x) && i < 20; i++) x = renames.get(x)!; return x }
  const keys = new Set([...now.keys(), ...[...before.keys()].map(resolve)])
  return [...keys].map(key => {
    const olds = [...renames.keys()].filter(o => o !== key && resolve(o) === key)
    const chain = new Set([key, ...olds])
    const prev = [...before.values()].filter(p => chain.has(p.ticker))
    const cur = now.get(key)
    const mine = trades.filter(t => chain.has(t.ticker) && t.settleDate <= end)
    const bal = brokerBalances(mine, events.filter(e => chain.has(e.ticker) && e.date <= end))
    const holding = [...bal].filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).map(([b]) => b)
    return {
      ticker: key, oldTickers: olds, assetType: cur?.assetType ?? prev[0].assetType,
      qtyPrev: prev.reduce((s, p) => s + p.qty, 0), costPrevCents: prev.reduce((s, p) => s + p.totalCostCents, 0),
      qty: cur?.qty ?? 0, costCents: cur?.totalCostCents ?? 0,
      brokers: holding.length ? holding : [...new Set(mine.map(t => t.broker))],
    }
  }).sort((a, b) => b.costCents - a.costCents || b.costPrevCents - a.costPrevCents || a.ticker.localeCompare(b.ticker))
}

/** Saldo por corretora: compras − vendas, e desdobramento/grupamento/bonificação mudam o saldo de todas na mesma proporção. */
function brokerBalances(trades: Trade[], events: CorporateEvent[]): Map<string, number> {
  const steps = [...events.map(e => ({ date: e.date, rank: 0, e })), ...trades.map(t => ({ date: t.tradeDate, rank: 1, t }))].sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank)
  const bal = new Map<string, number>()
  for (const s of steps) {
    if ('t' in s && s.t) bal.set(s.t.broker, (bal.get(s.t.broker) ?? 0) + (s.t.side === 'C' ? s.t.qty : -s.t.qty))
    else if ('e' in s && s.e && 'qtyDelta' in s.e) {
      const total = [...bal.values()].reduce((x, q) => x + Math.max(0, q), 0)
      if (total > 0) for (const [b, q] of bal) if (q > 0) bal.set(b, q * (total + s.e.qtyDelta) / total)
    }
  }
  return bal
}

const num = (n: number) => String(n).replace('.', ',')

/** Texto da discriminação, no formato da planilha; o que falta de cadastro aparece entre colchetes. */
export function discriminacao(b: Bem, year: number, issuer: Issuer | undefined, brokers: Map<string, Broker>): string {
  const name = issuer?.name ?? '[razão social não cadastrada]'
  const unit = b.assetType === 'Ação' ? 'Ações' : 'Cotas'
  if (b.qty === 0) return `Posição zerada em 31/12/${year}. Em 31/12/${year - 1}: ${num(b.qtyPrev)} ${unit} de ${name} - Ticker: ${b.ticker}`
  const custody = b.brokers.map(c => `${brokers.get(c)?.name ?? c} - CNPJ: ${brokers.get(c)?.cnpj ?? '[CNPJ não cadastrado]'}`).join(' e ')
  const where = b.brokers.length === 0 ? '' : ` - Custodiadas ${b.brokers.length === 1 ? 'na corretora' : 'nas corretoras'}: ${custody}`
  return `${num(b.qty)} ${unit} de ${name} ao custo de R$ ${(b.costCents / b.qty / 100).toFixed(4).replace('.', ',')} cada - Ticker: ${b.ticker}${where}`
}

export type LinhaRendimento = '09' | '26' | '10' | 'bdr' | '06' | '12'
export const RENDIMENTO_LABEL: Record<LinhaRendimento, string> = {
  '09': '09 – Lucros e dividendos recebidos', '26': '26 – Outros (rendimentos de FII)', '10': '10 – Juros sobre capital próprio', bdr: 'Dividendos de BDR (renda do exterior, tributável)',
  '06': '06 – Rendimentos de aplicações financeiras', '12': '12 – Rendimentos de poupança, LCI, LCA, CRI e CRA',
}
export interface Rendimento { linha: LinhaRendimento; payerKey: string; name: string | null; cnpj: string | null; tickers: string[]; cents: Cents }

/**
 * Proventos pagos no ano, somados por linha da ficha e por fonte pagadora (CNPJ; sem cadastro, o ticker).
 * Provento de BDR é renda do exterior (tributável, carnê-leão/ajuste anual): fica num grupo à parte, fora dos isentos.
 */
export function rendimentosDoAno(dividends: Dividend[], year: number, issuers: Map<string, Issuer>, typeOf: (ticker: string) => AssetType | undefined): Rendimento[] {
  const by = new Map<string, Rendimento>()
  for (const d of dividends) {
    if (!d.payDate.startsWith(`${year}-`)) continue
    const linha: LinhaRendimento = typeOf(d.ticker) === 'BDR' ? 'bdr' : d.kind === 'JCP' ? '10' : d.kind === 'Rendimento' ? '26' : '09'
    const i = issuers.get(d.ticker)
    const payerKey = i?.cnpj ?? d.ticker
    const r = by.get(`${linha}|${payerKey}`) ?? { linha, payerKey, name: i?.name ?? null, cnpj: i?.cnpj ?? null, tickers: [], cents: 0 }
    if (!r.tickers.includes(d.ticker)) r.tickers.push(d.ticker)
    r.cents += d.amountCents
    by.set(`${linha}|${payerKey}`, r)
  }
  const order: LinhaRendimento[] = ['09', '26', '10', 'bdr']
  return [...by.values()].map(r => ({ ...r, tickers: [...r.tickers].sort() })).sort((a, b) => order.indexOf(a.linha) - order.indexOf(b.linha) || b.cents - a.cents)
}

/** Linha 20 dos isentos: lucro das vendas de ações até R$ 20 mil no mês (o imposto mensal já separa só ações). */
export const lucroIsentoDoAno = (tax: TaxMonth[], year: number): Cents => tax.filter(m => m.month.startsWith(`${year}-`)).reduce((s, m) => s + m.comum.exemptProfitCents, 0)

export interface LinhaRV { month: Month; resultCents: Cents; lossInCents: Cents; irrfCents: Cents; taxPayableCents: Cents; darfPaidCents: Cents }

/** Ficha de renda variável: só meses com operação; o DARF (um por mês) vai na linha das operações comuns, ou na de FII se só houve FII. */
export function rendaVariavelDoAno(tax: TaxMonth[], payments: DarfPayment[], year: number): { comum: LinhaRV[]; fii: LinhaRV[] } {
  const paid = (m: Month) => payments.filter(p => p.month === m).reduce((s, p) => s + p.principalCents, 0)
  const line = (m: Month, p: TaxMonth['comum'], darf: boolean): LinhaRV => ({ month: m, resultCents: p.resultCents, lossInCents: p.lossInCents, irrfCents: p.irrfMonthCents, taxPayableCents: p.taxPayableCents, darfPaidCents: darf ? paid(m) : 0 })
  const months = tax.filter(m => m.month.startsWith(`${year}-`))
  const hasComum = (m: TaxMonth) => m.stockSalesCents > 0 || m.comum.resultCents !== 0
  return {
    comum: months.filter(hasComum).map(m => line(m.month, m.comum, true)),
    fii: months.filter(m => m.fii.resultCents !== 0).map(m => line(m.month, m.fii, !hasComum(m))),
  }
}

export function pendencias(bens: Bem[], rendimentos: Rendimento[], issuers: Map<string, Issuer>, brokers: Map<string, Broker>): { tickers: string[]; brokers: string[] } {
  const tickers = new Set([...bens.map(b => b.ticker).filter(t => !issuers.has(t)), ...rendimentos.filter(r => !r.cnpj).flatMap(r => r.tickers)])
  const bs = new Set(bens.flatMap(b => b.brokers).filter(c => !brokers.has(c)))
  return { tickers: [...tickers].sort(), brokers: [...bs].sort() }
}

// shortcut: códigos de renda fixa do IRPF 2026 (ano-calendário 2025); conferir no programa da Receita a cada ano.
// Debênture incentivada (Lei 12.431) é isenta e vai no 02, mas o relatório da B3 não diz qual é: entra no 01.
export const RF_CODES = {
  tributavel: { grupo: '04', codigo: '01', label: '04 – Aplicações e investimentos / 01 – Títulos públicos e privados sujeitos à tributação (Tesouro Direto, CDB, RDB e outros)', classe: 'Renda fixa tributável' },
  isento: { grupo: '04', codigo: '02', label: '04 – Aplicações e investimentos / 02 – Títulos isentos de tributação (LCI, LCA, CRI, CRA e outros)', classe: 'Renda fixa isenta' },
} as const
export type TipoRf = keyof typeof RF_CODES
const tipoRf = (product: string): TipoRf => (/^(lci|lca|cri|cra|lig)\b/i.test(product.trim()) ? 'isento' : 'tributavel')

export interface BemRf { key: string; name: string; tipo: TipoRf; qtyPrev: number; appliedPrevCents: Cents; qty: number; appliedCents: Cents; institutions: string[]; partial: boolean }

/** Renda fixa da B3 em cada 31/12 pelo custo de aquisição: o aplicado ainda em aberto, pelas movimentações. */
export function rendaFixaDoAno(moves: RfMove[], positions: RfPosition[], year: number): BemRf[] {
  const end = `${year}-12-31`
  const prev = rfOpenByKey(moves, `${year - 1}-12-31`), cur = rfOpenByKey(moves, end)
  const posByKey = new Map(positions.map(p => [p.key, p]))
  return [...cur].flatMap(([key, c]) => {
    const p = prev.get(key) ?? { qty: 0, applied: 0 }
    const ms = moves.filter(m => m.key === key && m.date <= end)
    // saída sem a compra no relatório (comprado antes dele): aparece para a pessoa completar à mão
    if (c.qty <= 1e-9 && p.qty <= 1e-9 && !(c.partial && ms.some(m => m.date.startsWith(`${year}-`)))) return []
    const pos = posByKey.get(key)
    return [{
      key, name: pos ? nameOf(pos.product, true) : nameOf(ms[0].product, false), tipo: tipoRf(ms[0].product),
      qtyPrev: p.qty, appliedPrevCents: p.applied, qty: c.qty, appliedCents: c.applied, partial: c.partial,
      institutions: [...new Set(ms.flatMap(m => rfInstitution(m) ?? []))],
    }]
  }).sort((a, b) => b.appliedCents - a.appliedCents || b.appliedPrevCents - a.appliedPrevCents || a.name.localeCompare(b.name))
}

export function discriminacaoRf(b: BemRf, year: number, brokers: Map<string, Broker>): string {
  const custody = b.institutions.map(i => { const br = brokers.get(normalizeBroker(i)); return `${br?.name ?? i} - CNPJ: ${br?.cnpj ?? '[CNPJ não cadastrado]'}` }).join(' e ')
  const text = (qty: number) => `${b.name} - Quantidade: ${num(Math.round(qty * 100) / 100)} - custodiado na B3${custody ? ` via ${custody}` : ''}, valor aplicado`
  return b.qty <= 1e-9 ? `Resgatado ou vendido em ${year}. Em 31/12/${year - 1}: ${text(b.qtyPrev)}` : text(b.qty)
}

/** Juros de renda fixa pagos no ano, por fonte (emissor; Tesouro Direto à parte). LCI/LCA/CRI/CRA são isentos (linha 12); o resto é exclusiva (06). */
export function rendimentosRfDoAno(moves: RfMove[], positions: RfPosition[], year: number): Rendimento[] {
  const issuer = new Map(positions.map(p => [p.key, p.issuer]))
  const by = new Map<string, Rendimento>()
  for (const m of moves) {
    if (m.kind !== 'juros' || m.valueCents === null || !m.date.startsWith(`${year}-`)) continue
    const linha: LinhaRendimento = tipoRf(m.product) === 'isento' ? '12' : '06'
    const name = /^tesouro\b/i.test(m.product.trim()) ? 'Tesouro Direto' : issuer.get(m.key) ?? m.product.split(' - ')[2]?.trim() ?? nameOf(m.product, false)
    const r = by.get(`${linha}|${name}`) ?? { linha, payerKey: name, name, cnpj: null, tickers: [], cents: 0 }
    const title = nameOf(m.product, false)
    if (!r.tickers.includes(title)) r.tickers.push(title)
    r.cents += m.valueCents
    by.set(`${linha}|${name}`, r)
  }
  return [...by.values()].sort((a, b) => a.linha.localeCompare(b.linha) || b.cents - a.cents)
}
