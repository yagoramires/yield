import { readVault, updateVault } from '../secrets/vault'

export function getPluggyCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
  return readVault().then(v => v.pluggy ?? null)
}

export async function setPluggyCredentials(clientId: string, clientSecret: string): Promise<void> {
  const id = clientId.trim()
  const secret = clientSecret.trim()
  if (!id || !secret) throw new Error('Preencha o Client ID e o Client Secret.')
  await updateVault({ pluggy: { clientId: id, clientSecret: secret } })
}

export const clearPluggyCredentials = () => updateVault({ pluggy: undefined })
