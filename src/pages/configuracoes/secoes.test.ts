import { afterEach, describe, expect, it, vi } from 'vitest'
import { filterSections, savedSection, saveSection, SECTIONS } from './secoes'

const ids = (q: string) => filterSections(q).map(s => s.id)

describe('filterSections', () => {
  it('vazio mostra todas', () => {
    expect(ids('  ')).toEqual(SECTIONS.map(s => s.id))
  })
  it('acha pelo nome, sem acento e sem caixa', () => {
    expect(ids('APARENCIA')).toEqual(['aparencia'])
  })
  it('acha pelos ajustes de dentro da seção', () => {
    expect(ids('pluggy')).toEqual(['contas'])
    expect(ids('csv')).toEqual(['importar'])
  })
  it('todas as palavras precisam bater', () => {
    expect(ids('b3 csv')).toEqual(['importar'])
    expect(ids('b3 dividendos')).toEqual([])
  })
})

describe('savedSection', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stubStorage = () => {
    const m = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v) })
    return m
  }

  it('lembra a última seção do perfil ativo', () => {
    const m = stubStorage()
    m.set('yield.perfilAtivo', 'abc')
    saveSection('backup')
    expect(m.get('yield.configSecao@abc')).toBe('backup')
    expect(savedSection()).toBe('backup')
  })
  it('valor desconhecido ou sem storage cai em Perfil', () => {
    stubStorage().set('yield.configSecao', 'sumiu')
    expect(savedSection()).toBe('perfil')
    vi.stubGlobal('localStorage', undefined)
    expect(savedSection()).toBe('perfil')
  })
})
