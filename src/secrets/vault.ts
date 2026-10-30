import { invoke } from '@tauri-apps/api/core'

/**
 * As credenciais ficam no Rust (cofre do sistema, um item só, lido uma vez por sessão) e nunca chegam ao JavaScript:
 * aqui só se sabe se existem, e as chamadas que precisam delas (/auth da Pluggy, GET assinado da Binance) rodam no Rust.
 */
export interface VaultStatus { pluggy: boolean; binance: boolean }
export const vaultStatus = () => invoke<VaultStatus>('vault_status')

export interface HttpReply { status: number; body: string; retryAfter: string | null }

/** Resposta que o Rust trouxe, no formato do fetch, para os clientes tratarem igual. */
export function toResponse(r: HttpReply): Response {
  const noBody = r.status === 204 || r.status === 205 || r.status === 304
  return new Response(noBody ? null : r.body, { status: r.status, headers: r.retryAfter ? { 'Retry-After': r.retryAfter } : {} })
}
