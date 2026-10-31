import { Check, ChevronDown, Lock, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { lockToPicker, switchTo } from './active'
import { randomId } from './Picker'
import { Avatar } from './ProfileAvatar'
import { useProfiles } from './Gate'
import { ProfileForm } from './ProfileForm'
import { newProfile } from './profiles'

/** O perfil ativo no topo do menu; abre a lista para trocar, criar um perfil novo ou voltar à tela de escolha. */
export function ProfileSwitcher({ mini = false }: { mini?: boolean }) {
  const { profile, profiles, save } = useProfiles()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  // mesmo popover do SyncStatus: o foco entra nele ao abrir; fecha ao clicar fora ou com Esc (só ele)
  useEffect(() => {
    if (!open) return
    box.current?.querySelector<HTMLElement>('.prof-pop')?.focus()
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', esc, true) }
  }, [open])

  async function create(v: { name: string; color: string; avatar: string | null }) {
    const p = newProfile(v, new Date().toISOString(), randomId)
    await save({ version: 1, profiles: [...profiles, p] })
    await switchTo(p.id)
  }

  return (
    <>
      <div className="prof-box" ref={box} onBlur={e => { if (open && e.relatedTarget && !box.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
        <button ref={trigger} className="prof-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}
          aria-label={mini ? `Perfil: ${profile.name}. Trocar perfil` : undefined} title={mini ? `Perfil: ${profile.name}` : undefined}>
          <Avatar profile={profile} size={28} />
          {!mini && <span className="prof-txt"><span className="prof-n">{profile.name}</span><span className="prof-s">trocar perfil <ChevronDown size={11} aria-hidden /></span></span>}
        </button>
        {open && (
          <div className="prof-pop" role="dialog" aria-label="Perfis" tabIndex={-1}>
            {profiles.map(p => (
              <button key={p.id} className="prof-opt" aria-current={p.id === profile.id ? 'true' : undefined}
                onClick={() => { if (p.id === profile.id) setOpen(false); else void switchTo(p.id) }}>
                <Avatar profile={p} size={24} /><span className="prof-optn">{p.name}</span>
                {p.id === profile.id && <Check size={14} aria-hidden />}
              </button>
            ))}
            <hr />
            <button className="prof-opt sub" onClick={() => { setOpen(false); setCreating(true) }}><Plus size={14} aria-hidden />Novo perfil</button>
            {profiles.length >= 2 && <button className="prof-opt sub" onClick={() => lockToPicker()}><Lock size={14} aria-hidden />Bloquear agora</button>}
          </div>
        )}
      </div>
      {creating && (
        <div className="modal-bg">
          <div className="modal profile-modal" role="dialog" aria-modal="true" aria-label="Novo perfil">
            <h2>Novo perfil</h2>
            <ProfileForm others={profiles} submitLabel="Criar perfil" onSubmit={create} onCancel={() => { setCreating(false); trigger.current?.focus() }} />
          </div>
        </div>
      )}
    </>
  )
}
