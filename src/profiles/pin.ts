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
