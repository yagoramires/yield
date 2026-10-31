import { Avatar } from './ProfileAvatar'
import type { Profile } from './profiles'

export function ForgotPin({ profile, onBack, onDelete }: { profile: Profile; onBack(): void; onDelete(): void }) {
  return (
    <div className="pin-pad">
      <Avatar profile={profile} size={64} />
      <div className="pin-title">{profile.name}</div>
      <p className="pin-forgot">Sem o PIN, os dados deste perfil não têm como ser abertos, nem pelo Yield. Dá para apagar este perfil e, se você tiver um backup, criar um perfil novo em "Novo perfil" → "Restaurar de um backup".</p>
      <div className="btns">
        <button type="button" className="b" autoFocus onClick={onBack}>Voltar ao PIN</button>
        <button type="button" className="b danger" onClick={onDelete}>Apagar este perfil…</button>
      </div>
    </div>
  )
}
