import { readFileSync } from 'node:fs'
import { detectCsvPreset, parseExtratoCsv, parseMappedCsv, sniffCsv, type CsvMapping } from './extratoCsv'

const fx = (n: string) => readFileSync(`tests/fixtures/${n}`, 'utf8')

test('detectCsvPreset', () => {
  expect(detectCsvPreset(fx('nubank-conta.csv'))).toBe('nubank-conta')
  expect(detectCsvPreset(fx('mercadopago.csv'))).toBe('mercadopago')
  expect(detectCsvPreset('a,b,c\n1,2,3')).toBeNull()
})

test('Nubank conta: ponto decimal com sinal, aspas', () => {
  const s = parseExtratoCsv(fx('nubank-conta.csv'), 'nubank-conta', 'Nu Conta')
  expect(s).toMatchObject({ institution: 'Nubank', kind: 'conta', number: null, externalId: 'csv:nubank-conta:nu conta' })
  expect(s.rows).toEqual([
    { date: '2025-03-02', description: 'Compra no débito - Padaria Exemplo', amountCents: -1250, fitid: null, sourceKey: 'csv:nubank:aaaa1111-0000-4000-8000-000000000001' },
    { date: '2025-03-05', description: 'Transferência recebida - Fulano de Tal', amountCents: 150000, fitid: null, sourceKey: 'csv:nubank:aaaa1111-0000-4000-8000-000000000002' },
    { date: '2025-03-10', description: 'Pagamento de fatura, cartão', amountCents: -123456, fitid: null, sourceKey: 'csv:nubank:aaaa1111-0000-4000-8000-000000000003' },
  ])
})

test('Mercado Pago: BOM, preâmbulo, três formatos de data, vírgula decimal', () => {
  const s = parseExtratoCsv(fx('mercadopago.csv'), 'mercadopago', 'MP')
  expect(s.institution).toBe('Mercado Pago')
  expect(s.rows.map(r => [r.date, r.description, r.amountCents, r.sourceKey])).toEqual([
    ['2025-03-01', 'Pagamento Loja Exemplo', -4590, 'csv:mp:900000001:pagamento loja exemplo:-4590#0'],
    ['2025-03-02', 'Transferência Pix recebida; Beltrano', 120000, 'csv:mp:900000002:transferencia pix recebida beltrano:120000#0'],
    ['2025-03-03', 'Rendimentos', 35, 'csv:mp:900000003:rendimentos:35#0'],
  ])
})

test('cabeçalho ausente dá erro em pt-BR', () => {
  expect(() => parseExtratoCsv('x;y', 'mercadopago', 'MP')).toThrow(/RELEASE_DATE/)
})

test('linha sem valor dá erro com número da linha', () => {
  expect(() => parseExtratoCsv('Data,Valor,Identificador,Descrição\n02/03/2025,,x,Compra', 'nubank-conta', 'N')).toThrow(/Linha 2/)
  expect(() => parseExtratoCsv('RELEASE_DATE;TRANSACTION_TYPE;REFERENCE_ID;TRANSACTION_NET_AMOUNT\n\n;Pix;1;5,00', 'mercadopago', 'M')).toThrow(/Linha 3/)
  expect(() => parseExtratoCsv('Data,Valor,Identificador,Descrição\nontem,1.00,x,Compra', 'nubank-conta', 'N')).toThrow(/Linha 2.*Data inválida/)
})

describe('CSV genérico', () => {
  const parse = (text: string, label = 'Conta', patch: Partial<CsvMapping> = {}) => {
    const s = sniffCsv(text)
    return parseMappedCsv(text, s, { ...s.mapping, ...patch }, label)
  }

  test('Nubank cartão: vírgula, data ISO, despesas positivas; o atalho preenche o mapeamento', () => {
    const text = 'date,title,amount\n2025-03-02,Loja Teste 03/10,45.90\n2025-03-05,Pagamento recebido,-500.00\n'
    const s = sniffCsv(text)
    expect(s).toMatchObject({ sep: ',', start: 0, header: ['date', 'title', 'amount'], preset: 'nubank-cartao' })
    expect(s.mapping).toEqual({ date: 0, description: 1, amount: 2, debit: -1, credit: -1, expensesPositive: true })
    const st = parseMappedCsv(text, s, s.mapping, 'Nu Cartão')
    expect(st).toMatchObject({ institution: 'Nu Cartão', kind: 'cartao', externalId: 'csv:nubank-cartao:nu cartao' })
    expect(st.rows).toEqual([
      { date: '2025-03-02', description: 'Loja Teste 03/10', amountCents: -4590, fitid: null },
      { date: '2025-03-05', description: 'Pagamento recebido', amountCents: 50000, fitid: null },
    ])
  })

  test('ponto e vírgula com preâmbulo, vírgula decimal e colunas de débito e crédito; linha de saldo é pulada', () => {
    const text = 'Banco Laranja - extrato\nAgência 1;Conta 2\n\nData;Histórico;Débito;Crédito;Saldo\n05/03/2025;PIX ENVIADO;-1.150,00;;1.000,00\n06/03/2025;SALARIO;;3.000,00;4.000,00\n07/03/2025;SALDO DO DIA;;;4.000,00\n'
    const s = sniffCsv(text)
    expect(s).toMatchObject({ sep: ';', start: 3, mapping: { date: 0, description: 1, amount: -1, debit: 2, credit: 3, expensesPositive: false } })
    expect(parse(text).rows.map(r => [r.date, r.description, r.amountCents])).toEqual([['2025-03-05', 'PIX ENVIADO', -115000], ['2025-03-06', 'SALARIO', 300000]])
  })

  test('tabulação, data dd/mm/aa e dd-mm-aaaa, coluna escolhida à mão e sinal invertido', () => {
    const text = 'Quando\tO quê\tQuanto\n02/03/25\tMercado\t12,34\n03-03-2025\tFarmácia\t1.000,50\n'
    const s = sniffCsv(text)
    expect(s).toMatchObject({ sep: '\t', mapping: { date: -1, description: -1, amount: -1 } })
    expect(() => parseMappedCsv(text, s, s.mapping, 'C')).toThrow(/coluna da data/)
    const st = parse(text, 'Cartão Azul', { date: 0, description: 1, amount: 2, expensesPositive: true })
    expect(st.kind).toBe('cartao')
    expect(st.rows.map(r => [r.date, r.amountCents])).toEqual([['2025-03-02', -1234], ['2025-03-03', -100050]])
  })

  test('erro com o número da linha', () => {
    expect(() => parse('Data;Descrição;Valor\n02/03/2025;A;1,00\nontem;B;2,00')).toThrow(/Linha 3.*Data inválida/)
    expect(() => parse('Data;Descrição;Valor\n02/03/2025;A;abc')).toThrow(/Linha 2/)
  })
})
