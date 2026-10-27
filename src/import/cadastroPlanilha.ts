import * as XLSX from 'xlsx'
import type { Broker, Issuer } from '../db/irRepo'
import { formatCnpj } from '../domain/declaracao'
import { fold } from '../pages/lancamentos/build'

const rows = (ws: XLSX.WorkSheet | undefined) => (ws ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true }) : [])
const cell = (r: unknown[] | undefined, i: number) => String(r?.[i] ?? '').trim()

/**
 * Cadastro da planilha antiga: aba "Empresas Listadas" (Ticker, CNPJ, Razão social) e o bloco de corretoras da aba
 * "Bens e Direitos" (a partir do cabeçalho "Corretora" até a primeira linha vazia). A corretora só entra se casar com uma
 * das notas (`knownBrokers`), e fica com o código das notas. CNPJ inválido fica de fora e conta em `invalid`.
 */
export function parseCadastroPlanilha(buf: ArrayBuffer, knownBrokers: string[]): { issuers: Issuer[]; brokers: Broker[]; unknownBrokers: number; invalid: number } {
  const wb = XLSX.read(buf, { type: 'array' })
  let invalid = 0
  const cnpj = (text: string) => { try { return formatCnpj(text) } catch { invalid++; return null } }

  const issuers: Issuer[] = []
  for (const r of rows(wb.Sheets['Empresas Listadas']).slice(1)) {
    const ticker = cell(r, 0).toUpperCase(), name = cell(r, 2)
    if (!ticker || !name) continue
    const c = cnpj(cell(r, 1))
    if (c) issuers.push({ ticker, name, cnpj: c })
  }

  const known = new Map(knownBrokers.map(b => [fold(b), b]))
  const brokers: Broker[] = []
  let unknownBrokers = 0
  const bens = rows(wb.Sheets['Bens e Direitos'])
  const start = bens.findIndex(r => fold(cell(r, 0)) === 'corretora')
  if (start >= 0) {
    for (const r of bens.slice(start + 1)) {
      if (!cell(r, 0)) break
      const code = known.get(fold(cell(r, 0)))
      if (!code) { unknownBrokers++; continue }
      const c = cnpj(cell(r, 2))
      if (c && cell(r, 1)) brokers.push({ code, name: cell(r, 1), cnpj: c })
    }
  }
  return { issuers, brokers, unknownBrokers, invalid }
}
