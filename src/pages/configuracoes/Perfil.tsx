import { useState } from 'react'
import { lockToPicker } from '../../profiles/active'
import { DeleteProfileDialog } from '../../profiles/DeleteProfileDialog'
import { useProfiles } from '../../profiles/Gate'
import { ProfileForm } from '../../profiles/ProfileForm'
import { useData } from '../../state/DataProvider'
import { CurrentPin, PinConfig } from './PinConfig'
import { setOnboarding } from '../../onboarding/state'

/** Nome, cor e foto do perfil aberto, o PIN e o botão de apagá-lo. */
export function Perfil() {
  const { profile, profiles, save, hasPin } = useProfiles()
  const { db } = useData()
  const [formKey, setFormKey] = useState(0) // remontar volta o formulário ao que está salvo
  const [deleting, setDeleting] = useState<false | 'pin' | true>(false) // com PIN, apagar daqui pede o PIN antes do diálogo
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
      <PinConfig />
      <div className="btns" style={{ marginTop: 14 }}>
        <button className="b" onClick={() => setOnboarding({ setup: 0 })}>Refazer setup inicial</button>
        <button className="b" onClick={() => setOnboarding({ tour: true })}>Rever tour</button>
        <button className="b danger" disabled={others.length === 0} title={others.length === 0 ? 'Pelo menos um perfil fica' : undefined} onClick={() => setDeleting(hasPin ? 'pin' : true)}>Apagar perfil…</button>
      </div>
      {deleting === 'pin' && <div style={{ marginTop: 14 }}><CurrentPin profile={profile} title="Digite o PIN para apagar o perfil" onOk={() => setDeleting(true)} onCancel={() => setDeleting(false)} /></div>}
      {deleting === true && <DeleteProfileDialog profile={profile} profiles={profiles} close={() => db.close()} onCancel={() => setDeleting(false)} onDeleted={next => lockToPicker(next.id)} />}
    </div>
  )
}
