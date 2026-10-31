// Perfis: cada um tem o próprio banco e as próprias preferências; o de hoje (`principal`) mantém os nomes antigos.

export interface Profile {
  id: string
  name: string
  color: string
  /** Data URL jpeg, ou null para mostrar a inicial. */
  avatar: string | null
  dbFile: string
  createdAt: string
}

export interface ProfilesFile { version: 1; profiles: Profile[] }

export const LEGACY_ID = 'principal'
export const LEGACY_DB = 'yield.db'
export const DEFAULT_NAME = 'Meu perfil'

export const PROFILE_COLORS: readonly string[] = ['#c6ff3d', '#3a91dc', '#dc5f52', '#956ed2', '#009f99', '#fbc959']

/** Preferências guardadas por perfil (chave com sufixo `@id`, exceto no perfil de hoje). */
export const SCOPED_KEYS: readonly string[] = ['yield.route', 'yield.modulosDesligados', 'yield.menuRecolhido', 'yield.tema', 'yield.ia', 'yield.ocultarValores', 'yield.dicaEmpresaDispensada', 'yield.configSecao', 'yield.setup', 'yield.tour']

/** Passo em que o setup inicial parou; sem a chave, o perfil não vê o setup. */
export const SETUP_KEY = 'yield.setup'

const MAX_NAME = 30
const ID_RE = /^(principal|[a-z0-9]{8,40})$/

const empty = (): ProfilesFile => ({ version: 1, profiles: [] })

// O arquivo do banco vem do disco: só aceita o nome que o próprio id gera, para não apontar para fora da pasta do app.
function valid(p: unknown): p is Profile {
  if (typeof p !== 'object' || p === null) return false
  const { id, name, color, avatar, dbFile, createdAt } = p as Record<string, unknown>
  return typeof id === 'string' && ID_RE.test(id)
    && dbFile === (id === LEGACY_ID ? LEGACY_DB : `perfil-${id}.db`)
    && typeof name === 'string' && name.trim() !== ''
    && typeof color === 'string' && typeof createdAt === 'string'
    && (avatar === null || typeof avatar === 'string')
}

export function parseProfiles(raw: string | null): ProfilesFile {
  if (raw === null) return empty()
  let data: unknown
  try { data = JSON.parse(raw) } catch { return empty() }
  const list = (data as { profiles?: unknown } | null)?.profiles
  if (!Array.isArray(list)) return empty()
  const seen = new Set<string>()
  const profiles = list.filter((p): p is Profile => valid(p) && !seen.has(p.id) && !!seen.add(p.id))
  return { version: 1, profiles }
}

export const legacyProfile = (name: string, now: string): Profile =>
  ({ id: LEGACY_ID, name, color: PROFILE_COLORS[0], avatar: null, dbFile: LEGACY_DB, createdAt: now })

export const ensureLegacy = (f: ProfilesFile, now: string): ProfilesFile =>
  f.profiles.length === 0 ? { version: 1, profiles: [legacyProfile(DEFAULT_NAME, now)] } : f

export const randomId = (): string => crypto.randomUUID().replace(/-/g, '').toLowerCase()

export function newProfile(input: { name: string; color: string; avatar: string | null }, now: string, randomId: () => string): Profile {
  const id = randomId()
  return { id, name: input.name.trim(), color: input.color, avatar: input.avatar, dbFile: `perfil-${id}.db`, createdAt: now }
}

/** Apagar o único perfil (PIN esquecido) deixa um perfil novo e vazio no lugar; com 2+ devolve a mesma lista. */
export const withFallback = (profiles: Profile[], now: string, randomId: () => string): Profile[] =>
  profiles.length === 1 ? [...profiles, newProfile({ name: DEFAULT_NAME, color: PROFILE_COLORS[0], avatar: null }, now, randomId)] : profiles

const norm = (s: string) => s.trim().toLocaleLowerCase('pt-BR')

export function validateProfileName(name: string, others: Profile[]): string | null {
  if (name.trim() === '') return 'Dê um nome ao perfil.'
  if (name.trim().length > MAX_NAME) return `Use até ${MAX_NAME} caracteres.`
  if (others.some(p => norm(p.name) === norm(name))) return 'Já existe um perfil com esse nome.'
  return null
}

/** Pré-condição: `f.profiles` não vazio (use `ensureLegacy` antes). */
export const resolveActive = (f: ProfilesFile, storedId: string | null): Profile =>
  f.profiles.find(p => p.id === storedId) ?? f.profiles[0]

export const scopedKey = (key: string, profileId: string) => (profileId === LEGACY_ID ? key : `${key}@${profileId}`)

export const initial = (name: string): string => [...name.trim()][0]?.toLocaleUpperCase('pt-BR') ?? '?'

export function firstName(ownerName: string): string {
  const w = ownerName.trim().split(/\s+/)[0] ?? ''
  return w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1).toLocaleLowerCase('pt-BR')
}

export const deleteConfirmed = (typed: string, p: Profile) => norm(typed) === norm(p.name)
