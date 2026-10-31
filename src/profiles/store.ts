import { invoke } from '@tauri-apps/api/core'
import { isFreshInstall, setOnboarding } from '../onboarding/state'
import { ensureLegacy, parseProfiles, type ProfilesFile } from './profiles'

export const saveProfiles = (f: ProfilesFile): Promise<void> => invoke('profiles_write', { json: JSON.stringify(f, null, 2) })

// Sem `perfis.json` (ou ilegível), o banco de hoje vira o perfil `principal` e a lista é gravada.
export async function loadProfiles(): Promise<ProfilesFile> {
  const raw = await invoke<string | null>('profiles_read')
  const parsed = parseProfiles(raw)
  const f = ensureLegacy(parsed, new Date().toISOString())
  if (f !== parsed) {
    // instalação nova abre no setup inicial; quem atualiza (já tem preferências do app) não vê
    const fresh = (() => { try { return isFreshInstall(localStorage) } catch { return false } })()
    await saveProfiles(f)
    if (fresh) setOnboarding({ setup: 0 })
  }
  return f
}
