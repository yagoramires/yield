import { invoke } from '@tauri-apps/api/core'
import { LEGACY_ID, SCOPED_KEYS, newProfile, randomId, scopedKey, type Profile, type ProfilesFile } from './profiles'

// Perfil ativo mora no localStorage; trocar de perfil recarrega a janela, então as stores já leem as chaves certas na importação.
export const ACTIVE_KEY = 'yield.perfilAtivo'
// sessionStorage: o perfil já escolhido nesta abertura do app (some ao fechar).
const CHOSEN_KEY = 'yield.perfilEscolhido'

export function activeProfileId(): string {
  try { return localStorage.getItem(ACTIVE_KEY) || LEGACY_ID } catch { return LEGACY_ID }
}

export const scoped = (key: string): string => scopedKey(key, activeProfileId())

export function chosenThisSession(): string | null {
  try { return sessionStorage.getItem(CHOSEN_KEY) } catch { return null }
}

export function markChosen(id: string): void {
  try { sessionStorage.setItem(CHOSEN_KEY, id) } catch { /* sem storage: pergunta de novo no próximo reload */ }
}

// A IA e o banco do perfil anterior não podem seguir abertos com a janela nova: o servidor de IA enxerga dados dele e o pool SQL fica preso no processo.
async function releasePrevious(): Promise<void> {
  await invoke('ai_stop').catch(() => {})
  await invoke('plugin:sql|close').catch(() => {})
}

export async function switchTo(id: string): Promise<void> {
  try { localStorage.setItem(ACTIVE_KEY, id) } catch { /* sem storage: o reload volta ao perfil anterior */ }
  markChosen(id)
  await releasePrevious()
  location.reload()
}

/** Grava o perfil novo (com `save`, que pode recusar e o erro sobe ao formulário) e já entra nele. */
export async function createAndSwitch(profiles: Profile[], input: { name: string; color: string; avatar: string | null }, save: (next: ProfilesFile) => Promise<void>): Promise<void> {
  const p = newProfile(input, new Date().toISOString(), randomId)
  await save({ version: 1, profiles: [...profiles, p] })
  await switchTo(p.id)
}

export function lockToPicker(nextActiveId?: string): void {
  if (nextActiveId) { try { localStorage.setItem(ACTIVE_KEY, nextActiveId) } catch { /* sem storage: segue o perfil anterior */ } }
  try { sessionStorage.removeItem(CHOSEN_KEY) } catch { /* sem storage: nada a apagar */ }
  void releasePrevious().finally(() => location.reload())
}

export function clearScoped(id: string): void {
  for (const k of SCOPED_KEYS) { try { localStorage.removeItem(scopedKey(k, id)) } catch { /* sem storage: nada a limpar */ } }
}
