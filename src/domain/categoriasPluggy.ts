// Categoria da Pluggy (em inglês, ex. "Groceries", "Transfer - PIX") → id de categoria do app.
// A ordem importa: o primeiro padrão que bate vence ("gas stations" antes de "gas").
// shortcut: lista montada pelos nomes conhecidos da Pluggy; nome novo cai em null (sem categoria) até entrar aqui.
const INVEST = /invest|fixed income|mutual fund|variable income|pension|proceeds|dividend/
const MAP: [RegExp, string][] = [
  [/same person transfer/, 'transferencia'],
  [/credit card payment/, 'pagamento-de-fatura'],
  [INVEST, 'investimento'],
  [/gas station|fuel|parking|toll|taxi|ride|public transport|car rental|bicycle|automotive|transport/, 'transporte'],
  [/supermarket|groceries/, 'mercado'],
  [/eating out|restaurant|food|delivery|bakery|coffee/, 'alimentacao'],
  [/streaming|digital services|software|subscription/, 'assinaturas'],
  [/airport|airline|accommodation|accomodation|lodging|hotel|mileage|bus ticket|travel/, 'viagem'],
  [/rent|housing|condominium|real estate/, 'moradia'],
  [/telecom|internet|mobile|phone|utilities|water|electricity|\bgas\b|insurance/, 'contas'],
  [/health|pharmacy|drugstore|dentist|hospital|clinic|optometry|wellness|fitness|gym/, 'saude'],
  [/education|school|university|course|book/, 'educacao'],
  [/leisure|cinema|theater|concert|gaming|sport|ticket|gambling|entertainment/, 'lazer'],
  [/shopping|clothing|electronic|houseware|pet|kids|department store|marketplace/, 'compras'],
  [/tax|bank fee|interest|fine|late payment/, 'impostos-e-taxas'],
  [/donation/, 'outros'],
]
const INCOME = /income|salary|wage|retirement|government aid|benefit|refund/

/** Id da categoria do app para a categoria da Pluggy; entrada de salário/renda vira Receita. */
export function pluggyCategoryId(category: string | null | undefined, amountCents: number): string | null {
  if (!category) return null
  const c = category.toLowerCase()
  if (amountCents > 0 && INCOME.test(c) && !INVEST.test(c)) return 'receita' // "Fixed income" é resgate, não renda
  if (/transfer/.test(c) && !/same person/.test(c)) return null // Pix/TED para outra pessoa: gasto de verdade, sem categoria
  return MAP.find(([re]) => re.test(c))?.[1] ?? null
}
