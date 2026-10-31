import { describe, expect, it } from 'vitest'
import { disabledFrom } from './Wizard'
import { isFreshInstall } from './state'
import { tipPosition, union } from './Tour'

const storage = (keys: string[]) => ({ length: keys.length, key: (i: number) => keys[i] ?? null })

describe('isFreshInstall', () => {
  it('sem nenhuma preferência do app: instalação nova', () => {
    expect(isFreshInstall(storage([]))).toBe(true)
    expect(isFreshInstall(storage(['outro.app']))).toBe(true)
  })
  it('quem já usava tem ao menos a última tela', () => {
    expect(isFreshInstall(storage(['yield.route']))).toBe(false)
  })
})

describe('union', () => {
  it('cobre os elementos visíveis e ignora os escondidos', () => {
    expect(union([{ left: 10, top: 100, right: 180, bottom: 120 }, { left: 0, top: 0, right: 0, bottom: 0 }, { left: 12, top: 120, right: 170, bottom: 220 }]))
      .toEqual({ left: 10, top: 100, right: 180, bottom: 220 })
  })
  it('nada visível: a parada sai do tour', () => {
    expect(union([{ left: 0, top: 0, right: 0, bottom: 0 }])).toBeNull()
    expect(union([])).toBeNull()
  })
})

describe('tipPosition', () => {
  const win = { w: 1280, h: 800 }
  const tip = { w: 260, h: 140 }
  it('ao lado do destaque, sem passar da borda de baixo', () => {
    expect(tipPosition({ left: 10, top: 100, right: 180, bottom: 120 }, tip, win)).toEqual({ left: 194, top: 100 })
    expect(tipPosition({ left: 10, top: 760, right: 180, bottom: 790 }, tip, win)).toEqual({ left: 194, top: 648 })
  })
  it('sem espaço à direita vai para baixo', () => {
    expect(tipPosition({ left: 1100, top: 100, right: 1200, bottom: 130 }, tip, win)).toEqual({ left: 1008, top: 144 })
  })
})

describe('disabledFrom', () => {
  it('desliga o que não foi marcado', () => {
    expect(disabledFrom(['gastos'])).toEqual(['orcamento', 'investimentos'])
    expect(disabledFrom(['gastos', 'orcamento', 'investimentos'])).toEqual([])
  })
})
