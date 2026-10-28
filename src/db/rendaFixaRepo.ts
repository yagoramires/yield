import type { Cents, ISODate } from '../domain/types'
import type { Db } from './client'

export type RfMoveKind = 'aplicacao' | 'saida' | 'juros'
export interface RfMove { id: string; key: string; product: string; date: ISODate; kind: RfMoveKind; qty: number; valueCents: Cents | null /* null = a B3 não informou */; sourceKey: string }
export interface RfPosition { key: string; family: 'tesouro' | 'rf'; product: string; issuer: string | null; indexer: string; maturity: ISODate | null; qty: number; appliedCents: Cents | null; valueCents: Cents; asOf: ISODate }
export interface CryptoBalance { asset: string; qty: number; costCents: Cents | null; costManual: 0 | 1; costPartial: 0 | 1; fetchedAt: string }

export const loadRfMoves = (db: Db) =>
  db.select<RfMove>('SELECT id, key, product, date, kind, qty, value_cents AS valueCents, source_key AS sourceKey FROM rf_moves ORDER BY date, id')
export const loadRfPositions = (db: Db) =>
  db.select<RfPosition>('SELECT key, family, product, issuer, indexer, maturity, qty, applied_cents AS appliedCents, value_cents AS valueCents, as_of AS asOf FROM rf_positions ORDER BY product')
export const loadCryptoBalances = (db: Db) =>
  db.select<CryptoBalance>('SELECT asset, qty, cost_cents AS costCents, cost_manual AS costManual, cost_partial AS costPartial, fetched_at AS fetchedAt FROM crypto_balances ORDER BY asset')

export async function upsertRfMoves(db: Db, moves: Omit<RfMove, 'id'>[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0
  for (const m of moves) {
    const r = await db.execute('INSERT OR IGNORE INTO rf_moves (id, key, product, date, kind, qty, value_cents, source_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), m.key, m.product, m.date, m.kind, m.qty, m.valueCents, m.sourceKey])
    inserted += r.rowsAffected
  }
  return { inserted, skipped: moves.length - inserted }
}

/** Guarda o valor de cada título; uma Posição mais antiga que a guardada não sobrescreve. */
export async function upsertRfPositions(db: Db, list: RfPosition[]): Promise<{ updated: number; older: number }> {
  let updated = 0
  for (const p of list) {
    const r = await db.execute(
      `INSERT INTO rf_positions (key, family, product, issuer, indexer, maturity, qty, applied_cents, value_cents, as_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET family = excluded.family, product = excluded.product, issuer = excluded.issuer, indexer = excluded.indexer, maturity = excluded.maturity,
         qty = excluded.qty, applied_cents = excluded.applied_cents, value_cents = excluded.value_cents, as_of = excluded.as_of
       WHERE excluded.as_of >= rf_positions.as_of`,
      [p.key, p.family, p.product, p.issuer, p.indexer, p.maturity, p.qty, p.appliedCents, p.valueCents, p.asOf])
    updated += r.rowsAffected
  }
  return { updated, older: list.length - updated }
}

/** Saldos lidos agora; moeda que não veio fica com 0 e o aportado informado é mantido. */
export async function saveCryptoBalances(db: Db, list: { asset: string; qty: number }[], fetchedAt: string): Promise<void> {
  await db.execute('UPDATE crypto_balances SET qty = 0, fetched_at = ?', [fetchedAt])
  for (const b of list) {
    await db.execute('INSERT INTO crypto_balances (asset, qty, fetched_at) VALUES (?, ?, ?) ON CONFLICT (asset) DO UPDATE SET qty = excluded.qty, fetched_at = excluded.fetched_at', [b.asset, b.qty, fetchedAt])
  }
}

/** Aportado à mão; null devolve a moeda ao cálculo pelo histórico da Binance. */
export async function setCryptoCost(db: Db, asset: string, costCents: Cents | null): Promise<void> {
  await db.execute('UPDATE crypto_balances SET cost_cents = ?, cost_manual = ?, cost_partial = 0 WHERE asset = ?', [costCents, costCents === null ? 0 : 1, asset])
}

export async function saveComputedCryptoCosts(db: Db, list: { asset: string; costCents: Cents; partial: boolean }[]): Promise<void> {
  for (const c of list) await db.execute('UPDATE crypto_balances SET cost_cents = ?, cost_partial = ? WHERE asset = ? AND cost_manual = 0', [c.costCents, c.partial ? 1 : 0, c.asset])
}
