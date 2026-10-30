// Formatos dos valores que a IA lê (fatos e ferramentas): sempre sem a máscara do olhinho.
import { plainBRL } from '../domain/money'
import type { Cents } from '../domain/types'

const num1 = (v: number) => Math.abs(v).toFixed(1).replace('.', ',')
/** % com sinal (variação) */
export const pctS = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num1(v)}%`
/** % sem sinal (parte de um todo) */
export const pctU = (v: number) => `${num1(v)}%`
/** R$ com sinal (diferença) */
export const brlS = (c: Cents) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${plainBRL(Math.abs(c))}`
