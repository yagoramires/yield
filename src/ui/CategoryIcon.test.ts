import { describe, expect, it } from 'vitest'
import { categoryLook, COLOR_CHOICES, ICON_CHOICES } from './CategoryIcon'

describe('categoryLook', () => {
  it('padrão do id, escolha salva por cima, desconhecido vira etiqueta e null é sem categoria', () => {
    expect(categoryLook({ id: 'mercado', icon: null, color: null })).toEqual({ icon: 'shopping-cart', color: '#6fdc8c' })
    expect(categoryLook({ id: 'mercado', icon: 'store', color: '#ff7a8a' })).toEqual({ icon: 'store', color: '#ff7a8a' })
    expect(categoryLook({ id: 'x', icon: 'nao-existe', color: null })).toEqual({ icon: 'tag', color: '#9a9da6' })
    expect(categoryLook(null)).toEqual({ icon: 'circle-help', color: '#ffcf5c' })
  })
  it('as escolhas da tela incluem os ícones padrão e 11 cores', () => {
    expect(ICON_CHOICES).toEqual(expect.arrayContaining(['shopping-cart', 'utensils', 'tag', 'paw-print']))
    expect(new Set(ICON_CHOICES).size).toBe(ICON_CHOICES.length)
    expect(COLOR_CHOICES).toHaveLength(11)
  })
})
