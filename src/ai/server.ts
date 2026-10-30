import { Channel, invoke } from '@tauri-apps/api/core'
import type { CatalogModel, Hardware } from './catalog'
import type { Post } from './llm'
import { getAiSettings } from './settings'

/** Sobe o llama-server com o modelo (o Rust espera ficar pronto); desliga sozinho após 10 min sem uso. */
export async function ensureServer(m: CatalogModel): Promise<void> {
  if (getAiSettings().off) throw new Error('O Assistente está desligado em Configurações.')
  await invoke('ai_start', { file: m.file, ctx: m.ctx })
}

/** O Rust faz o POST (sem proxy e com a chave que só ele conhece) e manda os pedaços pelo canal; "" marca o fim. */
export const tauriPost: Post = (path, body, onChunk) => new Promise((resolve, reject) => {
  const ch = new Channel<string>()
  let ended = false
  let result: string | null = null
  ch.onmessage = t => {
    if (t !== '') return onChunk?.(t)
    ended = true
    if (result !== null) resolve(result)
  }
  invoke<string>('ai_post', { path, body: JSON.stringify(body), onChunk: ch }).then(r => {
    // em streaming os últimos pedaços podem chegar depois da resposta do invoke: espera o "" do fim
    if (!onChunk || ended) resolve(r)
    else result = r
  }, reject)
})

export const abort = () => invoke('ai_abort')
export const stopServer = () => invoke('ai_stop')

// a máquina não muda com o app aberto: detecta uma vez por sessão
let hwOnce: Promise<Hardware> | null = null
export const getHardware = () => (hwOnce ??= invoke<Hardware>('ai_hardware'))
