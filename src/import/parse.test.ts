import { describe, expect, test } from 'vitest'
import { normalizeBroker, parseBRDate, parseBRL, parseQty } from './parse'

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
  test('corretoras conhecidas e demais', () => {
    expect(normalizeBroker('CLEAR CORRETORA - GRUPO XP')).toBe('CLEAR')
    expect(normalizeBroker('INTER DTVM')).toBe('INTER')
    expect(normalizeBroker('BTG PACTUAL CTVM S/A')).toBe('BTG')
    expect(normalizeBroker('  rico   investimentos ')).toBe('RICO INVESTIMENTOS')
  })
})
