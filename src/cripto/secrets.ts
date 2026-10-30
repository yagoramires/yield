import { invoke } from '@tauri-apps/api/core'
import { toResponse, vaultStatus, type HttpReply } from '../secrets/vault'
import { BinanceError, type BinanceSend } from './binance'

// o Rust devolve 'rede' quando a Binance não respondeu; o resto (cofre recusado, chave apagada, chamada recusada) vai com a mensagem dele
const send: BinanceSend = url => {
  const u = new URL(url)
  return invoke<HttpReply>('binance_get', { path: u.pathname, query: u.search.slice(1) }).then(toResponse, e => {
    throw e === 'rede' ? new BinanceError('Sem conexão com a Binance', 'rede') : new BinanceError(String(e), 'chave')
  })
}

/** `null` sem chave salva; senão, o GET assinado pelo Rust (a secret não sai de lá). */
export function getBinanceSend(): Promise<BinanceSend | null> {
  return vaultStatus().then(s => (s.binance ? send : null))
}

export async function setBinanceCredentials(apiKey: string, secret: string): Promise<void> {
  const k = apiKey.trim()
  const s = secret.trim()
  if (!k || !s) throw new Error('Preencha a API Key e a Secret Key.')
  await invoke('vault_set_binance', { apiKey: k, secret: s })
}

export const clearBinanceCredentials = () => invoke<void>('vault_clear', { part: 'binance' })
