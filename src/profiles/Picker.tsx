import { Lock, Plus } from 'lucide-react'
import { useState } from 'react'
import { createAndSwitch, markChosen, switchTo } from './active'
import { Avatar } from './ProfileAvatar'
import { ProfileForm } from './ProfileForm'
import type { PinInfo } from './pin'
import type { Profile } from './profiles'
import { saveProfiles } from './store'

interface Props {
  profiles: Profile[]
  locks: Record<string, PinInfo>
  activeId: string
  onCreated(p: Profile): void
  /** O perfil ativo foi escolhido: o Gate segue para o app sem recarregar. */
  onEnter(): void
}

export function Picker({ profiles, locks, activeId, onCreated, onEnter }: Props) {
  const [creating, setCreating] = useState(false)

  function choose(p: Profile) {
    if (p.id === activeId) { markChosen(p.id); onEnter() } else void switchTo(p.id)
  }

  const create = (v: { name: string; color: string; avatar: string | null }) =>
    createAndSwitch(profiles, v, async next => { await saveProfiles(next); onCreated(next.profiles[next.profiles.length - 1]) })

  return (
    <main className="profile-pick">
      <h1>Quem está usando?</h1>
      <div className="profile-list">
        {profiles.map(p => (
          <button key={p.id} type="button" className="profile-tile" onClick={() => choose(p)}>
            <Avatar profile={p} size={76} />
            <span className="profile-name">{p.name}</span>
            {locks[p.id]?.hasPin && <Lock className="pin-lock" size={13} role="img" aria-label="com PIN" />}
          </button>
        ))}
        <button type="button" className="profile-tile add" onClick={() => setCreating(true)}>
          <span className="profile-av"><Plus size={28} aria-hidden /></span>
          <span className="profile-name">Novo perfil</span>
        </button>
      </div>
      {creating && (
        <div className="modal-bg">
          <div className="modal profile-modal" role="dialog" aria-modal="true" aria-label="Novo perfil">
            <h2>Novo perfil</h2>
            <ProfileForm others={profiles} submitLabel="Criar perfil" onSubmit={create} onCancel={() => setCreating(false)} />
          </div>
        </div>
      )}
    </main>
  )
}
