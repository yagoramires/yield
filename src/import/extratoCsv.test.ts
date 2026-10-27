import { readFileSync } from 'node:fs'
import { detectCsvPreset, parseExtratoCsv } from './extratoCsv'

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
