import { invoke } from '@tauri-apps/api/core'

// Mesmos nomes da lista do cofre em src-tauri/src/lib.rs (SECRET_KEYS).
export const BINANCE_KEYS = { apiKey: 'binance.apiKey', secret: 'binance.secret' } as const

type Creds = { apiKey: string; secret: string }
const read = (key: string) => invoke<string | null>('secret_get', { key })

// Cada leitura do Keychain pode abrir o pedido de senha do macOS: lê uma vez por sessão.
let cached: Promise<Creds | null> | null = null

export function getBinanceCredentials(): Promise<Creds | null> {
  cached ??= Promise.all([read(BINANCE_KEYS.apiKey), read(BINANCE_KEYS.secret)])
    .then(([apiKey, secret]) => (apiKey && secret ? { apiKey, secret } : null))
    .catch(e => { cached = null; throw e }) // negou no pedido: tenta de novo na próxima
  return cached
}

export async function setBinanceCredentials(apiKey: string, secret: string): Promise<void> {
  const k = apiKey.trim()
  const s = secret.trim()
  if (!k || !s) throw new Error('Preencha a API Key e a Secret Key.')
  cached = null
  await invoke('secret_set', { key: BINANCE_KEYS.apiKey, value: k })
  await invoke('secret_set', { key: BINANCE_KEYS.secret, value: s })
  cached = Promise.resolve({ apiKey: k, secret: s })
}

export async function clearBinanceCredentials(): Promise<void> {
  cached = null
  await invoke('secret_delete', { key: BINANCE_KEYS.apiKey })
  await invoke('secret_delete', { key: BINANCE_KEYS.secret })
  cached = Promise.resolve(null)
}
