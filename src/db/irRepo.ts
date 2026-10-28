import type { Db } from './client'
import { formatCnpj } from '../domain/declaracao'

export interface Issuer { ticker: string; name: string; cnpj: string }
export interface Broker { code: string; name: string; cnpj: string }

export async function loadCadastro(db: Db): Promise<{ issuers: Issuer[]; brokers: Broker[] }> {
  const [issuers, brokers] = await Promise.all([
    db.select<Issuer>('SELECT ticker, name, cnpj FROM issuers ORDER BY ticker'),
    db.select<Broker>('SELECT code, name, cnpj FROM brokers ORDER BY code'),
  ])
  return { issuers, brokers }
}

const clean = (name: string) => {
  const n = name.trim()
  if (!n) throw new Error('Razão social: preencha o nome')
  return n
}

export async function saveIssuer(db: Db, i: Issuer): Promise<void> {
  await db.execute('INSERT OR REPLACE INTO issuers (ticker, name, cnpj) VALUES (?, ?, ?)', [i.ticker.trim().toUpperCase(), clean(i.name), formatCnpj(i.cnpj)])
}

export async function saveBroker(db: Db, b: Broker): Promise<void> {
  await db.execute('INSERT OR REPLACE INTO brokers (code, name, cnpj) VALUES (?, ?, ?)', [b.code, clean(b.name), formatCnpj(b.cnpj)])
}

/** Só acrescenta: quem já está cadastrado (inclusive editado à mão) fica como está. Devolve quantos entraram. */
export async function addIssuers(db: Db, issuers: Issuer[]): Promise<number> {
  let n = 0
  for (const i of issuers) n += (await db.execute('INSERT OR IGNORE INTO issuers (ticker, name, cnpj) VALUES (?, ?, ?)', [i.ticker, i.name, i.cnpj])).rowsAffected
  return n
}
