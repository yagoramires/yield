import { invoke } from '@tauri-apps/api/core'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ACTIVE_KEY, activeProfileId, chosenThisSession } from './active'
import { Picker } from './Picker'
import { resolveActive, type Profile, type ProfilesFile } from './profiles'
import { loadProfiles, saveProfiles } from './store'

export interface Profiles {
  profile: Profile
  profiles: Profile[]
  save(next: ProfilesFile): Promise<void>
}

const Ctx = createContext<Profiles | null>(null)

export function useProfiles(): Profiles {
  const v = useContext(Ctx)
  if (!v) throw new Error('useProfiles fora do Gate')
  return v
}

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'pick'; file: ProfilesFile } | { kind: 'ready'; file: ProfilesFile; id: string }

// Só deixa o app abrir depois de saber o perfil e avisar o Rust (banco e cofre dele); sem isso, nenhum banco é aberto.
export function Gate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const file = await loadProfiles()
        const stored = activeProfileId()
        const profile = resolveActive(file, stored)
        if (profile.id !== stored) {
          try { localStorage.setItem(ACTIVE_KEY, profile.id) } catch { /* sem storage: segue sem recarregar */ }
          // as preferências já foram lidas com as chaves do perfil que sumiu: recarrega uma vez (só se a troca pegou, senão entraria em laço)
          if (activeProfileId() === profile.id) { location.reload(); return }
        }
        if (file.profiles.length >= 2 && chosenThisSession() !== profile.id) { if (!cancelled) setState({ kind: 'pick', file }); return }
        await invoke('profile_activate', { id: profile.id, dbFile: profile.dbFile })
        if (!cancelled) setState({ kind: 'ready', file, id: profile.id })
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => { cancelled = true }
  }, [attempt])

  const save = useCallback(async (next: ProfilesFile) => {
    await saveProfiles(next)
    setState(s => (s.kind === 'ready' ? { ...s, file: next } : s))
  }, [])

  const value = useMemo<Profiles | null>(() => {
    if (state.kind !== 'ready') return null
    return { profile: resolveActive(state.file, state.id), profiles: state.file.profiles, save }
  }, [state, save])

  if (state.kind === 'error') return (
    <main className="main">
      <h1>Yield</h1>
      <div className="note" style={{ marginTop: 10 }}>Não foi possível abrir os perfis: {state.message}</div>
      <button className="b" style={{ marginTop: 10 }} onClick={() => { setState({ kind: 'loading' }); setAttempt(a => a + 1) }}>Tentar de novo</button>
    </main>
  )
  if (state.kind === 'pick') return (
    <Picker
      profiles={state.file.profiles}
      activeId={resolveActive(state.file, activeProfileId()).id}
      onCreated={p => setState({ kind: 'pick', file: { ...state.file, profiles: [...state.file.profiles, p] } })}
      onEnter={() => { setState({ kind: 'loading' }); setAttempt(a => a + 1) }}
    />
  )
  if (!value) return <main className="main"><div className="muted">Abrindo dados…</div></main>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
