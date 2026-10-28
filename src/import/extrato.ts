import type { Db } from '../db/client'
import { insertTxns, upsertAccount } from '../db/gastosRepo'
import { withFingerprints } from '../domain/gastos'
import type { ParsedStatement } from './ofx'

// "LOJA 03/10", "PARC 3/10", "3 DE 10"; sem dígito ou barra colados (03/10/2024, 2024/03/10) nem hora em seguida (data dd/mm)
const INSTALLMENT = /(?<![\d/])(\d{1,2})(?:\s*\/\s*|\s+DE\s+)(\d{1,2})(?![\d/])(?!\s+\d{1,2}:\d{2})/gi

/** Parcela 'n/total' na descrição do extrato; dd/mm sem ano com dia ≤ mês ainda passa como parcela. */
export function parseInstallment(description: string): string | null {
  const m = [...description.matchAll(INSTALLMENT)].map(([, a, b]) => [Number(a), Number(b)]).filter(([n, t]) => n >= 1 && n <= t && t >= 2 && t <= 48).at(-1)
  return m ? `${m[0]}/${m[1]}` : null
}

export async function importStatement(db: Db, s: ParsedStatement): Promise<{ accountId: string; inserted: number; skipped: number }> {
  const accountId = await upsertAccount(db, { source: 'arquivo', externalId: s.externalId, institution: s.institution, name: s.name ?? s.institution, kind: s.kind, number: s.number, itemId: null, lastSyncAt: null })
  const seen = new Map<string, number>()
  // FITID repetido no arquivo ganha #n; a 1ª ocorrência fica sem sufixo para casar com o que já foi importado
  const fitidKey = (fitid: string) => { const n = seen.get(fitid) ?? 0; seen.set(fitid, n + 1); return n ? `${fitid}#${n}` : fitid }
  const txns = withFingerprints(accountId, s.rows).map(r => ({
    date: r.date, description: r.description, amountCents: r.amountCents, pending: false, installment: parseInstallment(r.description), operationType: null, fingerprint: r.fingerprint,
    sourceKey: r.sourceKey ?? `${s.externalId}:${r.fitid ? fitidKey(r.fitid) : r.fingerprint}`,
  }))
  return { accountId, ...(await insertTxns(db, accountId, txns)) }
}
