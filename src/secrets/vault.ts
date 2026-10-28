import { invoke } from '@tauri-apps/api/core'

/**
 * Todas as credenciais num item só do Keychain. Sem Team ID da Apple, o macOS reconhece o app pela impressão digital
 * de cada build: cada versão nova pede o Keychain de novo, uma vez por item. Um item só = um pedido por versão.
 * Os nomes têm de estar na lista SECRET_KEYS de src-tauri/src/lib.rs.
 */
export interface Vault { pluggy?: { clientId: string; clientSecret: string }; binance?: { apiKey: string; secret: string } }

const KEY = 'yield.credentials'
const OLD = { pluggyId: 'pluggy.clientId', pluggySecret: 'pluggy.clientSecret', binanceKey: 'binance.apiKey', binanceSecret: 'binance.secret' }
const get = (key: string) => invoke<string | null>('secret_get', { key })

// Cada leitura do Keychain pode abrir o pedido de senha do macOS: lê uma vez por sessão.
let cached: Promise<Vault> | null = null

async function load(): Promise<Vault> {
  const raw = await get(KEY)
  if (raw) return JSON.parse(raw) as Vault
  // versões até a 0.3: um item por credencial. Passa para o item único e apaga os antigos.
  const [pluggyId, pluggySecret, binanceKey, binanceSecret] = await Promise.all(Object.values(OLD).map(get))
  const v: Vault = {
    ...(pluggyId && pluggySecret ? { pluggy: { clientId: pluggyId, clientSecret: pluggySecret } } : {}),
    ...(binanceKey && binanceSecret ? { binance: { apiKey: binanceKey, secret: binanceSecret } } : {}),
  }
  if (v.pluggy || v.binance) {
    await invoke('secret_set', { key: KEY, value: JSON.stringify(v) })
    for (const k of Object.values(OLD)) await invoke('secret_delete', { key: k })
  }
  return v
}

export function readVault(): Promise<Vault> {
  cached ??= load().catch(e => { cached = null; throw e }) // negou no pedido: tenta de novo na próxima
  return cached
}

/** `undefined` numa parte apaga só ela; sem nenhuma parte, o item sai do Keychain. */
export async function updateVault(patch: Partial<Vault>): Promise<void> {
  const next: Vault = { ...(await readVault()), ...patch }
  for (const k of Object.keys(next) as (keyof Vault)[]) if (!next[k]) delete next[k]
  cached = null
  if (next.pluggy || next.binance) await invoke('secret_set', { key: KEY, value: JSON.stringify(next) })
  else await invoke('secret_delete', { key: KEY })
  cached = Promise.resolve(next)
}
