import { addMonths, formatBRL, monthOf, monthsBetween } from './money'

const nbsp = new RegExp(String.fromCharCode(160), 'g')

describe('money', () => {
  it('formatBRL', () => {
    expect(formatBRL(123456).replace(nbsp, ' ')).toBe('R$ 1.234,56')
    expect(formatBRL(-5).replace(nbsp, ' ')).toBe('-R$ 0,05')
  })
  it('monthOf', () => {
    expect(monthOf('2024-03-15')).toBe('2024-03')
  })
  it('addMonths', () => {
    expect(addMonths('2024-12', 1)).toBe('2025-01')
    expect(addMonths('2024-01', -1)).toBe('2023-12')
    expect(addMonths('2024-03', 0)).toBe('2024-03')
  })
  it('monthsBetween é inclusivo', () => {
    expect(monthsBetween('2023-11', '2024-02')).toEqual(['2023-11', '2023-12', '2024-01', '2024-02'])
    expect(monthsBetween('2024-05', '2024-05')).toEqual(['2024-05'])
    expect(monthsBetween('2024-05', '2024-04')).toEqual([])
  })
})
