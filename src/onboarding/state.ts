import { useSyncExternalStore } from 'react'
import { scoped } from '../profiles/active'
import { SETUP_KEY } from '../profiles/profiles'

/** Setup inicial e tour do perfil aberto. `setup`: passo em que o wizard parou (null = não mostrar); `tour`: mostrar o tour agora. */
export interface Onboarding { setup: number | null; tour: boolean }

export const TOUR_KEY = 'yield.tour'
export const SETUP_STEPS = 5

const read = (): Onboarding => {
  try {
    const s = localStorage.getItem(scoped(SETUP_KEY))
    const n = s === null ? NaN : Number(s)
    return { setup: Number.isInteger(n) && n >= 0 && n < SETUP_STEPS ? n : null, tour: localStorage.getItem(scoped(TOUR_KEY)) === 'pendente' }
  } catch { return { setup: null, tour: false } }
}

let current = read()
const listeners = new Set<() => void>()
const write = (key: string, v: string | null) => {
  try { if (v === null) localStorage.removeItem(scoped(key)); else localStorage.setItem(scoped(key), v) } catch { /* sem storage: vale até fechar */ }
}

export function setOnboarding(patch: Partial<Onboarding>) {
  current = { ...current, ...patch }
  if ('setup' in patch) write(SETUP_KEY, patch.setup === null || patch.setup === undefined ? null : String(patch.setup))
  if ('tour' in patch) write(TOUR_KEY, patch.tour ? 'pendente' : null)
  listeners.forEach(l => l())
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useOnboarding = (): Onboarding => useSyncExternalStore(subscribe, () => current)

/**
 * Instalação nova: nenhum perfil gravado e nenhuma preferência do app no storage (quem já usava tem ao menos a última tela).
 * shortcut: olha o storage, não o banco; quem usou uma versão sem `yield.route` veria o wizard (pulável). Trocar por "o yield.db existe" se aparecer.
 */
export function isFreshInstall(storage: Pick<Storage, 'length' | 'key'>): boolean {
  for (let i = 0; i < storage.length; i++) if (storage.key(i)?.startsWith('yield.')) return false
  return true
}
