import { readVault, updateVault } from '../secrets/vault'

export function getBinanceCredentials(): Promise<{ apiKey: string; secret: string } | null> {
  return readVault().then(v => v.binance ?? null)
}

export async function setBinanceCredentials(apiKey: string, secret: string): Promise<void> {
  const k = apiKey.trim()
  const s = secret.trim()
  if (!k || !s) throw new Error('Preencha a API Key e a Secret Key.')
  await updateVault({ binance: { apiKey: k, secret: s } })
}

export const clearBinanceCredentials = () => updateVault({ binance: undefined })
