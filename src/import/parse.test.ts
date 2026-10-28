import { describe, expect, test } from 'vitest'
import { normalizeBroker, parseBRDate, parseBRL, parseDecimal, parseQty } from './parse'

describe('parseBRL', () => {
  test('formatos brasileiros', () => {
    expect(parseBRL('1.234,56')).toBe(123456)
    expect(parseBRL('R$ 10,85')).toBe(1085)
    expect(parseBRL('-1,00')).toBe(-100)
    expect(parseBRL('(1,00)')).toBe(-100)
  })
  test('vazio vira zero', () => {
    for (const v of ['-', '', null, undefined]) expect(parseBRL(v)).toBe(0)
  })
  test('texto sem nenhum dígito lança', () => {
    for (const v of ['abc', 'R$', ',']) expect(() => parseBRL(v)).toThrow('Número inválido')
    expect(() => parseQty('abc')).toThrow('Número inválido')
  })
  test('número do Excel é reais, sem erro de ponto flutuante', () => {
    expect(parseBRL(10.85)).toBe(1085)
    expect(parseBRL(1.005)).toBe(101)
    expect(parseBRL(1e-14)).toBe(0)
    expect(parseBRL(1.4210854715202004e-14)).toBe(0)
  })
})

describe('parseQty', () => {
  test('milhar e vazios', () => {
    expect(parseQty('1.000')).toBe(1000)
    expect(parseQty(10)).toBe(10)
    expect(parseQty('-')).toBe(0)
    expect(parseQty(null)).toBe(0)
  })
})

describe('parseBRDate', () => {
  test('dd/mm/aaaa e serial do Excel', () => {
    expect(parseBRDate('05/01/2024')).toBe('2024-01-05')
    expect(parseBRDate(45296)).toBe('2024-01-05')
    expect(parseBRDate(45296.5)).toBe('2024-01-05')
  })
  test('data inválida lança', () => {
    expect(() => parseBRDate('lixo')).toThrow()
  })
})

describe('normalizeBroker', () => {
  test.each([
    ['CLEAR CORRETORA - GRUPO XP', 'CLEAR'],
    ['INTER DTVM', 'INTER'],
    ['BTG PACTUAL CTVM S/A', 'BTG'],
    ['BANCO INTER S.A.', 'INTER'],
    ['Banco BTG Pactual S.A.', 'BTG'],
    ['XP INVESTIMENTOS CCTVM S/A', 'XP'],
    ['xp', 'XP'],
    ['RICO INVESTIMENTOS - GRUPO XP', 'RICO'],
    ['  rico   investimentos ', 'RICO'],
    ['NU INVEST CORRETORA DE VALORES S.A.', 'NU'],
    ['ITAÚ CORRETORA DE VALORES S/A', 'ITAU'],
    ['SAFRA CORRETORA DE VALORES E CÂMBIO LTDA', 'SAFRA'],
    ['TORO CTVM LTDA', 'TORO'],
    ['BB BANCO DE INVESTIMENTO S.A.', 'BB'],
    ['GENIAL INSTITUCIONAL CCTVM S/A', 'GENIAL INSTITUCIONAL'],
    ['SEM NOTA', 'SEM NOTA'],
    ['', ''],
  ])('%s → %s', (raw, key) => {
    expect(normalizeBroker(raw)).toBe(key)
    expect(normalizeBroker(key)).toBe(key) // idempotente: chaves gravadas não mudam ao relê-las
  })
})

describe('parseDecimal', () => {
  test('com vírgula: pt-BR', () => {
    expect(parseDecimal('1,500')).toBe(1.5)
    expect(parseDecimal('0,01')).toBe(0.01)
    expect(parseDecimal('1.234,5')).toBe(1234.5)
    expect(() => parseDecimal('1.23,5')).toThrow()
    expect(() => parseDecimal('1,2,3')).toThrow()
  })
  test('sem vírgula e sem ponto', () => { expect(parseDecimal('12')).toBe(12); expect(parseDecimal('1500')).toBe(1500) })
  test('0. inicial é decimal', () => {
    for (const [s, n] of [['0.001', 0.001], ['0.010', 0.01], ['0.500', 0.5], ['0.123', 0.123], ['0.01', 0.01]] as const) expect(parseDecimal(s)).toBe(n)
  })
  test('dois ou mais pontos em grupos de milhar', () => { expect(parseDecimal('1.234.567')).toBe(1234567) })
  test('ponto único com 3 dígitos e inteiro ≠ 0 é ambíguo', () => {
    expect(() => parseDecimal('1.500')).toThrow(/Valor ambíguo/)
    expect(() => parseDecimal('1.000')).toThrow(/Valor ambíguo/)
  })
  test('ponto único com 1, 2 ou 4+ dígitos é decimal', () => {
    expect(parseDecimal('1.5')).toBe(1.5); expect(parseDecimal('2.25')).toBe(2.25); expect(parseDecimal('1.2345')).toBe(1.2345)
  })
  test('rejeita o resto', () => {
    for (const bad of ['1.5.5', '1..2', 'abc', '', '-1', '1.23.456']) expect(() => parseDecimal(bad)).toThrow()
  })
})
