/** Só dígitos, no máximo 8, com as barras de dd/mm/aaaa entrando enquanto digita. */
export function maskBR(text: string): string {
  const d = text.replace(/\D/g, '').slice(0, 8)
  return d.length <= 2 ? d : d.length <= 4 ? `${d.slice(0, 2)}/${d.slice(2)}` : `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

/** "16/08/2021" → "2021-08-16"; incompleta ou impossível (31/02) → null. */
export function parseBR(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text)
  if (!m) return null
  const iso = `${m[3]}-${m[2]}-${m[1]}`
  const t = Date.parse(`${iso}T00:00:00Z`)
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso ? null : iso
}

export const isoToBR = (iso: string): string => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

/** 6 semanas a partir do domingo antes do dia 1 (`month` de 0 a 11), marcando os dias do próprio mês. */
export function monthGrid(year: number, month: number): { iso: string; inMonth: boolean }[] {
  const first = Date.UTC(year, month, 1)
  const start = first - new Date(first).getUTCDay() * 86_400_000
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start + i * 86_400_000)
    return { iso: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === month }
  })
}
