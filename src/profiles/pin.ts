import { invoke } from '@tauri-apps/api/core'
import type { Profile } from './profiles'

export type Unlock = { kind: 'ok' } | { kind: 'wrong'; remaining: number } | { kind: 'locked'; until: number }

/** `until`: segundos desde a época até o fim da espera, ou null sem espera. */
export interface PinInfo { hasPin: boolean; until: number | null }

export const PIN_LEN = 4

export function pinKey(cur: string, key: string): string {
  if (key === 'Backspace') return cur.slice(0, -1)
  return /^[0-9]$/.test(key) && cur.length < PIN_LEN ? cur + key : cur
}

export function formatWait(secs: number): string {
  const s = Math.max(0, Math.floor(secs))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function unlockMessage(u: Unlock): string | null {
  if (u.kind !== 'wrong') return null
  return `PIN errado. Mais ${u.remaining} ${u.remaining === 1 ? 'tentativa' : 'tentativas'} antes da espera.`
}

export const nowSecs = (): number => Math.floor(Date.now() / 1000)

// "Tem PIN" vem do cabeçalho do arquivo, no Rust; perfil que ele não conseguiu ler fica de fora do mapa.
export const profileLocks = (ps: Profile[]): Promise<Record<string, PinInfo>> =>
  invoke('profiles_locks', { profiles: ps.map(p => ({ id: p.id, dbFile: p.dbFile })) })

export const unlock = (p: Profile, pin: string): Promise<Unlock> => invoke('profile_unlock', { id: p.id, dbFile: p.dbFile, pin })

export type PinMode = 'set' | 'change' | 'remove'
export interface PinStep { mode: PinMode; stage: 'current' | 'new' | 'repeat'; current: string; first: string }

export const startPin = (mode: PinMode): PinStep => ({ mode, stage: mode === 'set' ? 'new' : 'current', current: '', first: '' })

export const pinTitle = (s: PinStep): string =>
  s.stage === 'current' ? 'Digite o PIN atual' : s.stage === 'repeat' ? 'Repita o PIN' : s.mode === 'change' ? 'Escolha o PIN novo' : 'Escolha um PIN de 4 dígitos'

/** PIN digitado num passo: segue para o próximo, recomeça (os dois PINs novos diferentes) ou já tem tudo para rodar o comando. */
export function pinEntered(s: PinStep, pin: string): { next: PinStep; message: string | null } | { run: { current: string; next: string } } {
  if (s.stage === 'current') return s.mode === 'remove' ? { run: { current: pin, next: '' } } : { next: { ...s, stage: 'new', current: pin }, message: null }
  if (s.stage === 'new') return { next: { ...s, stage: 'repeat', first: pin }, message: null }
  if (pin !== s.first) return { next: { ...s, stage: 'new', first: '' }, message: 'Os PINs não são iguais. Comece de novo.' }
  return { run: { current: s.current, next: pin } }
}

/** Ao abrir: escolher o perfil (2+ e nenhum escolhido nesta sessão), pedir o PIN (o Rust não guarda as chaves dele) ou já abrir. */
export async function gateStep(count: number, chosen: string | null, id: string, hasPin: boolean, isUnlocked: () => Promise<boolean>): Promise<'pick' | 'pin' | 'open'> {
  if (count >= 2 && chosen !== id) return 'pick'
  if (hasPin && !(await isUnlocked())) return 'pin'
  return 'open'
}
