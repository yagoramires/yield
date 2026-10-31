import { chatStream, parseSse, type Post } from './llm'

test('evento cortado entre dois pedaços fica para o próximo', () => {
  const a = parseSse('data: {"a":1}\n\ndata: {"b"')
  expect(a.events).toEqual([{ a: 1 }])
  expect(parseSse(a.rest + ':2}\n\ndata: [DONE]\n\n')).toEqual({ events: [{ b: 2 }], rest: '' })
})

test('chamada de ferramenta em pedaços vira uma só, e o texto sai por onText', async () => {
  const ev = (o: object) => `data: ${JSON.stringify({ choices: [o] })}\n\n`
  let sent: Record<string, unknown> = {}
  const post: Post = async (_path, body, onChunk) => {
    sent = body as Record<string, unknown>
    onChunk!(ev({ delta: { content: 'Vou ver' } }))
    onChunk!(ev({ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'gastos', arguments: '{"de":' } }] } }))
    onChunk!(ev({ delta: { tool_calls: [{ index: 0, function: { arguments: '"2026-01"}' } }] } }) + ev({ delta: {}, finish_reason: 'tool_calls' }))
    return ''
  }
  const texts: string[] = []
  const r = await chatStream(post, { messages: [] }, t => texts.push(t))
  expect(texts).toEqual(['Vou ver'])
  expect(r).toEqual({ finish: 'tool_calls', content: 'Vou ver', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'gastos', arguments: '{"de":"2026-01"}' } }] })
  expect(sent).toMatchObject({ stream: true, chat_template_kwargs: { enable_thinking: false } })
})
