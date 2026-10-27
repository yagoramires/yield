/** "11222333000181" ou "11.222.333/0001-81" → "11.222.333/0001-81"; recusa tamanho, dígito verificador e números repetidos. */
export function formatCnpj(text: string): string {
  const d = text.replace(/\D/g, '')
  const dv = (base: string) => {
    const w = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const r = [...base].reduce((s, c, i) => s + Number(c) * w[i], 0) % 11
    return r < 2 ? 0 : 11 - r
  }
  if (d.length !== 14 || /^(\d)\1+$/.test(d) || dv(d.slice(0, 12)) !== Number(d[12]) || dv(d.slice(0, 13)) !== Number(d[13])) throw new Error('CNPJ inválido: confira os 14 números')
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}
