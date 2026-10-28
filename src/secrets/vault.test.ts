import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
const invoke = vi.fn(async (cmd: string, args: { key: string; value?: string }) => {
  if (cmd === 'secret_get') return store.get(args.key) ?? null
  if (cmd === 'secret_set') store.set(args.key, args.value!)
  if (cmd === 'secret_delete') store.delete(args.key)
  return undefined
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: Parameters<typeof invoke>) => invoke(...a) }))

let vault: typeof import('./vault')
const fresh = async () => { vi.resetModules(); vault = await import('./vault'); invoke.mockClear() } // o cache da sessão fica no módulo
beforeEach(async () => { store.clear(); await fresh() })

describe('cofre único', () => {
  it('Pluggy e Binance no mesmo item: uma leitura do Keychain por sessão', async () => {
    await vault.updateVault({ pluggy: { clientId: 'id', clientSecret: 's' } })
    await vault.updateVault({ binance: { apiKey: 'k', secret: 'b' } })
    expect([...store.keys()]).toEqual(['yield.credentials'])
    await fresh()
    expect(await vault.readVault()).toEqual({ pluggy: { clientId: 'id', clientSecret: 's' }, binance: { apiKey: 'k', secret: 'b' } })
    await vault.readVault()
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('apagar uma parte mantém a outra; vazio apaga o item', async () => {
    await vault.updateVault({ pluggy: { clientId: 'id', clientSecret: 's' }, binance: { apiKey: 'k', secret: 'b' } })
    await vault.updateVault({ binance: undefined })
    expect(await vault.readVault()).toEqual({ pluggy: { clientId: 'id', clientSecret: 's' } })
    await vault.updateVault({ pluggy: undefined })
    expect(store.size).toBe(0)
  })

  it('itens antigos (um por credencial) migram para o item único e somem', async () => {
    store.set('pluggy.clientId', 'id'); store.set('pluggy.clientSecret', 's')
    expect(await vault.readVault()).toEqual({ pluggy: { clientId: 'id', clientSecret: 's' } })
    expect([...store.keys()]).toEqual(['yield.credentials'])
    await fresh()
    await vault.readVault()
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('negou no pedido do Keychain: não guarda o erro, tenta de novo', async () => {
    invoke.mockRejectedValueOnce(new Error('negado'))
    await expect(vault.readVault()).rejects.toThrow('negado')
    store.set('yield.credentials', JSON.stringify({ binance: { apiKey: 'k', secret: 'b' } }))
    expect(await vault.readVault()).toEqual({ binance: { apiKey: 'k', secret: 'b' } })
  })
})
