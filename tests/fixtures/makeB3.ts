import { utils, write } from 'xlsx'

// Extrato de movimentação da B3 sintético (só as colunas que o importador lê).
export const B3_HEADER = ['Entrada/Saída', 'Data', 'Movimentação', 'Produto', 'Instituição', 'Quantidade', 'Preço unitário', 'Valor da Operação']
export type B3Row = [string, string, string, string, string, string, string, string]

export function makeB3(rows: B3Row[]): ArrayBuffer {
  const wb = utils.book_new()
  utils.book_append_sheet(wb, utils.aoa_to_sheet([B3_HEADER, ...rows]), 'Movimentação')
  return write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
