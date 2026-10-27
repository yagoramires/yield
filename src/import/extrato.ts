import type { Db } from '../db/client'
import { insertTxns, upsertAccount } from '../db/gastosRepo'
import { withFingerprints } from '../domain/gastos'
import type { ParsedStatement } from './ofx'

export async function importStatement(db: Db, s: ParsedStatement): Promise<{ accountId: string; inserted: number; skipped: number }> {
  const accountId = await upsertAccount(db, { source: 'arquivo', externalId: s.externalId, institution: s.institution, name: s.name ?? s.institution, kind: s.kind, number: s.number, itemId: null, lastSyncAt: null })
  const seen = new Map<string, number>()
  // FITID repetido no arquivo ganha #n; a 1ª ocorrência fica sem sufixo para casar com o que já foi importado
  const fitidKey = (fitid: string) => { const n = seen.get(fitid) ?? 0; seen.set(fitid, n + 1); return n ? `${fitid}#${n}` : fitid }
  const txns = withFingerprints(accountId, s.rows).map(r => ({
    date: r.date, description: r.description, amountCents: r.amountCents, pending: false, installment: null, operationType: null, fingerprint: r.fingerprint,
    sourceKey: r.sourceKey ?? `${s.externalId}:${r.fitid ? fitidKey(r.fitid) : r.fingerprint}`,
  }))
  return { accountId, ...(await insertTxns(db, accountId, txns)) }
}
