import { Lock, Plus } from 'lucide-react'
import { useState } from 'react'
import { markChosen, switchTo } from './active'
import { NewProfileModal } from './NewProfileModal'
import { Avatar } from './ProfileAvatar'
import type { PinInfo } from './pin'
import type { Profile, ProfilesFile } from './profiles'
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

  const save = async (next: ProfilesFile) => { await saveProfiles(next); onCreated(next.profiles[next.profiles.length - 1]) }

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
      {creating && <NewProfileModal profiles={profiles} save={save} onCancel={() => setCreating(false)} />}
    </main>
  )
}
