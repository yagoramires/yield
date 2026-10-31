import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteActive, type DeleteSteps } from './active'
import type { Profile } from './profiles'

const prof = (id: string, name: string): Profile =>
  ({ id, name, color: '#c6ff3d', avatar: null, dbFile: id === 'principal' ? 'yield.db' : `perfil-${id}.db`, createdAt: '2026-01-01T00:00:00Z' })
const ana = prof('principal', 'Ana')
const casa = prof('abcd1234', 'Casa')

// cada substituto entra na lista de chamadas pelo nome e pode lançar ou devolver direto
function steps(over: { [K in keyof DeleteSteps]?: () => unknown } = {}) {
  const calls: string[] = []
  const s: DeleteSteps = {
    save: async f => { calls.push(`save:${f.profiles.map(p => p.id).join(',')}`) },
    close: async () => { calls.push('close') },
    activate: async p => { calls.push(`activate:${p.id}`) },
    removeFiles: async p => { calls.push(`remove:${p.id}`); return null },
    folder: async () => '/config/yield',
  }
  for (const [k, f] of Object.entries(over)) (s as unknown as Record<string, unknown>)[k] = async () => { calls.push(k); return f() }
  return { s, calls }
}

function fakeStorage() {
  const m = new Map<string, string>([['yield.route@abcd1234', 'x'], ['yield.tema@abcd1234', 'x'], ['yield.route', 'y']])
  vi.stubGlobal('localStorage', { removeItem: (k: string) => m.delete(k), getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v) })
  return m
}

afterEach(() => { vi.unstubAllGlobals() })

describe('deleteActive', () => {
  it('grava a lista sem o perfil, fecha o banco, ativa o próximo e só então apaga os arquivos e as preferências', async () => {
    const storage = fakeStorage()
    const { s, calls } = steps()
    expect(await deleteActive([ana, casa], casa, s)).toBeNull()
    expect(calls).toEqual(['save:principal', 'close', 'activate:principal', 'remove:abcd1234'])
    expect([...storage.keys()]).toEqual(['yield.route']) // as do outro perfil ficam
  })

  it('sem gravar a lista, nada é apagado e o perfil continua', async () => {
    const { s, calls } = steps({ save: () => { throw new Error('disco cheio') } })
    expect(await deleteActive([ana, casa], casa, s)).toEqual({ listed: true, message: 'Não foi possível apagar o perfil: disco cheio' })
    expect(calls).toEqual(['save'])
  })

  it('com um perfil só, não faz nada', async () => {
    const { s, calls } = steps()
    expect((await deleteActive([casa], casa, s))?.listed).toBe(true)
    expect(calls).toEqual([])
  })

  it('banco que não fecha: não ativa outro nem apaga, e diz onde ficou o arquivo', async () => {
    fakeStorage()
    const { s, calls } = steps({ close: () => { throw new Error('ocupado') } })
    const r = await deleteActive([ana, casa], casa, s)
    expect(calls).toEqual(['save:principal', 'close'])
    expect(r).toEqual({ listed: false, message: 'O perfil saiu da lista, mas não deu para apagar os dados: o arquivo perfil-abcd1234.db continua na pasta /config/yield. ocupado' })
  })

  it('arquivos que não saem: diz onde ficou o arquivo', async () => {
    fakeStorage()
    const { s } = steps({ removeFiles: () => { throw new Error('Permission denied') }, folder: () => { throw new Error('sem pasta') } })
    expect((await deleteActive([ana, casa], casa, s))?.message).toBe('O perfil saiu da lista, mas não deu para apagar os dados: o arquivo perfil-abcd1234.db continua na pasta de dados do Yield. Permission denied')
  })

  it('arquivos apagados mas o item do cofre ficou: avisa e só deixa seguir', async () => {
    const storage = fakeStorage()
    const { s } = steps({ removeFiles: () => 'acesso negado' })
    expect(await deleteActive([ana, casa], casa, s)).toEqual({ listed: false, message: 'Os dados do perfil foram apagados, mas não deu para limpar as credenciais salvas no Acesso às Chaves: acesso negado' })
    expect(storage.has('yield.route@abcd1234')).toBe(false)
  })
})
