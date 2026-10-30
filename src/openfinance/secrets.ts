import { invoke } from '@tauri-apps/api/core'
import { toResponse, vaultStatus, type HttpReply } from '../secrets/vault'
import { PluggyError, type PluggyAuth } from './pluggy'

// o Rust devolve 'rede' quando a Pluggy não respondeu; o resto (cofre recusado, credencial apagada) vai com a mensagem dele
const auth: PluggyAuth = () => invoke<HttpReply>('pluggy_auth').then(toResponse, e => {
  throw e === 'rede' ? new PluggyError('Sem conexão com a Pluggy', 'rede') : new PluggyError(String(e), 'credenciais')
})

/** `null` sem credenciais salvas; senão, o /auth feito pelo Rust (o Client Secret não sai de lá). */
export function getPluggyAuth(): Promise<PluggyAuth | null> {
  return vaultStatus().then(s => (s.pluggy ? auth : null))
}

export async function setPluggyCredentials(clientId: string, clientSecret: string): Promise<void> {
  const id = clientId.trim()
  const secret = clientSecret.trim()
  if (!id || !secret) throw new Error('Preencha o Client ID e o Client Secret.')
  await invoke('vault_set_pluggy', { clientId: id, clientSecret: secret })
}

export const clearPluggyCredentials = () => invoke<void>('vault_clear', { part: 'pluggy' })
