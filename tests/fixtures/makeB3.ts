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

// Relatório "Posição" da Área do Investidor: uma aba por produto, com as linhas de total no fim de cada uma (como no arquivo real).
export const TESOURO_HEADER = ['Produto', 'Instituição', 'Código ISIN', 'Indexador', 'Vencimento', 'Quantidade', 'Quantidade Disponível', 'Quantidade Indisponível', 'Motivo', 'Valor Aplicado', 'Valor bruto', 'Valor líquido', 'Valor Atualizado']
export const RENDA_FIXA_HEADER = ['Produto', 'Instituição', 'Emissor', 'Código', 'Indexador', 'Tipo de regime', 'Data de Emissão', 'Vencimento', 'Quantidade', 'Quantidade Disponível', 'Quantidade Indisponível', 'Motivo', 'Contraparte', 'Preço Atualizado MTM', 'Valor Atualizado MTM', 'Preço Atualizado CURVA', 'Valor Atualizado CURVA', 'Preço Atualizado FECHAMENTO', 'Valor Atualizado FECHAMENTO']
const withTotals = (header: string[], rows: (string | number)[][]) => [header, ...rows, ['Total'], header.map(() => 'Total'), [...header.slice(0, -1).map(() => ''), 999999]]
export function makePosicao(tesouro: (string | number)[][], rendaFixa: (string | number)[][]): ArrayBuffer {
  const wb = utils.book_new()
  utils.book_append_sheet(wb, utils.aoa_to_sheet([['Produto', 'Instituição', 'Quantidade'], ['AAAA3 - EMPRESA TESTE S/A', 'CORRETORA TESTE S/A', 10]]), 'Acoes')
  utils.book_append_sheet(wb, utils.aoa_to_sheet(withTotals(RENDA_FIXA_HEADER, rendaFixa)), 'Renda Fixa')
  utils.book_append_sheet(wb, utils.aoa_to_sheet(withTotals(TESOURO_HEADER, tesouro)), 'Tesouro Direto')
  return write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
