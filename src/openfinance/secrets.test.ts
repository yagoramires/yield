import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
const invoke = vi.fn(async (cmd: string, args: { key: string; value?: string }) => {
  if (cmd === 'secret_get') return store.get(args.key) ?? null
  if (cmd === 'secret_set') store.set(args.key, args.value!)
  if (cmd === 'secret_delete') store.delete(args.key)
  return undefined
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: Parameters<typeof invoke>) => invoke(...a) }))

import { clearPluggyCredentials, getPluggyCredentials, setPluggyCredentials } from './secrets'

beforeEach(() => {
  store.clear()
  invoke.mockClear()
})

describe('credenciais da Pluggy', () => {
  it('grava com trim e lê de volta', async () => {
    await setPluggyCredentials('  id ', ' segredo\n')
    expect(store.get('pluggy.clientId')).toBe('id')
    expect(await getPluggyCredentials()).toEqual({ clientId: 'id', clientSecret: 'segredo' })
  })

  it('vazio lança erro sem chamar o cofre', async () => {
    await expect(setPluggyCredentials('id', '   ')).rejects.toThrow('Preencha o Client ID e o Client Secret.')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('devolve null se faltar qualquer uma', async () => {
    store.set('pluggy.clientId', 'id')
    expect(await getPluggyCredentials()).toBeNull()
  })

  it('clear apaga as duas', async () => {
    await setPluggyCredentials('id', 's')
    await clearPluggyCredentials()
    expect(store.size).toBe(0)
  })
})
