// Cliente da API OpenAI do llama-server. Sem Tauri aqui: o `post` vem de fora (Rust no app, fetch do Node na bateria).

/** POST no servidor local; com `onChunk` o corpo vem em pedaços de texto (SSE) e a promessa devolve "". */
export type Post = (path: string, body: object, onChunk?: (text: string) => void) => Promise<string>

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ChatMsg { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }

// Qwen3 sem a etapa de "pensar": responde mais rápido e o texto pensado não vaza para a tela.
const NO_THINK = { chat_template_kwargs: { enable_thinking: false } }

/** Eventos `data: …` completos do buffer; o que ficou cortado volta em `rest`. */
export function parseSse(buffer: string): { events: unknown[]; rest: string } {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  const events = lines.flatMap(l => {
    const data = l.startsWith('data: ') ? l.slice(6).trim() : null
    return data && data !== '[DONE]' ? [JSON.parse(data)] : []
  })
  return { events, rest }
}

interface StreamChoice { delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }

export async function chatStream(post: Post, body: object, onText: (t: string) => void): Promise<{ finish: string; content: string; toolCalls: ToolCall[] }> {
  let buf = '', content = '', finish = 'stop'
  const calls: ToolCall[] = []
  await post('/v1/chat/completions', { ...body, ...NO_THINK, stream: true }, chunk => {
    const { events, rest } = parseSse(buf + chunk)
    buf = rest
    for (const e of events as { choices?: StreamChoice[] }[]) {
      const c = e.choices?.[0]
      if (!c) continue
      if (c.delta?.content) { content += c.delta.content; onText(c.delta.content) }
      for (const t of c.delta?.tool_calls ?? []) {
        const cur = (calls[t.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } })
        if (t.id) cur.id = t.id
        if (t.function?.name) cur.function.name += t.function.name
        if (t.function?.arguments) cur.function.arguments += t.function.arguments
      }
      if (c.finish_reason) finish = c.finish_reason
    }
  })
  return { finish, content, toolCalls: calls.filter(Boolean) }
}

export async function chatOnce(post: Post, body: object): Promise<ChatMsg> {
  return JSON.parse(await post('/v1/chat/completions', { ...body, ...NO_THINK, stream: false })).choices[0].message
}

/** Tokens por segundo gerando ~100 tokens: abaixo de ~8 o Assistente sugere o modelo mais leve. */
export async function calibrate(post: Post): Promise<number> {
  const r = JSON.parse(await post('/completion', { prompt: 'Escreva um parágrafo curto sobre como organizar o orçamento da casa.', n_predict: 100 }))
  return r.timings.predicted_per_second
}
