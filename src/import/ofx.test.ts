import { readFileSync } from 'node:fs'
import { decodeStatement, parseAmount, parseOfx } from './ofx'

const fx = (n: string) => readFileSync(`tests/fixtures/${n}`)
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

test('OFX SGML latin1 de conta: acentos, sinais e conta', () => {
  const s = parseOfx(decodeStatement(buf(fx('extrato-sgml.ofx'))))
  expect(s).toMatchObject({ institution: 'Banco Exemplo', externalId: 'ofx:0999:123456-7', kind: 'conta', number: '4567' })
  expect(s.rows).toEqual([
    { date: '2025-03-02', description: 'PADARIA SÃO JOSÉ', amountCents: -1250, fitid: 'f1' },
    { date: '2025-03-05', description: 'SALARIO EXEMPLO', amountCents: 150000, fitid: 'f2' },
    { date: '2025-03-10', description: 'MERCADO AÇAÍ', amountCents: -3000, fitid: 'f3' },
  ])
})

test('OFX XML de cartão', () => {
  const s = parseOfx(decodeStatement(buf(fx('extrato-cartao.ofx'))))
  expect(s).toMatchObject({ kind: 'cartao', externalId: 'ofx:Banco Exemplo:5555444433221234', number: '1234', institution: 'Banco Exemplo' })
  expect(s.rows.map(r => [r.date, r.description, r.amountCents])).toEqual([['2025-03-10', 'Loja Exemplo', -8990], ['2025-03-12', 'Estorno Loja', 2500]])
})

test('decodeStatement: UTF-8 válido e fallback para windows-1252', () => {
  expect(decodeStatement(buf(Buffer.from('<MEMO>AÇÃO', 'utf8')))).toBe('<MEMO>AÇÃO')
  expect(decodeStatement(buf(Buffer.from('<MEMO>AÇÃO', 'latin1')))).toBe('<MEMO>AÇÃO')
  expect(decodeStatement(buf(Buffer.from('CHARSET:1252\n<MEMO>É', 'latin1')))).toContain('É')
})

test('parseAmount estrito: -12.50 vira -1250 centavos', () => {
  expect(parseAmount('-12.50')).toBe(-1250)
  expect(parseAmount('-12,50')).toBe(-1250)
  expect(parseAmount('+1500.00')).toBe(150000)
  expect(parseAmount('7')).toBe(700)
  for (const bad of ['1.234,56', '1,234.56', 'abc', '']) expect(() => parseAmount(bad)).toThrow(/Valor inválido/)
})
