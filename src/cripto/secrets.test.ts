import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BINANCE_BASE } from './binance'
import { clearBinanceCredentials, getBinanceSend, setBinanceCredentials } from './secrets'

const status = { pluggy: false, binance: false }
const invoke = vi.fn(async (cmd: string, _args?: unknown): Promise<unknown> => {
  if (cmd === 'vault_status') return status
  if (cmd === 'binance_get') return { status: 200, body: '{"balances":[]}', retryAfter: null }
  return undefined
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: unknown) => invoke(cmd, args) }))

beforeEach(() => { invoke.mockClear(); status.binance = false })

describe('chave da Binance', () => {
  it('grava com trim no Rust; vazio lança sem chamar o cofre', async () => {
    await setBinanceCredentials(' k ', ' s\n')
    expect(invoke).toHaveBeenCalledWith('vault_set_binance', { apiKey: 'k', secret: 's' })
    invoke.mockClear()
    await expect(setBinanceCredentials('', 's')).rejects.toThrow('Preencha')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('o GET vai para o Rust só com caminho e consulta; a assinatura é feita lá', async () => {
    expect(await getBinanceSend()).toBeNull()
    status.binance = true
    const send = (await getBinanceSend())!
    const res = await send(`${BINANCE_BASE}/api/v3/account?timestamp=1&recvWindow=10000`)
    expect(await res.json()).toEqual({ balances: [] })
    expect(invoke).toHaveBeenLastCalledWith('binance_get', { path: '/api/v3/account', query: 'timestamp=1&recvWindow=10000' })
  })

  it('erro do Rust: rede vira "Sem conexão"; o resto chega com a mensagem real', async () => {
    status.binance = true
    const send = (await getBinanceSend())!
    const url = `${BINANCE_BASE}/api/v3/account?timestamp=1`
    invoke.mockRejectedValueOnce('rede')
    await expect(send(url)).rejects.toMatchObject({ kind: 'rede', message: 'Sem conexão com a Binance' })
    invoke.mockRejectedValueOnce('Chamada não permitida: o Yield só lê dados da Binance')
    await expect(send(url)).rejects.toMatchObject({ kind: 'chave', message: /não permitida/ })
  })

  it('apagar tira só a parte da Binance', async () => {
    await clearBinanceCredentials()
    expect(invoke).toHaveBeenCalledWith('vault_clear', { part: 'binance' })
  })
})
