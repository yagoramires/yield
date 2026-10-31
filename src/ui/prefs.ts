import { useSyncExternalStore } from 'react'
import type { Module } from './routes'
import { scoped } from '../profiles/active'

// Preferências de tela guardadas no aparelho (módulos desligados, menu recolhido); storage pode falhar e aí vale o padrão.
function store<T>(key: string, fallback: T) {
  let value: T = (() => { try { const v = localStorage.getItem(scoped(key)); return v === null ? fallback : JSON.parse(v) as T } catch { return fallback } })()
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (v: T) => { value = v; try { localStorage.setItem(scoped(key), JSON.stringify(v)) } catch { /* sem storage: vale até fechar */ } listeners.forEach(l => l()) },
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
  }
}

const off = store<Module[]>('yield.modulosDesligados', [])
// valor estranho no storage (editado à mão, versão antiga) não pode derrubar o app: fica só o que é módulo conhecido
const known: Module[] = ['gastos', 'orcamento', 'investimentos']
if (!Array.isArray(off.get()) || off.get().some(m => !known.includes(m))) off.set(Array.isArray(off.get()) ? off.get().filter(m => known.includes(m)).slice(0, 2) : [])
const mini = store<boolean>('yield.menuRecolhido', false)

export function useModules() {
  const disabled = useSyncExternalStore(off.subscribe, off.get)
  return {
    enabled: (m: Module | null) => m === null || !disabled.includes(m),
    // pelo menos um módulo fica ligado
    toggle: (m: Module) => off.set(disabled.includes(m) ? disabled.filter(x => x !== m) : disabled.length >= 2 ? disabled : [...disabled, m]),
    /** Setup inicial: as escolhas de uma vez; pelo menos um fica ligado. */
    set: (d: Module[]) => { if (d.length < known.length) off.set(d) },
    disabled,
  }
}

export function useSidebarMini() {
  const v = useSyncExternalStore(mini.subscribe, mini.get)
  return { mini: v, toggle: () => mini.set(!v) }
}
