import { addMonths } from './money'
import type { ISODate, Month } from './types'

const iso = (t: number): ISODate => new Date(t).toISOString().slice(0, 10)
const DAY = 86_400_000

// Páscoa pelo algoritmo gregoriano anônimo (Meeus/Jones/Butcher), em UTC.
function easter(year: number): number {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const g = Math.floor((8 * b + 13) / 25)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 19 * l) / 433)
  const month = Math.floor((h + l - 7 * m + 90) / 25)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return Date.UTC(year, month - 1, day)
}

export function nationalHolidays(year: number): ISODate[] {
  const fixed = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25']
  if (year >= 2024) fixed.push('11-20') // Consciência Negra, nacional desde 2024
  const p = easter(year)
  return [...fixed.map(md => `${year}-${md}`), ...[-48, -47, -2, 60].map(o => iso(p + o * DAY))]
}

export function isBusinessDay(d: ISODate): boolean {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay()
  return dow !== 0 && dow !== 6 && !nationalHolidays(Number(d.slice(0, 4))).includes(d)
}

const prevBusinessDay = (d: ISODate): ISODate => {
  let t = Date.parse(`${d}T00:00:00Z`)
  do t -= DAY; while (!isBusinessDay(iso(t)))
  return iso(t)
}

export function lastBusinessDayOfMonth(m: Month): ISODate {
  // 1º dia do mês seguinte (mo é 1-based): o dia útil anterior é o último de m
  const [y, mo] = m.split('-').map(Number)
  return prevBusinessDay(iso(Date.UTC(y, mo, 1)))
}

// Em dezembro o último dia útil não tem expediente bancário (Res. CMN 4.880/2020, art. 3º): vence no penúltimo.
export function darfDueDate(apuracao: Month): ISODate {
  const next = addMonths(apuracao, 1)
  const last = lastBusinessDayOfMonth(next)
  return next.endsWith('-12') ? prevBusinessDay(last) : last
}
