import { describe, expect, it } from 'vitest'
import { isoToBR, maskBR, monthGrid, parseBR } from './dateText'

describe('campo de data', () => {
  it('máscara põe as barras enquanto digita e corta no tamanho', () => {
    expect(['1', '16', '160', '1608', '16082', '16082021', '16/08/20219', 'a1b6'].map(maskBR)).toEqual(['1', '16', '16/0', '16/08', '16/08/2', '16/08/2021', '16/08/2021', '16'])
  })
  it('lê dd/mm/aaaa completo e válido; o resto é null', () => {
    expect(parseBR('16/08/2021')).toBe('2021-08-16')
    expect(['31/02/2024', '16/08/21', '00/01/2024', ''].map(parseBR)).toEqual([null, null, null, null])
    expect(isoToBR('2021-08-16')).toBe('16/08/2021')
    expect(isoToBR('')).toBe('')
  })
  it('grade do mês: 6 semanas começando no domingo, marcando o que é do mês', () => {
    const g = monthGrid(2021, 7) // agosto/2021 começa num domingo
    expect(g).toHaveLength(42)
    expect(g[0]).toEqual({ iso: '2021-08-01', inMonth: true })
    expect(g[30]).toEqual({ iso: '2021-08-31', inMonth: true })
    expect(g[31]).toEqual({ iso: '2021-09-01', inMonth: false })
    expect(monthGrid(2026, 9)[0]).toEqual({ iso: '2026-09-27', inMonth: false }) // outubro/2026 começa numa quinta
  })
})
