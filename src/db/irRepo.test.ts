import { beforeEach, describe, expect, test } from 'vitest'
import { formatCnpj } from '../domain/declaracao'
import { importCadastro, loadCadastro, saveBroker, saveIssuer } from './irRepo'
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
  test('importar só acrescenta: o que foi editado à mão fica', async () => {
    await saveIssuer(db, { ticker: 'AAAA3', name: 'Editada à mão', cnpj: A })
    const r = await importCadastro(db, { issuers: [{ ticker: 'AAAA3', name: 'Da planilha', cnpj: A }, { ticker: 'BBBB11', name: 'Fundo Exemplo', cnpj: A }], brokers: [{ code: 'X', name: 'Corretora X', cnpj: A }] })
    expect(r).toEqual({ issuers: 1, brokers: 1, skipped: 1 })
    expect((await loadCadastro(db)).issuers.map(i => [i.ticker, i.name])).toEqual([['AAAA3', 'Editada à mão'], ['BBBB11', 'Fundo Exemplo']])
  })
})
