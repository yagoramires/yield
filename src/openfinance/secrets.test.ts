import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPluggyCredentials, getPluggyAuth, setPluggyCredentials } from './secrets'

const status = { pluggy: false, binance: false }
const invoke = vi.fn(async (cmd: string, _args?: unknown): Promise<unknown> => {
  if (cmd === 'vault_status') return status
  if (cmd === 'pluggy_auth') return { status: 200, body: '{"apiKey":"K"}', retryAfter: null }
  return undefined
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: unknown) => invoke(cmd, args) }))

beforeEach(() => { invoke.mockClear(); status.pluggy = false })

describe('credenciais da Pluggy', () => {
  it('grava com trim no Rust; vazio lança sem chamar o cofre', async () => {
    await setPluggyCredentials('  id ', ' segredo\n')
    expect(invoke).toHaveBeenCalledWith('vault_set_pluggy', { clientId: 'id', clientSecret: 'segredo' })
    invoke.mockClear()
    await expect(setPluggyCredentials('id', '  ')).rejects.toThrow('Preencha')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('sem credenciais não há /auth; com elas o /auth é o comando do Rust e o JS nunca recebe o segredo', async () => {
    expect(await getPluggyAuth()).toBeNull()
    status.pluggy = true
    const auth = (await getPluggyAuth())!
    const res = await auth()
    expect(await res.json()).toEqual({ apiKey: 'K' })
    expect(invoke.mock.calls.map(c => c[0])).toEqual(['vault_status', 'vault_status', 'pluggy_auth'])
    expect(invoke.mock.calls.every(c => c[0] !== 'pluggy_auth' || c[1] === undefined)).toBe(true)
  })

  it('erro do Rust: rede vira "Sem conexão"; o resto chega com a mensagem real', async () => {
    status.pluggy = true
    const auth = (await getPluggyAuth())!
    invoke.mockRejectedValueOnce('rede')
    await expect(auth()).rejects.toMatchObject({ kind: 'rede', message: 'Sem conexão com a Pluggy' })
    invoke.mockRejectedValueOnce('User canceled the operation.')
    await expect(auth()).rejects.toMatchObject({ kind: 'credenciais', message: 'User canceled the operation.' })
  })

  it('apagar tira só a parte da Pluggy', async () => {
    await clearPluggyCredentials()
    expect(invoke).toHaveBeenCalledWith('vault_clear', { part: 'pluggy' })
  })
})
