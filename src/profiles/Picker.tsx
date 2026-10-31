import { Plus } from 'lucide-react'
import { useState } from 'react'
import { markChosen, switchTo } from './active'
import { Avatar } from './ProfileAvatar'
import { ProfileForm } from './ProfileForm'
import { newProfile, type Profile } from './profiles'
import { saveProfiles } from './store'

interface Props {
  profiles: Profile[]
  activeId: string
  onCreated(p: Profile): void
  /** O perfil ativo foi escolhido: o Gate segue para o app sem recarregar. */
  onEnter(): void
}

export const randomId = () => crypto.randomUUID().replace(/-/g, '').toLowerCase()

export function Picker({ profiles, activeId, onCreated, onEnter }: Props) {
  const [creating, setCreating] = useState(false)

  function choose(p: Profile) {
    if (p.id === activeId) { markChosen(p.id); onEnter() } else void switchTo(p.id)
  }

  async function create(v: { name: string; color: string; avatar: string | null }) {
    const p = newProfile(v, new Date().toISOString(), randomId)
    await saveProfiles({ version: 1, profiles: [...profiles, p] })
    onCreated(p)
    await switchTo(p.id)
  }

  return (
    <main className="profile-pick">
      <h1>Quem está usando?</h1>
      <div className="profile-list">
        {profiles.map(p => (
          <button key={p.id} type="button" className="profile-tile" onClick={() => choose(p)}>
            <Avatar profile={p} size={76} />
            <span className="profile-name">{p.name}</span>
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
