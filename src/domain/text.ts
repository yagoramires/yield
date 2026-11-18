import type { Account } from './records'
import type { Month } from './types'

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
export const monthName = (m: Month) => MONTHS[Number(m.slice(5, 7)) - 1]
export const accountLabel = (a: Account | undefined) => (a ? `${a.name}${a.number ? ` ···${a.number.replace(/\D/g, '').slice(-4)}` : ''}` : '—')
export const brDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
