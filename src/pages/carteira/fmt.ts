import { formatCents } from '../../domain/money'

export const sign = (c: number, s: string) => (c > 0 ? `+${s}` : c < 0 ? `−${s.replace('-', '')}` : s)
export const tone = (c: number | null) => (c === null || c === 0 ? '' : c > 0 ? 'up' : 'dn')
export const pct = (p: number) => sign(p, `${(p * 100).toFixed(1).replace('.', ',')}%`)
export const signedCents = (c: number) => sign(c, formatCents(c))
export const br = (iso: string) => iso.split('-').reverse().join('/')
export const when = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}`
}
export const qtyText = (q: number) => q.toLocaleString('pt-BR', { maximumFractionDigits: 8 })
