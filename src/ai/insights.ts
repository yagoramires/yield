import { unverified } from './check'
import type { Fact } from './facts'
import { chatOnce, type Post } from './llm'
import { INSIGHTS, SISTEMA } from './prompts'

export interface Insight { factIds: string[]; titulo: string; texto: string; recomendacao?: string }

/** Formato da resposta; o llama-server transforma em gramática, então o JSON sempre vem válido. */
export function insightsSchema(n: number) {
  return {
    type: 'object',
    properties: {
      insights: {
        type: 'array', minItems: Math.min(3, n), maxItems: 6,
        items: {
          type: 'object', required: ['factIds', 'titulo', 'texto'],
          properties: { factIds: { type: 'array', minItems: 1, items: { type: 'string' } }, titulo: { type: 'string' }, texto: { type: 'string' }, recomendacao: { type: 'string' } },
        },
      },
    },
    required: ['insights'],
  }
}

/** Só passa o insight que cita fatos existentes e cujos valores em R$ e % estão nesses fatos. */
export function acceptInsights(raw: unknown, facts: Fact[]): Insight[] {
  const list = (raw as { insights?: unknown } | null)?.insights
  if (!Array.isArray(list)) return []
  const byId = new Map(facts.map(f => [f.id, f]))
  return list.filter((i): i is Insight => {
    if (!i || !Array.isArray(i.factIds) || !i.factIds.length || typeof i.titulo !== 'string' || typeof i.texto !== 'string') return false
    const cited: (Fact | undefined)[] = i.factIds.map((id: unknown) => byId.get(String(id)))
    if (cited.some(f => !f)) return false
    return unverified(`${i.titulo} ${i.texto} ${i.recomendacao ?? ''}`, cited.map(f => f!.text)).length === 0
  })
}

export async function generateInsights(post: Post, facts: Fact[]): Promise<Insight[]> {
  const msg = await chatOnce(post, {
    messages: [
      { role: 'system', content: SISTEMA },
      { role: 'user', content: `${INSIGHTS}\n\nFatos:\n${JSON.stringify(facts.map(f => ({ id: f.id, text: f.text })))}` },
    ],
    temperature: 0.3,
    response_format: { type: 'json_schema', json_schema: { name: 'insights', schema: insightsSchema(facts.length) } },
  })
  try { return acceptInsights(JSON.parse(msg.content ?? ''), facts) } catch { return [] }
}
