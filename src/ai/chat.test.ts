import { expect, test } from 'vitest'
import { plainBRL } from '../domain/money'
import { runChat, trimHistory } from './chat'
import type { ChatMsg, Post } from './llm'
import { input } from './testInput'

const ev = (o: object) => `data: ${JSON.stringify({ choices: [o] })}\n\n`
/** Servidor falso: cada chamada responde com o próximo roteiro. */
function fake(steps: ((body: { messages: ChatMsg[] }) => string)[]) {
  const bodies: { messages: ChatMsg[]; tools?: unknown }[] = []
  const post: Post = async (_p, body, onChunk) => { bodies.push(body as never); onChunk!(steps[bodies.length - 1](body as never)); return '' }
  return { post, bodies }
}
const toolCall = (name: string, args: object) => () => ev({ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }) + ev({ delta: {}, finish_reason: 'tool_calls' })
const say = (text: string) => () => ev({ delta: { content: text } }) + ev({ delta: {}, finish_reason: 'stop' })
const on = { delta: () => {}, tool: () => {} }
const noRent = async () => null

test('chama a ferramenta, devolve o resultado ao modelo e confere a resposta', async () => {
  const { post, bodies } = fake([toolCall('gastos', { de: '2026-10', ate: '2026-10' }), say(`Você gastou ${plainBRL(39000)} em outubro.`)])
  const tools: string[] = []
  const r = await runChat(post, [{ role: 'user', content: 'quanto gastei em outubro?' }], input(), noRent, { ...on, tool: n => tools.push(n) })
  expect(tools).toEqual(['gastos'])
  expect(r.answer).toBe(`Você gastou ${plainBRL(39000)} em outubro.`)
  expect(r.unverified).toEqual([])
  expect(bodies[1].messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' })
  expect(bodies[0].messages[0].role).toBe('system')
})

test('valor que não veio de ferramenta nenhuma fica marcado', async () => {
  const { post } = fake([say('Você gastou R$ 123,00.')])
  expect((await runChat(post, [{ role: 'user', content: 'e aí?' }], input(), noRent, on)).unverified).toEqual(['R$ 123,00'])
})

test('valor de uma ferramenta de antes na conversa ainda confere', async () => {
  const history: ChatMsg[] = [
    { role: 'user', content: 'quanto gastei?' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'old', type: 'function', function: { name: 'gastos', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'old', content: JSON.stringify({ total: plainBRL(5000) }) },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'repete o total' },
  ]
  const { post } = fake([say(`Foram ${plainBRL(5000)}.`)])
  expect((await runChat(post, history, input(), noRent, on)).unverified).toEqual([])
})

test('conversa longa perde as mensagens mais antigas, mas não o sistema nem a última pergunta', () => {
  const big = 'x'.repeat(400)
  const msgs: ChatMsg[] = [{ role: 'system', content: 'regras' }, ...Array.from({ length: 10 }, (_, i): ChatMsg => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}${big}` }))]
  const out = trimHistory(msgs, 1500)
  expect(out[0]).toEqual({ role: 'system', content: 'regras' })
  expect(out[1].role).toBe('user')
  expect(out.at(-1)).toEqual(msgs.at(-1))
  expect(JSON.stringify(out).length).toBeLessThanOrEqual(1500)
})

test('chamada de ferramenta escrita como texto também roda', async () => {
  const { post } = fake([say('<tool_call>\n{"name": "carteira", "arguments": {}}\n</tool_call>'), say('Você tem R$ 0,00 investidos.')])
  const tools: string[] = []
  const r = await runChat(post, [{ role: 'user', content: 'quanto tenho investido?' }], input(), noRent, { ...on, tool: n => tools.push(n) })
  expect(tools).toEqual(['carteira'])
  expect(r.answer).toBe('Você tem R$ 0,00 investidos.')
})
