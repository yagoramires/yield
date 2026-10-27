import { utils, write, type CellObject } from 'xlsx'

// Planilha sintética no formato da aba de orçamento mensal: datas na linha 2, rótulos na coluna A,
// linha "Saldo" com SUM das entradas menos SUM das saídas e bloco PJ em R:S. Rótulos e valores inventados.
export interface OrcamentoFixture { semAba?: boolean; semSaldo?: boolean; semPj?: boolean }

const n = (v: number, f?: string): CellObject => ({ t: 'n', v, f })
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril']
// Linha → valor por mês (B..D); `null` = vazio. A coluna E tem data mas nenhum valor.
const ENTRADAS: [number, string, (number | 'pj' | null)[]][] = [[3, 'Renda PJ', ['pj', 'pj', 'pj']], [4, 'Bico', [300, null, null]]]
const SAIDAS: [number, string, (number | null)[]][] = [[6, 'Aluguel', [1000, 1000, 1000]], [7, 'Curso', [null, 150, null]], [8, 'Mercado', [625, 625, null]], [9, 'Estorno', [-50, null, null]]]

export function makeOrcamento(o: OrcamentoFixture = {}): ArrayBuffer {
  const wb = utils.book_new()
  const ws: Record<string, CellObject | unknown> = {}
  const put = (ref: string, c: CellObject | string) => { ws[ref] = typeof c === 'string' ? { t: 's', v: c } : c }
  const cols = ['B', 'C', 'D', 'E']
  cols.forEach((c, i) => {
    put(`${c}1`, MESES[i])
    put(`${c}2`, { t: 'd', v: new Date(Date.UTC(2024, i, 5)) })
  })
  const saldo = [0, 0, 0]
  const rows = [...ENTRADAS.map(r => ({ r, sign: 1 })), ...SAIDAS.map(r => ({ r, sign: -1 }))]
  for (const { r: [row, label, vals], sign } of rows) {
    put(`A${row}`, label)
    vals.forEach((v, i) => {
      if (v == null) return
      const val = v === 'pj' ? 8102 : v
      put(`${cols[i]}${row}`, v === 'pj' ? n(val, '$S$6') : n(val))
      if (val > 0) saldo[i] += sign * val
    })
  }
  put('A5', 'Vazia')
  if (!o.semSaldo) {
    put('A32', 'Saldo')
    cols.slice(0, 3).forEach((c, i) => put(`${c}32`, n(saldo[i], `SUM(${c}3:${c}5)-SUM(${c}6:${c}30)`)))
  }
  if (!o.semPj) {
    put('R1', 'Faturamento'); put('S1', n(10000))
    put('R2', 'Pró Labore'); put('S2', n(2800, '0.28*S1'))
    put('R3', 'IRPJ'); put('S3', n(600, '0.06*S1'))
    put('R4', 'INSS'); put('S4', n(308, '0.11*S2'))
    put('R5', 'Contabilidade'); put('S5', n(800))
    put('R6', 'Salário Líquido'); put('S6', n(8102, 'S1-SUM(S3:S5) - 190'))
  }
  ws['!ref'] = 'A1:S32'
  utils.book_append_sheet(wb, ws as never, o.semAba ? 'Outra' : 'Finanças')
  return write(wb, { type: 'array', bookType: 'xlsx', cellDates: true })
}
