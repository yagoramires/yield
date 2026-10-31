import { deleteConfirmed, ensureLegacy, firstName, initial, legacyProfile, newProfile, parseProfiles, resolveActive, scopedKey, validateProfileName } from './profiles'

const NOW = '2026-10-30T12:00:00.000Z'
const ana = newProfile({ name: '  Ana ', color: '#3a91dc', avatar: null }, NOW, () => 'abcd1234')

test('perfil novo tem arquivo próprio e nome sem espaços', () => {
  expect(ana).toEqual({ id: 'abcd1234', name: 'Ana', color: '#3a91dc', avatar: null, dbFile: 'perfil-abcd1234.db', createdAt: NOW })
})

test('lista ilegível vira vazia e ganha o perfil de hoje', () => {
  expect(parseProfiles('lixo')).toEqual({ version: 1, profiles: [] })
  expect(parseProfiles(null)).toEqual({ version: 1, profiles: [] })
  expect(ensureLegacy(parseProfiles('{"version":1}'), NOW).profiles).toEqual([legacyProfile('Meu perfil', NOW)])
})

test('descarta perfil com arquivo ou id suspeito e id repetido', () => {
  const raw = JSON.stringify({ version: 1, profiles: [
    ana,
    { ...ana, name: 'Repetido' },
    { ...ana, id: 'xyz98765', dbFile: '../yield.db' },
    { ...ana, id: 'evil9999', dbFile: 'yield.db' },
    { ...ana, id: '../etc', dbFile: 'perfil-../etc.db' },
    legacyProfile('Gabriel', NOW),
  ] })
  expect(parseProfiles(raw).profiles.map(p => p.name)).toEqual(['Ana', 'Gabriel'])
})

test('perfil de hoje usa as chaves antigas; os outros, com sufixo', () => {
  expect(scopedKey('yield.tema', 'principal')).toBe('yield.tema')
  expect(scopedKey('yield.tema', 'abcd1234')).toBe('yield.tema@abcd1234')
})

test('id ativo que não existe mais cai no primeiro perfil', () => {
  const f = { version: 1 as const, profiles: [legacyProfile('Gabriel', NOW), ana] }
  expect(resolveActive(f, 'abcd1234').id).toBe('abcd1234')
  expect(resolveActive(f, 'sumiu000').id).toBe('principal')
  expect(resolveActive(f, null).id).toBe('principal')
})

test('nome do perfil', () => {
  expect(validateProfileName('  ', [])).toBe('Dê um nome ao perfil.')
  expect(validateProfileName('x'.repeat(31), [])).toBe('Use até 30 caracteres.')
  expect(validateProfileName('ana', [ana])).toBe('Já existe um perfil com esse nome.')
  expect(validateProfileName('Marina', [ana])).toBeNull()
})

test('inicial, primeiro nome e confirmação de apagar', () => {
  expect(initial('ana')).toBe('A')
  expect(initial('')).toBe('?')
  expect(firstName('GABRIEL S SALVADOR')).toBe('Gabriel')
  expect(deleteConfirmed('  ANA ', ana)).toBe(true)
  expect(deleteConfirmed('An', ana)).toBe(false)
})
