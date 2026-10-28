import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
const invoke = vi.fn(async (cmd: string, args: { key: string; value?: string }) => {
  if (cmd === 'secret_get') return store.get(args.key) ?? null
  if (cmd === 'secret_set') store.set(args.key, args.value!)
  if (cmd === 'secret_delete') store.delete(args.key)
  return undefined
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: Parameters<typeof invoke>) => invoke(...a) }))

let clearPluggyCredentials: typeof import('./secrets').clearPluggyCredentials
let getPluggyCredentials: typeof import('./secrets').getPluggyCredentials
let setPluggyCredentials: typeof import('./secrets').setPluggyCredentials

beforeEach(async () => {
  store.clear()
  invoke.mockClear()
  vi.resetModules() // o cache da sessão fica no módulo
  ;({ clearPluggyCredentials, getPluggyCredentials, setPluggyCredentials } = await import('./secrets'))
})

describe('credenciais da Pluggy', () => {
  it('grava com trim e lê de volta', async () => {
    await setPluggyCredentials('  id ', ' segredo\n')
    expect([...store.keys()]).toEqual(['yield.credentials'])
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

  it('lê o cofre uma vez por sessão, e de novo depois de uma recusa', async () => {
    store.set('pluggy.clientId', 'id'); store.set('pluggy.clientSecret', 's')
    invoke.mockRejectedValueOnce(new Error('negado'))
    await expect(getPluggyCredentials()).rejects.toThrow('negado')
    await getPluggyCredentials()
    await getPluggyCredentials()
    // recusa (1) + item único vazio (1) + os 4 itens antigos migrados (4); a terceira leitura vem do cache
    expect(invoke.mock.calls.filter(c => c[0] === 'secret_get')).toHaveLength(6)
  })
})
