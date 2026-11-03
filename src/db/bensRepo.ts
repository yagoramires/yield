import type { Cents, ISODate, Month } from '../domain/types'
import type { Db } from './client'

export type PossessionKind = 'apartamento' | 'casa' | 'terreno' | 'imovel' | 'veiculo' | 'outro'
// vencimento que volta todo ano (IPVA, IPTU, seguro); valor opcional
export interface Reminder { name: string; day: number; month: number /* 1–12 */; amountCents: Cents | null }
export interface Possession {
  id: string; kind: PossessionKind; name: string; details: string | null; boughtAt: ISODate; costCents: Cents
  valueCents: Cents | null; valueAt: ISODate | null
  // financiamento: só quando parcela, total e primeira parcela existem
  downPaymentCents: Cents | null; installmentCents: Cents | null; installmentsTotal: number | null; firstInstallment: Month | null; debtCents: Cents | null
  categoryIds: string[]; reminders: Reminder[]
}

type Row = Omit<Possession, 'categoryIds' | 'reminders'> & { categoryIds: string; reminders: string }

export async function loadBens(db: Db): Promise<Possession[]> {
  const rows = await db.select<Row>(`SELECT id, kind, name, details, bought_at AS boughtAt, cost_cents AS costCents, value_cents AS valueCents, value_at AS valueAt,
    down_payment_cents AS downPaymentCents, installment_cents AS installmentCents, installments_total AS installmentsTotal, first_installment AS firstInstallment,
    debt_cents AS debtCents, category_ids AS categoryIds, reminders FROM possessions ORDER BY bought_at, name`)
  return rows.map(r => ({ ...r, categoryIds: JSON.parse(r.categoryIds) as string[], reminders: JSON.parse(r.reminders) as Reminder[] }))
}

export async function saveBem(db: Db, p: Omit<Possession, 'id'> & { id?: string }): Promise<string> {
  const id = p.id ?? crypto.randomUUID()
  await db.execute(`INSERT INTO possessions (id, kind, name, details, bought_at, cost_cents, value_cents, value_at, down_payment_cents, installment_cents, installments_total, first_installment, debt_cents, category_ids, reminders)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, name = excluded.name, details = excluded.details, bought_at = excluded.bought_at, cost_cents = excluded.cost_cents,
      value_cents = excluded.value_cents, value_at = excluded.value_at, down_payment_cents = excluded.down_payment_cents, installment_cents = excluded.installment_cents,
      installments_total = excluded.installments_total, first_installment = excluded.first_installment, debt_cents = excluded.debt_cents,
      category_ids = excluded.category_ids, reminders = excluded.reminders`,
  [id, p.kind, p.name, p.details, p.boughtAt, p.costCents, p.valueCents, p.valueAt, p.downPaymentCents, p.installmentCents, p.installmentsTotal, p.firstInstallment, p.debtCents, JSON.stringify(p.categoryIds), JSON.stringify(p.reminders)])
  return id
}

export async function deleteBem(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM possessions WHERE id = ?', [id])
}
