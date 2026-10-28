import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseCadastroPlanilha } from './cadastroPlanilha'

const A = '11.222.333/0001-81', B = '11444777000161'

function workbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Ticker', 'CNPJ', 'Razão social'], ['aaaa3', A, 'EMPRESA EXEMPLO S.A.'], ['BBBB11', B, ' FUNDO EXEMPLO FII '], ['CCCC3', '123', 'CNPJ RUIM'], ['', '', '']]), 'Empresas Listadas')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Digite o ano', 2025], [], ['Corretora', 'Razão Social', 'CNPJ'], ['Alfá', 'CORRETORA ALFA S.A.', A], ['DESCONHECIDA', 'OUTRA S.A.', B], [], ['ignorar', 'depois da linha vazia', A]]), 'Bens e Direitos')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

describe('parseCadastroPlanilha', () => {
  it('lê empresas e corretoras; casa a corretora com a das notas sem caixa nem acento', () => {
    expect(parseCadastroPlanilha(workbook(), ['ALFA', 'BETA'])).toEqual({
      issuers: [{ ticker: 'AAAA3', name: 'EMPRESA EXEMPLO S.A.', cnpj: A }, { ticker: 'BBBB11', name: 'FUNDO EXEMPLO FII', cnpj: '11.444.777/0001-61' }],
      brokers: [{ code: 'ALFA', name: 'CORRETORA ALFA S.A.', cnpj: A }],
      unknownBrokers: 1, invalid: 1,
    })
  })
  it('planilha sem as abas devolve vazio', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Outra')
    expect(parseCadastroPlanilha(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), [])).toEqual({ issuers: [], brokers: [], unknownBrokers: 0, invalid: 0 })
  })
})
