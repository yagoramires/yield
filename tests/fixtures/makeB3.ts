import { utils, write } from 'xlsx'

// Extrato de movimentação da B3 sintético (só as colunas que o importador lê).
export const B3_HEADER = ['Entrada/Saída', 'Data', 'Movimentação', 'Produto', 'Instituição', 'Quantidade', 'Preço unitário', 'Valor da Operação']
export type B3Row = [string, string, string, string, string, string, string, string]

export function makeB3(rows: B3Row[]): ArrayBuffer {
  const wb = utils.book_new()
  utils.book_append_sheet(wb, utils.aoa_to_sheet([B3_HEADER, ...rows]), 'Movimentação')
  return write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

// Relatórios "Negociação" e "Proventos Recebidos" da Área do Investidor, com o cabeçalho completo.
export const NEGOCIACAO_HEADER = ['Data do Negócio', 'Tipo de Movimentação', 'Mercado', 'Prazo/Vencimento', 'Instituição', 'Código de Negociação', 'Quantidade', 'Preço', 'Valor']
export const PROVENTOS_HEADER = ['Produto', 'Pagamento', 'Tipo de Evento', 'Instituição', 'Quantidade', 'Preço unitário', 'Valor líquido']

function book(sheet: string, header: string[], rows: (string | number)[][]): ArrayBuffer {
  const wb = utils.book_new()
  utils.book_append_sheet(wb, utils.aoa_to_sheet([header, ...rows]), sheet)
  return write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
export const makeNegociacao = (rows: (string | number)[][]) => book('Negociação', NEGOCIACAO_HEADER, rows)
export const makeProventos = (rows: (string | number)[][]) => book('Proventos Recebidos', PROVENTOS_HEADER, rows)
