import { darfDueDate, isBusinessDay, lastBusinessDayOfMonth, nationalHolidays } from './calendar'

describe('calendar', () => {
  it('lastBusinessDayOfMonth', () => {
    expect(lastBusinessDayOfMonth('2024-03')).toBe('2024-03-28') // 29 = Sexta-feira Santa, 30–31 fim de semana
    expect(lastBusinessDayOfMonth('2022-02')).toBe('2022-02-25') // 28 = segunda de Carnaval
    expect(lastBusinessDayOfMonth('2025-02')).toBe('2025-02-28')
  })
  it('isBusinessDay', () => {
    expect(isBusinessDay('2024-11-20')).toBe(false) // Consciência Negra, nacional desde 2024
    expect(isBusinessDay('2023-11-20')).toBe(true)
    expect(isBusinessDay('2024-02-13')).toBe(false) // terça de Carnaval
    expect(isBusinessDay('2024-05-30')).toBe(false) // Corpus Christi
    expect(isBusinessDay('2024-12-25')).toBe(false)
    expect(isBusinessDay('2024-06-15')).toBe(false) // sábado
    expect(isBusinessDay('2024-06-17')).toBe(true)
  })
  it('nationalHolidays: Páscoa 2024 = 31/03', () => {
    const h = nationalHolidays(2024)
    expect(h).toContain('2024-03-29')
    expect(h).toContain('2024-02-12')
    expect(nationalHolidays(2023)).not.toContain('2023-11-20')
  })
  it('darfDueDate', () => {
    expect(darfDueDate('2024-02')).toBe('2024-03-28')
    expect(darfDueDate('2025-11')).toBe('2025-12-30') // 31/12 é o último dia útil do ano, sem expediente
    expect(darfDueDate('2022-11')).toBe('2022-12-29') // 31/12/2022 foi sábado → último útil 30 → vence 29
  })
})
