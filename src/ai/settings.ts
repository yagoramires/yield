import { useSyncExternalStore } from 'react'

/** Escolhas da IA local. São desta máquina (o modelo baixado mora nela), por isso ficam fora do banco e do backup. */
export interface AiSettings { modelId: string | null; tokS: number | null; off: boolean }

const KEY = 'yield.ia'
const DEFAULT: AiSettings = { modelId: null, tokS: null, off: false }
let current: AiSettings = (() => { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return DEFAULT } })()
const listeners = new Set<() => void>()

export const getAiSettings = (): AiSettings => current

export function setAiSettings(patch: Partial<AiSettings>) {
  current = { ...current, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* sem storage: vale só nesta sessão */ }
  listeners.forEach(l => l())
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useAiSettings = (): AiSettings => useSyncExternalStore(subscribe, () => current)
