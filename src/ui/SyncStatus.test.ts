import { expect, it } from 'vitest'
import { ago, localStamp } from './SyncStatus'

it('ago: agora, minutos, horas, ontem e data', () => {
  const now = Date.parse('2026-10-30T12:00:00Z')
  expect([null, '2026-10-30T11:59:40Z', '2026-10-30T11:15:00Z', '2026-10-30T07:00:00Z', '2026-10-29T10:00:00Z', '2026-10-20T10:00:00Z'].map(i => ago(i, now)))
    .toEqual(['nunca', 'agora', 'há 45 min', 'há 5 h', 'ontem', '20/10'])
})

it('localStamp mostra a hora local, não a do UTC gravado', () => {
  const d = new Date(2026, 9, 30, 14, 5) // 30/10 14:05 local
  expect(localStamp(d.toISOString())).toBe('30/10 às 14:05')
})
