// Bateria de avaliação da IA local. A autoconferência roda sempre; a avaliação só com um llama-server no ar
// (YIELD_EVAL_URL, YIELD_EVAL_KEY, YIELD_EVAL_MODEL). Ver README.md.
import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { monthsBetween } from '../../domain/money'
import { runChat } from '../chat'
import { moneyTokens, unverified } from '../check'
import { buildFacts } from '../facts'
import { acceptInsights, generateInsights } from '../insights'
import type { Post } from '../llm'
import { runTool } from '../tools'
import perguntas from './perguntas.json'
import { PERFIS } from './perfis'

interface Pergunta { tipo: 'chat' | 'insights'; perfil: string; pergunta?: string; mes?: string; area?: 'gastos' | 'investimentos' /* insights: qual Resumo */; valores: string[]; ferramenta?: string | string[] /* qualquer uma serve */ }
const QS = perguntas as Pergunta[]
const MONTHS = monthsBetween('2026-01', '2026-10')

/** Tudo o que os fatos e as ferramentas podem devolver para o perfil: os valores esperados têm de sair daqui. */
async function sources(perfil: string): Promise<string[]> {
  const input = PERFIS[perfil]
  const loadRent = async () => input.rent
  const out = MONTHS.flatMap(m => (['gastos', 'investimentos', 'orcamento'] as const).flatMap(a => buildFacts(m, a, input).map(f => f.text)))
  for (const [i, de] of MONTHS.entries()) for (const ate of MONTHS.slice(i)) {
    for (const name of ['gastos', 'proventos', 'lancamentos']) out.push(JSON.stringify(await runTool(name, { de, ate }, input, loadRent)))
  }
  for (const m of MONTHS) out.push(JSON.stringify(await runTool('orcamento', { mes: m }, input, loadRent)))
  out.push(JSON.stringify(await runTool('carteira', {}, input, loadRent)), JSON.stringify(await runTool('rentabilidade', {}, input, loadRent)))
  return out
}

test('autoconferência: cada valor esperado da bateria sai dos fatos ou das ferramentas do perfil', async () => {
  expect(QS.length).toBeGreaterThanOrEqual(40)
  for (const q of QS) {
    expect(PERFIS[q.perfil], q.perfil).toBeDefined()
    const missing = unverified(q.valores.join(' '), await sources(q.perfil))
    expect(missing, `${q.perfil}: ${q.pergunta ?? q.mes}`).toEqual([])
  }
}, 60_000)

const URL_ = process.env.YIELD_EVAL_URL
const KEY = process.env.YIELD_EVAL_KEY ?? ''
const MODEL = process.env.YIELD_EVAL_MODEL ?? 'modelo'

const nodePost = (onBody?: (b: string) => void): Post => async (path, body, onChunk) => {
  const r = await fetch(`${URL_}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  if (!onChunk) { const t = await r.text(); onBody?.(t); return t }
  const reader = r.body!.getReader(), dec = new TextDecoder()
  for (;;) { const { done, value } = await reader.read(); if (done) break; onChunk(dec.decode(value, { stream: true })) }
  return ''
}

// \b do JS é só ASCII: acento conta à parte
const EN = /\b(the|and|is|are|you|your|spent)\b/i, PT = /\b(de|que|em|com|um|uma|no|na|foi|este|ano)\b|[ãçéêõáí]/i
const found = (expected: string[], text: string) => expected.filter(v => unverified(v, [text]).length === 0).length

describe.skipIf(!URL_)('avaliação contra o llama-server', () => {
  test(`bateria com ${MODEL}`, async () => {
    const rows: string[] = []
    let certos = 0, esperados = 0, naoConferidos = 0, ferramentaOk = 0, comFerramenta = 0, portugues = 0, ms = 0
    for (const q of QS) {
      const input = PERFIS[q.perfil]
      const t0 = Date.now()
      let text = '', bad: string[] = [], tools: string[] = [], note = ''
      try {
        if (q.tipo === 'insights') {
          let raw = ''
          const facts = buildFacts(q.mes!, q.area ?? 'gastos', input)
          const ok = await generateInsights(nodePost(b => { raw = b }), facts)
          const all = (JSON.parse(JSON.parse(raw).choices[0].message.content).insights ?? []) as unknown[]
          text = ok.map(i => `${i.titulo}: ${i.texto} ${i.recomendacao ?? ''}`).join(' | ')
          const dropped = all.length - acceptInsights({ insights: all }, facts).length
          if (dropped) { bad = [`${dropped} insight(s) descartado(s)`]; naoConferidos += dropped }
          note = `${ok.length} aceitos de ${all.length}`
        } else {
          const r = await runChat(nodePost(), [{ role: 'user', content: q.pergunta! }], input, async () => input.rent, { delta: () => {}, tool: n => tools.push(n) })
          text = r.answer; bad = r.unverified; naoConferidos += bad.length
        }
      } catch (e) { text = `ERRO: ${e instanceof Error ? e.message : String(e)}` }
      const took = Date.now() - t0
      ms += took
      const hit = found(q.valores, text)
      certos += hit; esperados += q.valores.length
      const okTool = !q.ferramenta || [q.ferramenta].flat().some(f => tools.includes(f))
      if (q.ferramenta) { comFerramenta++; if (okTool) ferramentaOk++ }
      const pt = PT.test(text) && !EN.test(text)
      if (pt) portugues++
      rows.push(`| ${q.perfil} | ${(q.pergunta ?? `insights ${q.mes}`).replace(/\|/g, '/')} | ${hit}/${q.valores.length} | ${bad.join(', ') || '—'} | ${q.ferramenta ? (okTool ? 'ok' : `**${tools.join(',') || 'nenhuma'}**`) : '—'} | ${pt ? 'sim' : '**não**'} | ${(took / 1000).toFixed(1)} s | ${(note ? `${note} · ` : '') + text.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 220)} |`)
    }
    const pctCertos = esperados ? (certos / esperados) * 100 : 100
    const head = [
      `# Bateria de avaliação — ${MODEL}`, '',
      `- Valores certos: ${certos}/${esperados} (${pctCertos.toFixed(0)}%)`,
      `- Valores não conferidos: ${naoConferidos}`,
      `- Ferramenta certa: ${ferramentaOk}/${comFerramenta}`,
      `- Em português: ${portugues}/${QS.length}`,
      `- Tempo médio: ${(ms / QS.length / 1000).toFixed(1)} s`, '',
      '| perfil | pergunta | valores | não conferidos | ferramenta | pt | tempo | resposta |', '|---|---|---|---|---|---|---|---|',
    ]
    mkdirSync(new URL('./resultados/', import.meta.url), { recursive: true })
    writeFileSync(new URL(`./resultados/${MODEL}.md`, import.meta.url), [...head, ...rows, ''].join('\n'))
    console.log(head.slice(2, 7).join('\n'))
    expect(moneyTokens('R$ 1,00')).toHaveLength(1) // a nota fica no relatório; o teste só falha se a bateria quebrar
  }, 60 * 60_000)
})
