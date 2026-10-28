import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
const invoke = vi.fn(async (cmd: string, args: { key: string; value?: string }) => {
  if (cmd === 'secret_get') return store.get(args.key) ?? null
  if (cmd === 'secret_set') store.set(args.key, args.value!)
  if (cmd === 'secret_delete') store.delete(args.key)
  return undefined
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: Parameters<typeof invoke>) => invoke(...a) }))

let mod: typeof import('./secrets')
beforeEach(async () => {
  store.clear()
  invoke.mockClear()
  vi.resetModules() // o cache da sessão fica no módulo
  mod = await import('./secrets')
})

describe('chave da Binance', () => {
  it('grava com trim e lê de volta uma vez por sessão', async () => {
    await mod.setBinanceCredentials('  chave ', ' segredo\n')
    expect(store.get('binance.apiKey')).toBe('chave')
    vi.resetModules(); mod = await import('./secrets'); invoke.mockClear()
    expect(await mod.getBinanceCredentials()).toEqual({ apiKey: 'chave', secret: 'segredo' })
    await mod.getBinanceCredentials()
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('vazio lança erro sem chamar o cofre', async () => {
    await expect(mod.setBinanceCredentials('chave', '  ')).rejects.toThrow('Preencha a API Key e a Secret Key.')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('remover apaga as duas', async () => {
    await mod.setBinanceCredentials('chave', 'segredo')
    await mod.clearBinanceCredentials()
    expect(store.size).toBe(0)
    expect(await mod.getBinanceCredentials()).toBeNull()
  })
})
