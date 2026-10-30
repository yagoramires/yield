import { unverified } from './check'
import type { AiInput } from './facts'
import { chatStream, type ChatMsg, type Post, type ToolCall } from './llm'
import { SISTEMA } from './prompts'
import { runTool, TOOLS } from './tools'

const MAX_ROUNDS = 4 // depois disso responde sem ferramentas, para não ficar em laço
const MAX_CHARS = 16_000 // ~metade da janela de 8 192 tokens, para sobrar espaço para a resposta

const NAMES = new Set(TOOLS.map(t => t.function.name))

/** Modelo pequeno às vezes escreve a chamada como texto (`{"name": "carteira", "arguments": {}}`) em vez de chamar. */
function textToolCall(content: string): ToolCall | null {
  const body = content.trim().replace(/^<tool_call>/, '').replace(/<\/tool_call>$/, '').trim()
  if (!body.startsWith('{')) return null
  try {
    const o = JSON.parse(body)
    return NAMES.has(o?.name) ? { id: `texto-${o.name}`, type: 'function', function: { name: o.name, arguments: JSON.stringify(o.arguments ?? {}) } } : null
  } catch { return null }
}

/** Tira as mensagens mais antigas (menos o sistema) até caber; a conversa recomeça sempre numa pergunta. */
export function trimHistory(msgs: ChatMsg[], max = MAX_CHARS): ChatMsg[] {
  const sys = msgs[0]?.role === 'system' ? [msgs[0]] : []
  let rest = msgs.slice(sys.length)
  const size = () => JSON.stringify([...sys, ...rest]).length
  while (rest.length > 1 && (size() > max || rest[0].role !== 'user')) rest = rest.slice(1)
  return [...sys, ...rest]
}

export async function runChat(post: Post, history: ChatMsg[], input: AiInput, loadRent: (meses: number) => Promise<AiInput['rent']>,
  on: { delta(text: string): void; tool(name: string): void }): Promise<{ messages: ChatMsg[]; answer: string; unverified: string[] }> {
  const sys: ChatMsg = { role: 'system', content: `${SISTEMA}\nHoje é ${input.today}; o mês atual é ${input.today.slice(0, 7)}. Mês citado sem ano é o mais recente que já começou (ex.: "setembro" = ${input.today.slice(0, 4)}-09 se já passou). "Este ano" vai de ${input.today.slice(0, 4)}-01 até o mês atual. Para perguntas sobre os dados, use as ferramentas.` }
  let messages = trimHistory([sys, ...history.filter(m => m.role !== 'system')])
  for (let round = 0; ; round++) {
    const tools = round < MAX_ROUNDS
    const r = await chatStream(post, { messages, temperature: 0.2, ...(tools ? { tools: TOOLS } : {}) }, on.delta)
    const asText = r.finish === 'tool_calls' ? null : textToolCall(r.content)
    const calls = r.finish === 'tool_calls' ? r.toolCalls : asText ? [asText] : []
    if (tools && calls.length) {
      messages = [...messages, { role: 'assistant', content: asText ? null : r.content || null, tool_calls: calls }]
      for (const c of calls) {
        on.tool(c.function.name)
        let args: unknown = null
        try { args = JSON.parse(c.function.arguments || '{}') } catch { /* argumento quebrado: a ferramenta devolve o erro */ }
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(await runTool(c.function.name, args, input, loadRent)) })
      }
      continue
    }
    messages = [...messages, { role: 'assistant', content: r.content }]
    return { messages, answer: r.content, unverified: unverified(r.content, messages.filter(m => m.role === 'tool').map(m => m.content ?? '')) }
  }
}
