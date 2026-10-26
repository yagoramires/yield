export type Cents = number
export type ISODate = string // 'YYYY-MM-DD'
export type Month = string // 'YYYY-MM'
export type AssetType = 'Ação' | 'FII' | 'ETF' | 'BDR'
export type Side = 'C' | 'V'
export interface Trade {
  id: string; noteId: string; seq: number; broker: string
  tradeDate: ISODate; settleDate: ISODate; side: Side; assetType: AssetType
  ticker: string; qty: number; priceCents: Cents; feesCents: Cents; irrfCents: Cents
}
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type CorporateEvent =
  | { id: string; kind: 'bonificacao'; ticker: string; date: ISODate; qtyDelta: number; unitCostCents: Cents | null }
  | { id: string; kind: 'desdobramento' | 'grupamento'; ticker: string; date: ISODate; qtyDelta: number }
  | { id: string; kind: 'mudanca_ticker'; ticker: string; newTicker: string; date: ISODate }
export type NewCorporateEvent = DistributiveOmit<CorporateEvent, 'id'>
export interface Position { ticker: string; assetType: AssetType; qty: number; totalCostCents: Cents }
export interface Sale {
  tradeId: string; tradeDate: ISODate; settleDate: ISODate; ticker: string; assetType: AssetType
  qty: number /* parte casada com a posição */; grossCents: Cents; netCents: Cents; costBasisCents: Cents; resultCents: Cents; irrfCents: Cents
  alienationCents: Cents /* qty da operação inteira × preço: é o que conta no limite de R$ 20 mil */
}
export type WarningKind = 'day_trade' | 'venda_maior_que_posicao' | 'bonificacao_sem_custo' | 'tipo_inconsistente' | 'evento_sem_posicao' | 'quantidade_invalida'
export interface Warning { kind: WarningKind; ticker: string; date: ISODate; detail: string }
export type DividendKind = 'Dividendo' | 'JCP' | 'Rendimento'
export interface Dividend {
  id: string; ticker: string; kind: DividendKind; payDate: ISODate; amountCents: Cents
  broker: string | null; source: 'b3' | 'planilha' | 'manual'; sourceKey: string | null
}
export interface DarfPayment { month: Month; paidAt: ISODate; principalCents: Cents /* sem multa e juros */; totalPaidCents: Cents }
