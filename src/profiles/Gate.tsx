import { invoke } from '@tauri-apps/api/core'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ACTIVE_KEY, activeProfileId, chosenThisSession, lockToPicker } from './active'
import { DeleteProfileDialog } from './DeleteProfileDialog'
import { ForgotPin } from './ForgotPin'
import { Picker } from './Picker'
import { PinPad } from './PinPad'
import { profileLocks, unlock, unlockMessage, type PinInfo, type Unlock } from './pin'
import { randomId, resolveActive, withFallback, type Profile, type ProfilesFile } from './profiles'
import { loadProfiles, saveProfiles } from './store'

export interface Profiles {
  profile: Profile
  profiles: Profile[]
  save(next: ProfilesFile): Promise<void>
  /** PIN e espera de cada perfil, lidos do Rust (cabeçalho do banco e `pins.json`). */
  locks: Record<string, PinInfo>
  hasPin: boolean
  setHasPin(v: boolean): void
}

const Ctx = createContext<Profiles | null>(null)

export function useProfiles(): Profiles {
  const v = useContext(Ctx)
  if (!v) throw new Error('useProfiles fora do Gate')
  return v
}

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'pick'; file: ProfilesFile }
  | { kind: 'pin'; file: ProfilesFile; profile: Profile; until: number | null } | { kind: 'ready'; file: ProfilesFile; id: string }

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Só deixa o app abrir depois de saber o perfil e avisar o Rust (banco e cofre dele); sem isso, nenhum banco é aberto.
export function Gate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [locks, setLocks] = useState<Record<string, PinInfo>>({})
  const [pinMsg, setPinMsg] = useState<string | null>(null)
  // "Esqueci o PIN": a explicação e depois a confirmação, com a lista já com o perfil substituto (id sorteado uma vez só)
  const [forgot, setForgot] = useState<null | 'ask' | { profiles: Profile[] }>(null)

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
        const l = await profileLocks(file.profiles)
        if (cancelled) return
        setLocks(l)
        if (file.profiles.length >= 2 && chosenThisSession() !== profile.id) { setState({ kind: 'pick', file }); return }
        // o desbloqueio vale enquanto o Rust guarda as chaves deste perfil; nada no JS dispensa o PIN
        if (l[profile.id]?.hasPin && !(await invoke<boolean>('profile_unlocked', { id: profile.id }))) {
          if (!cancelled) setState({ kind: 'pin', file, profile, until: l[profile.id].until })
          return
        }
        await invoke('profile_activate', { id: profile.id, dbFile: profile.dbFile })
        if (!cancelled) setState({ kind: 'ready', file, id: profile.id })
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: errText(e) })
      }
    })()
    return () => { cancelled = true }
  }, [attempt])

  const save = useCallback(async (next: ProfilesFile) => {
    await saveProfiles(next)
    setState(s => (s.kind === 'ready' ? { ...s, file: next } : s))
  }, [])

  const readyId = state.kind === 'ready' ? state.id : null
  const setHasPin = useCallback((v: boolean) => {
    if (readyId) setLocks(l => ({ ...l, [readyId]: { hasPin: v, until: l[readyId]?.until ?? null } }))
  }, [readyId])

  const value = useMemo<Profiles | null>(() => {
    if (state.kind !== 'ready') return null
    const profile = resolveActive(state.file, state.id)
    return { profile, profiles: state.file.profiles, save, locks, hasPin: locks[profile.id]?.hasPin ?? false, setHasPin }
  }, [state, save, locks, setHasPin])

  async function enterPin(file: ProfilesFile, profile: Profile, pin: string) {
    let r: Unlock | null = null
    try {
      r = await unlock(profile, pin)
      if (r.kind === 'ok') {
        await invoke('profile_activate', { id: profile.id, dbFile: profile.dbFile })
        setPinMsg(null)
        setState({ kind: 'ready', file, id: profile.id })
      } else setPinMsg(unlockMessage(r))
    } catch (e) {
      setPinMsg(errText(e))
    }
    // a espera vale a do Rust (gravada no pins.json), não a deste clique
    const l = await profileLocks(file.profiles).catch(() => null)
    if (l) setLocks(l)
    const until = l ? (l[profile.id]?.until ?? null) : r?.kind === 'locked' ? r.until : null
    setState(s => (s.kind === 'pin' ? { ...s, until } : s))
  }

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
      locks={locks}
      activeId={resolveActive(state.file, activeProfileId()).id}
      onCreated={p => setState({ kind: 'pick', file: { ...state.file, profiles: [...state.file.profiles, p] } })}
      onEnter={() => { setState({ kind: 'loading' }); setAttempt(a => a + 1) }}
    />
  )
  if (state.kind === 'pin') {
    const { file, profile } = state
    return (
      <main className="profile-pick">
        {forgot === null ? (
          <PinPad
            title={profile.name}
            profile={profile}
            until={state.until}
            message={pinMsg}
            onComplete={pin => enterPin(file, profile, pin)}
            onBack={file.profiles.length >= 2 ? () => lockToPicker() : undefined}
            footer={<button type="button" className="link pin-link" onClick={() => setForgot('ask')}>Esqueci o PIN</button>}
          />
        ) : (
          <ForgotPin profile={profile} onBack={() => setForgot(null)} onDelete={() => setForgot({ profiles: withFallback(file.profiles, new Date().toISOString(), randomId) })} />
        )}
        {forgot !== null && forgot !== 'ask' && (
          <DeleteProfileDialog
            profile={profile}
            profiles={forgot.profiles}
            close={async () => {}} // o banco deste perfil não chegou a abrir
            onCancel={() => setForgot('ask')}
            onDeleted={next => lockToPicker(next.id)}
          />
        )}
      </main>
    )
  }
  if (!value) return <main className="main"><div className="muted">Abrindo dados…</div></main>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
