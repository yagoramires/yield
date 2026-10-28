import { utils, type WorkBook } from 'xlsx'
import type { RfMoveKind, RfPosition } from '../db/rendaFixaRepo'
import type { ISODate } from '../domain/types'
import { parseBRDate, parseBRL } from './parse'

type Cell = string | number | boolean | null
const text = (v: Cell | undefined) => (v == null ? '' : String(v).trim())

export const isRendaFixa = (produto: string) => /^(tesouro|cdb|lci|lca|cri|cra|deb|lig|lf|rdb)\b/i.test(produto.trim())

/**
 * Mesma chave nos dois relatórios. Tesouro: o nome do título (a instituição vem escrita diferente em cada um).
 * Demais: o código, que a Movimentação põe no meio do produto ("CDB - <código> - <emissor>") e a Posição numa coluna.
 */
export function rfKey(produto: string, codigo?: string): string {
  if (/^tesouro\b/i.test(produto.trim())) return `td:${produto.trim().replace(/\s+/g, ' ').toLowerCase()}`
  return `rf:${(codigo ?? produto.split(' - ')[1] ?? produto).trim().toUpperCase()}`
}

export function rfMoveKind(mov: string, entrada: boolean): RfMoveKind | null {
  if (/juros/i.test(mov)) return 'juros'
  if (entrada && /^(compra|compra \/ venda)$/i.test(mov.trim())) return 'aplicacao'
  if (!entrada && /^venda$|vencimento|resgate/i.test(mov.trim())) return 'saida'
  return null
}

export function posicaoDate(fileName: string): ISODate | null {
  const m = /posicao-(\d{4}-\d{2}-\d{2})/i.exec(fileName)
  return m ? m[1] : null
}

const date = (v: Cell | undefined) => (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text(v)) || typeof v === 'number' ? parseBRDate(v as string | number) : null)

/** Abas "Tesouro Direto" e "Renda Fixa" da Posição; as outras abas e as linhas de total ficam de fora. */
export function parsePosicao(wb: WorkBook, asOf: ISODate): RfPosition[] {
  const sheet = (name: string) => {
    const ws = wb.Sheets[name]
    if (!ws) return []
    const rows = utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: false })
    const col = new Map(rows[0]?.map((h, i) => [text(h), i]))
    return rows.slice(1).map(r => (h: string) => r[col.get(h) ?? -1])
  }
  const out: RfPosition[] = []
  for (const get of sheet('Tesouro Direto')) {
    const produto = text(get('Produto'))
    if (!produto || !text(get('Instituição')) || typeof get('Valor Atualizado') !== 'number') continue
    out.push({
      key: rfKey(produto), family: 'tesouro', product: produto, issuer: null, indexer: text(get('Indexador')), maturity: date(get('Vencimento')),
      qty: Number(get('Quantidade')), appliedCents: typeof get('Valor Aplicado') === 'number' ? parseBRL(get('Valor Aplicado') as number) : null,
      valueCents: parseBRL(get('Valor Atualizado') as number), asOf,
    })
  }
  for (const get of sheet('Renda Fixa')) {
    const produto = text(get('Produto'))
    // a B3 manda "-" nas colunas sem valor; nos CDBs só a curva vem preenchida
    const value = ['Valor Atualizado CURVA', 'Valor Atualizado MTM', 'Valor Atualizado FECHAMENTO'].map(get).find(v => typeof v === 'number') as number | undefined
    if (!produto || !text(get('Instituição')) || value === undefined) continue
    out.push({
      key: rfKey(produto, text(get('Código'))), family: 'rf', product: produto, issuer: text(get('Emissor')) || null, indexer: text(get('Indexador')),
      maturity: date(get('Vencimento')), qty: Number(get('Quantidade')), appliedCents: null, valueCents: parseBRL(value), asOf,
    })
  }
  // o mesmo título em duas corretoras vem em duas linhas com a mesma chave: soma
  const byKey = new Map<string, RfPosition>()
  for (const p of out) {
    const prev = byKey.get(p.key)
    byKey.set(p.key, !prev ? p : { ...prev, qty: prev.qty + p.qty, valueCents: prev.valueCents + p.valueCents,
      appliedCents: prev.appliedCents === null || p.appliedCents === null ? null : prev.appliedCents + p.appliedCents })
  }
  return [...byKey.values()]
}
