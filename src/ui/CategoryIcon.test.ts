import { describe, expect, it } from 'vitest'
import { categoryLook, COLOR_CHOICES, ICON_CHOICES } from './CategoryIcon'
import { TINT } from './palette'

describe('categoryLook', () => {
  it('padrão do id, escolha salva por cima, desconhecido vira etiqueta e null é sem categoria', () => {
    expect(categoryLook({ id: 'mercado', icon: null, color: null })).toEqual({ icon: 'shopping-cart', color: TINT.verde })
    expect(categoryLook({ id: 'mercado', icon: 'store', color: TINT.coral })).toEqual({ icon: 'store', color: TINT.coral })
    expect(categoryLook({ id: 'x', icon: 'nao-existe', color: null })).toEqual({ icon: 'tag', color: TINT.cinza })
    expect(categoryLook(null)).toEqual({ icon: 'circle-help', color: '#fbc959' })
  })
  it('cor salva da paleta antiga aparece com a equivalente da nova; cor fora das duas fica como está', () => {
    expect(categoryLook({ id: 'mercado', icon: null, color: '#FF7A8A' }).color).toBe(TINT.coral)
    expect(categoryLook({ id: 'mercado', icon: null, color: '#123456' }).color).toBe('#123456')
  })
  it('as escolhas da tela incluem os ícones padrão e as 9 cores da paleta', () => {
    expect(ICON_CHOICES).toEqual(expect.arrayContaining(['shopping-cart', 'utensils', 'tag', 'paw-print']))
    expect(new Set(ICON_CHOICES).size).toBe(ICON_CHOICES.length)
    expect(COLOR_CHOICES).toEqual(Object.values(TINT))
    expect(new Set(COLOR_CHOICES).size).toBe(9)
  })
})
