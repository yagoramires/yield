import { expect, it } from 'vitest'
import { ago } from './SyncStatus'

it('ago: agora, minutos, horas, ontem e data', () => {
  const now = Date.parse('2026-10-30T12:00:00Z')
  expect([null, '2026-10-30T11:59:40Z', '2026-10-30T11:15:00Z', '2026-10-30T07:00:00Z', '2026-10-29T10:00:00Z', '2026-10-20T10:00:00Z'].map(i => ago(i, now)))
    .toEqual(['nunca', 'agora', 'há 45 min', 'há 5 h', 'ontem', '20/10'])
})
