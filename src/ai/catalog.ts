import list from './catalog.json'

/** O que o `ai_hardware` do Rust devolve. */
export interface Hardware { ramBytes: number; arch: string; os: string; gpu: { name: string; vramMib: number } | null }
export type CatalogModel = (typeof list)[number]
export const CATALOG: CatalogModel[] = list

const gib = (hw: Hardware) => hw.ramBytes / 2 ** 30

/** Limites em GiB abaixo do nominal: uma máquina de 16 GB aparece como ~15,8 GiB. */
export function fits(m: CatalogModel, hw: Hardware, catalog = CATALOG): boolean {
  if (gib(hw) < Math.min(...catalog.map(c => c.minRamGiB))) return false
  return gib(hw) >= m.minRamGiB || (hw.os === 'windows' && !!hw.gpu && hw.gpu.vramMib / 1024 >= m.minVramGiB)
}

/** Primeiro modelo do catálogo (em ordem de preferência) que cabe na máquina. */
export function pickModel(hw: Hardware, catalog = CATALOG): { model: CatalogModel } | { unavailable: string } {
  if (hw.os === 'macos' && hw.arch !== 'aarch64') return { unavailable: 'O Assistente precisa de um Mac com chip Apple (M1 ou mais novo).' }
  const model = catalog.find(m => fits(m, hw, catalog))
  return model ? { model } : { unavailable: 'O Assistente precisa de pelo menos 8 GB de memória.' }
}

/** O modelo da faixa de baixo, para quando a calibração mostra a máquina lenta. */
export const lighter = (m: CatalogModel, catalog = CATALOG): CatalogModel | null => catalog[catalog.findIndex(c => c.id === m.id) + 1] ?? null

export const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB`

/** "Mac com chip Apple · 16 GB" / "PC com Windows · 16 GB · <GPU> 8 GB": memória arredondada para o nominal. */
export function machineLabel(hw: Hardware): string {
  const ram = `${Math.round(gib(hw))} GB`
  if (hw.os === 'macos') return `${hw.arch === 'aarch64' ? 'Mac com chip Apple' : 'Mac com processador Intel'} · ${ram}`
  return [`PC com ${hw.os === 'windows' ? 'Windows' : hw.os}`, ram, ...(hw.gpu ? [`${hw.gpu.name} ${Math.round(hw.gpu.vramMib / 1024)} GB`] : [])].join(' · ')
}

/** Modelo em uso: o escolhido, se já está no disco; sem escolha, o primeiro do catálogo que já foi baixado. */
export function installedModel(modelId: string | null, files: string[], catalog = CATALOG): CatalogModel | null {
  const chosen = catalog.find(m => m.id === modelId)
  if (chosen) return files.includes(chosen.file) ? chosen : null
  return catalog.find(m => files.includes(m.file)) ?? null
}
