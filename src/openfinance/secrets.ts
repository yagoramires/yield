import { invoke } from '@tauri-apps/api/core'

export const SECRET_KEYS = { clientId: 'pluggy.clientId', clientSecret: 'pluggy.clientSecret' } as const

type Creds = { clientId: string; clientSecret: string }
const read = (key: string) => invoke<string | null>('secret_get', { key })

// Cada leitura do Keychain pode abrir o pedido de senha do macOS: lê uma vez por sessão.
let cached: Promise<Creds | null> | null = null

export function getPluggyCredentials(): Promise<Creds | null> {
  cached ??= Promise.all([read(SECRET_KEYS.clientId), read(SECRET_KEYS.clientSecret)])
    .then(([clientId, clientSecret]) => (clientId && clientSecret ? { clientId, clientSecret } : null))
    .catch(e => { cached = null; throw e }) // negou no pedido: tenta de novo na próxima
  return cached
}

export async function setPluggyCredentials(clientId: string, clientSecret: string): Promise<void> {
  const id = clientId.trim()
  const secret = clientSecret.trim()
  if (!id || !secret) throw new Error('Preencha o Client ID e o Client Secret.')
  cached = null
  await invoke('secret_set', { key: SECRET_KEYS.clientId, value: id })
  await invoke('secret_set', { key: SECRET_KEYS.clientSecret, value: secret })
  cached = Promise.resolve({ clientId: id, clientSecret: secret })
}

export async function clearPluggyCredentials(): Promise<void> {
  cached = null
  await invoke('secret_delete', { key: SECRET_KEYS.clientId })
  await invoke('secret_delete', { key: SECRET_KEYS.clientSecret })
  cached = Promise.resolve(null)
}
