import type { Cents, ISODate, Month } from './types'

// registros que o banco guarda e o domínio calcula; os repositórios (db/) só os leem e gravam
export type AccountKind = 'conta' | 'cartao'
export interface Account { id: string; source: 'pluggy' | 'arquivo'; externalId: string; institution: string; name: string; kind: AccountKind; number: string | null; itemId: string | null; lastSyncAt: string | null; balanceCents?: Cents | null /* da Pluggy: saldo da conta ou fatura do cartão */; balanceAt?: string | null }
export interface Txn { id: string; accountId: string; date: ISODate; description: string; amountCents: Cents; pending: boolean; installment: string | null /* '3/10' */; operationType: string | null; fingerprint: string; sourceKey: string; pluggyCategory?: string | null /* em inglês, só da Pluggy */ }
export interface Category { id: string; name: string; countsAsSpending: boolean; builtin: boolean; icon: string | null /* nome Lucide */; color: string | null }
export interface CategoryRule { id: string; pattern: string; categoryId: string }
export type LineKind = 'entrada' | 'saida'
// bloco da saída; parcela é a saída com n/total, qualquer que seja o grupo
export type Grupo = 'fixo' | 'variavel' | 'meta'
export interface BudgetLine { id: string; month: Month; kind: LineKind; name: string; amountCents: Cents; recurring: boolean; position: number; categoryId: string | null; installmentCurrent: number | null; installmentTotal: number | null; sourceId: string | null; sourceKey: string | null; grupo: Grupo | null /* só saída */ }
// irpjPct: imposto sobre o faturamento (DAS do Simples ou IRPJ); dasCents: DAS fixo do MEI
export interface PjConfig { proLaborePct: number; irpjPct: number; inssPct: number /* sobre o pró-labore */; contabilidadeCents: Cents; outrosCents: Cents; dasCents: Cents }
export type SourceKind = 'pj' | 'mei' | 'clt' | 'fixo'
export interface IncomeSource extends PjConfig { id: string; name: string; kind: SourceKind; grossCents: Cents | null /* pj e clt */; netCents: Cents | null /* fixo */; dependents: number /* clt, para o IRRF */; sourceKey: string | null }
// meta vale do mês dela em diante; amountCents null desliga a meta dali para frente
export interface Goal { month: Month; key: string /* 'investir', 'variaveis' ou 'cat:<categoria>' */; amountCents: Cents | null }
export type PossessionKind = 'apartamento' | 'casa' | 'terreno' | 'imovel' | 'veiculo' | 'outro'
// vencimento que volta todo ano (IPVA, IPTU, seguro); valor opcional
export interface Reminder { name: string; day: number; month: number /* 1–12 */; amountCents: Cents | null }
export interface Possession {
  id: string; kind: PossessionKind; name: string; details: string | null; boughtAt: ISODate; costCents: Cents
  valueCents: Cents | null; valueAt: ISODate | null
  // financiamento: só quando parcela, total e primeira parcela existem
  downPaymentCents: Cents | null; installmentCents: Cents | null; installmentsTotal: number | null; firstInstallment: Month | null; debtCents: Cents | null
  categoryIds: string[]; reminders: Reminder[]
}
export interface Issuer { ticker: string; name: string; cnpj: string }
export interface Broker { code: string; name: string; cnpj: string }
export type RfMoveKind = 'aplicacao' | 'saida' | 'juros'
export interface RfMove { id: string; key: string; product: string; date: ISODate; kind: RfMoveKind; qty: number; valueCents: Cents | null /* null = a B3 não informou */; sourceKey: string }
export interface RfPosition { key: string; family: 'tesouro' | 'rf'; product: string; issuer: string | null; indexer: string; maturity: ISODate | null; qty: number; appliedCents: Cents | null; valueCents: Cents; asOf: ISODate }
export interface CryptoBalance { asset: string; qty: number; costCents: Cents | null; costManual: 0 | 1; costPartial: 0 | 1; fetchedAt: string }
export interface ManualAsset { id: string; name: string; assetClass: 'renda_fixa' | 'cripto' | 'dolar' | 'exterior' | 'outro'; currency: 'BRL' | 'USD' /* USD: cotação em dólar × BRL=X */; costCents: Cents | null /* aportado, na moeda do ativo */; quoteSymbol: string | null; quantity: number | null; valueCents: Cents | null; updatedAt: ISODate; sourceKey: string | null }
export interface Quote { symbol: string /* sempre yahooSymbol(ticker), ex. 'ITSA4.SA' */; priceCents: Cents; fetchedAt: string; source: 'yahoo' | 'manual' /* manual prevalece e nunca é sobrescrita */ }
// investimento que a Pluggy informa com saldo (fora ação/ETF); costCents = valor aplicado, quando ela informa
export interface BankInvestmentRow { id: string; itemId: string; name: string; type: string; subtype: string | null; balanceCents: Cents; costCents: Cents | null; fetchedAt: string }
