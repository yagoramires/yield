import { useState } from 'react'
import { lockToPicker } from '../../profiles/active'
import { DeleteProfileDialog } from '../../profiles/DeleteProfileDialog'
import { useProfiles } from '../../profiles/Gate'
import { ProfileForm } from '../../profiles/ProfileForm'
import { useData } from '../../state/DataProvider'

/** Nome, cor e foto do perfil aberto, e o botão de apagá-lo. */
export function Perfil() {
  const { profile, profiles, save } = useProfiles()
  const { db } = useData()
  const [formKey, setFormKey] = useState(0) // remontar volta o formulário ao que está salvo
  const [deleting, setDeleting] = useState(false)
  const others = profiles.filter(p => p.id !== profile.id)

  const salvar = async (v: { name: string; color: string; avatar: string | null }) => {
    await save({ version: 1, profiles: profiles.map(p => (p.id === profile.id ? { ...p, ...v } : p)) })
    setFormKey(k => k + 1)
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <b style={{ color: 'var(--strong)' }}>Perfil</b>
      <div className="muted" style={{ margin: '4px 0 12px' }}>Nome, cor e foto deste perfil</div>
      <ProfileForm key={formKey} initial={profile} others={others} submitLabel="Salvar" autoFocus={false} onSubmit={salvar} onCancel={() => setFormKey(k => k + 1)} />
      <div className="btns" style={{ marginTop: 14 }}>
        <button className="b danger" disabled={others.length === 0} title={others.length === 0 ? 'Pelo menos um perfil fica' : undefined} onClick={() => setDeleting(true)}>Apagar perfil…</button>
      </div>
      {deleting && <DeleteProfileDialog profile={profile} profiles={profiles} close={() => db.close()} onCancel={() => setDeleting(false)} onDeleted={next => lockToPicker(next.id)} />}
    </div>
  )
}
