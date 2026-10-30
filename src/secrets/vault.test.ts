import { expect, it } from 'vitest'
import { toResponse } from './vault'

it('resposta do Rust vira Response com status, corpo e Retry-After', async () => {
  const r = toResponse({ status: 429, body: '{"code":-1003}', retryAfter: '30' })
  expect(r.status).toBe(429)
  expect(r.ok).toBe(false)
  expect(r.headers.get('Retry-After')).toBe('30')
  expect(await r.json()).toEqual({ code: -1003 })
  expect(toResponse({ status: 200, body: 'ok', retryAfter: null }).headers.get('Retry-After')).toBeNull()
  expect(toResponse({ status: 204, body: '', retryAfter: null }).status).toBe(204) // sem corpo: não lança
})
