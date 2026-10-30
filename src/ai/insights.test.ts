import { expect, test } from 'vitest'
import { plainBRL } from '../domain/money'
import type { Fact } from './facts'
import { acceptInsights, generateInsights } from './insights'
import type { Post } from './llm'

const facts: Fact[] = [
  { id: 'gasto_mes', kind: 'gasto_mes', route: 'gastos-resumo', text: `Em outubro de 2026: gasto ${plainBRL(390000)}, entradas ${plainBRL(500000)}.` },
  { id: 'orcamento', kind: 'orcamento', route: 'orcamento', text: `Orçamento: planejado ${plainBRL(99900)}.` },
]
const bom = { factIds: ['gasto_mes'], titulo: 'Gasto do mês', texto: 'Você gastou R$ 3.900,00 de R$ 5.000 que entraram.', recomendacao: 'Reserve parte da sobra em renda fixa atrelada ao CDI.' }

test('descarta insight que cita fato inexistente ou valor fora dos fatos citados', () => {
  const raw = { insights: [
    bom,
    { factIds: ['nao-existe'], titulo: 'x', texto: 'y' },
    { factIds: ['gasto_mes'], titulo: 'Inventado', texto: 'Cortar R$ 999,00 resolve.' }, // só está no fato não citado
    { factIds: [], titulo: 'Sem fato', texto: 'z' },
  ] }
  expect(acceptInsights(raw, facts)).toEqual([bom])
  expect(acceptInsights([bom], facts)).toEqual([])
  expect(acceptInsights(null, facts)).toEqual([])
})

test('pede JSON no formato dos insights e devolve só os conferidos', async () => {
  let sent: Record<string, unknown> = {}
  const post: Post = async (_path, body) => {
    sent = body as Record<string, unknown>
    return JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ insights: [bom, { factIds: ['x'], titulo: 'a', texto: 'b' }] }) } }] })
  }
  expect(await generateInsights(post, facts)).toEqual([bom])
  expect(sent).toMatchObject({ response_format: { type: 'json_schema' }, stream: false })
  expect(JSON.stringify(sent.messages)).toContain('gasto_mes')
})
