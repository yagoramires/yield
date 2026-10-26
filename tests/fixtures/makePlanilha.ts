import { utils, write } from 'xlsx'

// Planilha sintética no layout da `planilha-investimentos.xlsm` (só os campos que o importador lê).
export interface NotaRow {
  nota: number | string; corretora: string; pregao: string /* ISO */; liquidacao: string; cv: string; tipo: string
  ticker: string; qtd: number; preco: number; irrf?: number; liquidacaoTaxa?: number; emolumentos?: number; corretagem?: number
}
export interface Bloco { label: string; rows: [ticker: string, ...meses: (number | null)[]][] }
export interface PlanilhaFixture {
  notas?: NotaRow[]
  rendimentos?: Record<number, Bloco[]>
  visaoGeral?: [rotulo: string, custo: number, atual: number][]
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const NOTAS_HEADER = ['Incluída', 'ID', 'Nota', 'Corretora', 'Data Pregão', 'Data Liquidação', 'C/V', 'Tipo', 'Ticker', 'Quantidade', 'Preço',
  'Valor Operação', 'Taxas', 'Valor Liquido', 'I.R.R.F.', 'Taxa Liquidação', 'Taxa Registro', 'Taxa Termo/Opções', 'Taxa A.N.A.',
  'Emolumentos', 'Taxa Operacional', 'Taxa Execução', 'Taxa Custódia', 'Impostos', 'Outros']

// Datas como número de série do Excel, igual à planilha real.
const serial = (iso: string) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000

export function makePlanilha(f: PlanilhaFixture): ArrayBuffer {
  const wb = utils.book_new()
  if (f.notas) {
    const rows = f.notas.map((n, i) => {
      const fees = [n.liquidacaoTaxa ?? 0, 0, 0, 0, n.emolumentos ?? 0, n.corretagem ?? 0, 0, 0, 0, 0]
      const op = n.qtd * n.preco
      // A coluna Taxas da planilha inclui o IRRF: o importador não deve lê-la.
      const taxas = fees.reduce((a, b) => a + b, 0) + (n.irrf ?? 0)
      return ['x', i + 1, n.nota, n.corretora, serial(n.pregao), serial(n.liquidacao), n.cv, n.tipo, n.ticker, n.qtd, n.preco,
        op, taxas, n.cv === 'C' ? op + taxas : op - taxas, n.irrf ?? null, ...fees]
    })
    utils.book_append_sheet(wb, utils.aoa_to_sheet([NOTAS_HEADER, ...rows]), 'Notas')
  }
  for (const [ano, blocos] of Object.entries(f.rendimentos ?? {})) {
    const aoa: unknown[][] = [['Dividendos', ...Array(15).fill(null), 'Total']]
    for (const b of blocos) {
      aoa.push([b.label], ['Ativo', 'Posição Atual', ...MESES])
      for (const [ticker, ...meses] of b.rows) aoa.push([ticker, 10, ...meses, meses.reduce<number>((a, v) => a + (v ?? 0), 0)])
      aoa.push(['Total', null, ...MESES.map((_, m) => b.rows.reduce((a, r) => a + ((r[m + 1] as number | null) ?? 0), 0))], [])
    }
    utils.book_append_sheet(wb, utils.aoa_to_sheet(aoa), `Rendimentos ${ano}`)
  }
  if (f.visaoGeral) {
    const aoa = [['Tipo', 'Valor de Custo', 'Valor Atual', 'Resultado', 'Variação'],
      ...f.visaoGeral.map(([r, c, a]) => [r, c, a, a - c, c ? (a - c) / c : 0])]
    utils.book_append_sheet(wb, utils.aoa_to_sheet(aoa), 'Visão Geral')
  }
  return write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
