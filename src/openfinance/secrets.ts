import { invoke } from '@tauri-apps/api/core'

export const SECRET_KEYS = { clientId: 'pluggy.clientId', clientSecret: 'pluggy.clientSecret' } as const

const read = (key: string) => invoke<string | null>('secret_get', { key })

export async function getPluggyCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
  const [clientId, clientSecret] = await Promise.all([read(SECRET_KEYS.clientId), read(SECRET_KEYS.clientSecret)])
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

export async function setPluggyCredentials(clientId: string, clientSecret: string): Promise<void> {
  const id = clientId.trim()
  const secret = clientSecret.trim()
  if (!id || !secret) throw new Error('Preencha o Client ID e o Client Secret.')
  await invoke('secret_set', { key: SECRET_KEYS.clientId, value: id })
  await invoke('secret_set', { key: SECRET_KEYS.clientSecret, value: secret })
}

export async function clearPluggyCredentials(): Promise<void> {
  await invoke('secret_delete', { key: SECRET_KEYS.clientId })
  await invoke('secret_delete', { key: SECRET_KEYS.clientSecret })
}
