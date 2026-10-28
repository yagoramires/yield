import { beforeEach, describe, expect, test } from 'vitest'
import { formatCnpj } from '../domain/declaracao'
import { addIssuers, loadCadastro, saveBroker, saveIssuer } from './irRepo'
import { createTestDb, type Db } from './testDb'

let db: Db
beforeEach(() => { db = createTestDb() })

// CNPJs inventados com dígito verificador válido
const A = '11.222.333/0001-81'

describe('formatCnpj', () => {
  test('aceita com ou sem pontuação e formata', () => {
    expect(formatCnpj('11222333000181')).toBe(A)
    expect(formatCnpj(' 11.222.333/0001-81 ')).toBe(A)
  })
  test('aceita o CNPJ alfanumérico (letras nas 12 primeiras posições), em maiúsculas', () => {
    expect(formatCnpj('12abc34501de35')).toBe('12.ABC.345/01DE-35')
    expect(() => formatCnpj('12.ABC.345/01DE-36')).toThrow('CNPJ inválido')
  })
  test('recusa dígito verificador errado, tamanho errado e vazio', () => {
    for (const bad of ['11.222.333/0001-82', '1122233300018', '', '00.000.000/0000-00', '11111111111111']) expect(() => formatCnpj(bad)).toThrow('CNPJ inválido: confira os 14 números')
  })
})

describe('cadastro da declaração', () => {
  test('salva e lê empresas e corretoras, com nome aparado e CNPJ formatado', async () => {
    await saveIssuer(db, { ticker: 'aaaa3', name: ' Empresa Exemplo S.A. ', cnpj: '11222333000181' })
    await saveBroker(db, { code: 'CORRETORA ALFA', name: 'Corretora Alfa S.A.', cnpj: A })
    await saveIssuer(db, { ticker: 'AAAA3', name: 'Empresa Exemplo SA', cnpj: A })
    expect(await loadCadastro(db)).toEqual({
      issuers: [{ ticker: 'AAAA3', name: 'Empresa Exemplo SA', cnpj: A }],
      brokers: [{ code: 'CORRETORA ALFA', name: 'Corretora Alfa S.A.', cnpj: A }],
    })
    await expect(saveIssuer(db, { ticker: 'BBBB11', name: '  ', cnpj: A })).rejects.toThrow('Razão social')
  })
  test('addIssuers só acrescenta: o que foi editado à mão fica', async () => {
    await saveIssuer(db, { ticker: 'AAAA3', name: 'Editada à mão', cnpj: A })
    expect(await addIssuers(db, [{ ticker: 'AAAA3', name: 'Da B3', cnpj: A }, { ticker: 'BBBB11', name: 'Fundo Exemplo', cnpj: A }])).toBe(1)
    expect((await loadCadastro(db)).issuers.map(i => [i.ticker, i.name])).toEqual([['AAAA3', 'Editada à mão'], ['BBBB11', 'Fundo Exemplo']])
  })
})
