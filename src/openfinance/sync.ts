import type { Db } from '../db/client'
import { loadGastos, replaceWindow, setLastSync, upsertAccount } from '../db/gastosRepo'
import { replaceBankInvestments, type BankInvestmentRow } from '../db/repo'
import { addTrades, saveNote } from '../db/repo'
import { withFingerprints } from '../domain/gastos'
import type { AssetType, ISODate } from '../domain/types'
import { assetTypeOf, settleDate } from '../import/b3'
import { normalizeBroker } from '../import/parse'
import { createPluggyClient, PluggyError, rendaVariavel, toTradeRow, toTxnRow, type PluggyAuth, type PluggyItem } from './pluggy'

export const SYNC_EVERY_MS = 6 * 60 * 60 * 1000
/** `found`: investimentos de renda variável do item; `existing`: operações que já estavam no Yield e ficaram como estavam. */
export interface InvestmentCounts { itemId: string; label: string; found: number; inserted: number; updated: number; existing: number }
/** Situação de cada banco na Pluggy: quando ela atualizou e o que pede atenção (null: tudo certo). */
export interface ItemHealth { itemId: string; updatedAt: string | null; problem: string | null }
export interface SyncResult { accounts: number; inserted: number; removed: number; errors: { itemId: string; label: string; message: string }[]; investments: InvestmentCounts[]; items?: ItemHealth[] }

const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
/**
 * O que a situação da conexão pede. `block`: autorização do Meu Pluggy vencida, as listas voltariam vazias e não há o que ler.
 * O resto só avisa: os dados até a última atualização continuam valendo.
 */
export function itemProblem(item: PluggyItem | null, nowMs: number): { block: boolean; text: string } | null {
  if (!item) return null
  const exp = item.consentExpiresAt && !isNaN(Date.parse(item.consentExpiresAt)) ? Date.parse(item.consentExpiresAt) : null
  if (exp !== null && exp <= nowMs) return { block: true, text: `a autorização do Meu Pluggy venceu em ${brDate(item.consentExpiresAt!)}: renove em meu.pluggy.ai (o mesmo passo de quando conectou)` }
  if (item.status === 'LOGIN_ERROR') return { block: false, text: 'o banco pediu login de novo: reconecte ele no Meu Pluggy (os dados até a última atualização continuam aqui)' }
  if (item.status === 'WAITING_USER_INPUT') return { block: false, text: 'o banco está esperando uma confirmação sua no Meu Pluggy' }
  if (item.status === 'OUTDATED') return { block: false, text: 'a última atualização na Pluggy falhou; ela tenta de novo sozinha' }
  if (exp !== null && exp - nowMs < 30 * 864e5) return { block: false, text: `a autorização do Meu Pluggy vence em ${brDate(item.consentExpiresAt!)}: renove em meu.pluggy.ai antes disso` }
  return null
}
const REFRESH_POLL_MS = 3_000
const REFRESH_WAIT_MS = 90_000
/** Pede à Pluggy que releia o banco e espera ela terminar. Falha aqui nunca derruba a leitura: devolve o aviso e a leitura segue com o que a Pluggy já tinha. */
async function refreshItem(client: ReturnType<typeof createPluggyClient>, itemId: string, sleep: (ms: number) => Promise<void>): Promise<string | null> {
  try {
    let it = await client.refreshItem(itemId)
    for (let waited = 0; it.status === 'UPDATING' || it.status === 'LOGIN_IN_PROGRESS'; waited += REFRESH_POLL_MS) {
      if (waited >= REFRESH_WAIT_MS) return 'a Pluggy ainda está lendo este banco; mostrei o que ela já tinha'
      await sleep(REFRESH_POLL_MS)
      it = await client.getItem(itemId)
    }
    return null
  } catch (e) {
    // 401/403 do PATCH vira "credenciais" no cliente, mas aqui é só a Pluggy recusando a atualização (as leituras seguintes dizem se a credencial é ruim)
    const why = e instanceof PluggyError && e.kind !== 'credenciais' ? e.message : 'a Pluggy recusou'
    return `não consegui pedir a atualização do banco (${why}); mostrei o que a Pluggy já tinha`
  }
}
type PluggyTrade = NonNullable<ReturnType<typeof toTradeRow>> & { ticker: string; assetType: AssetType | null }

const addDays = (d: ISODate, n: number): ISODate => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10)

export async function syncPluggy(db: Db, auth: PluggyAuth, fetchFn: typeof fetch, today: ISODate, now: () => Date = () => new Date(),
  opts: { refresh?: boolean; sleep?: (ms: number) => Promise<void> } = {}): Promise<SyncResult> {
  const client = createPluggyClient(auth, fetchFn)
  const result: SyncResult = { accounts: 0, inserted: 0, removed: 0, errors: [], investments: [], items: [] }
  const items = (await loadGastos(db)).pluggyItems
  const dateTo = addDays(today, 31)
  let badCreds: string | null = null
  // só no "Sincronizar agora": a Pluggy relê os bancos (em paralelo) antes de a gente ler
  const sleep = opts.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))
  const refreshNote = new Map<string, string | null>(opts.refresh ? await Promise.all(items.map(async it => [it.itemId, await refreshItem(client, it.itemId, sleep)] as const)) : [])

  for (const item of items) {
    if (badCreds) { result.errors.push({ itemId: item.itemId, label: item.label, message: badCreds }); continue } // mesma credencial para todos os itens
    try {
      // situação da conexão: sem ela (Pluggy fora, formato novo) a leitura segue como antes
      let info: PluggyItem | null = null
      try { info = await client.getItem(item.itemId) } catch (e) { if (e instanceof PluggyError && (e.kind === 'credenciais' || e.kind === 'item')) throw e }
      const problem = itemProblem(info, now().getTime())
      result.items!.push({ itemId: item.itemId, updatedAt: info?.lastUpdatedAt ?? null, problem: problem?.text ?? refreshNote.get(item.itemId) ?? null })
      if (problem?.block) { result.errors.push({ itemId: item.itemId, label: item.label, message: problem.text }); continue }
      const stored = (await loadGastos(db)).accounts // nada é gravado antes de buscar tudo do item: uma leitura basta
      const known = stored.filter(a => a.itemId === item.itemId)
      // Busca tudo do item antes de gravar: erro no meio não deixa o item pela metade.
      const fetched = []
      const accounts = await client.listAccounts(item.itemId)
      // lista vazia de um banco que tinha contas é a Pluggy sem dados (autorização vencida, banco fora): fica o que já estava
      if (!accounts.length && known.length) { result.errors.push({ itemId: item.itemId, label: item.label, message: 'a Pluggy não devolveu as contas deste banco; mantive o que já estava' }); continue }
      for (const pa of accounts) {
        const kind = pa.type === 'CREDIT' ? 'cartao' as const : 'conta' as const
        const externalId = `pluggy:${pa.id}`
        const prev = stored.find(a => a.externalId === externalId)
        const floor = addDays(today, -365) // a Pluggy não devolve além disso; ir mais longe apagaria linhas que não voltam
        // cartão sempre o ano todo: há banco (XP) que data as parcelas pela compra, e a parcela de agora chegaria com data de meses atrás
        const dateFrom = prev?.lastSyncAt && kind === 'conta' ? [addDays(prev.lastSyncAt.slice(0, 10), -35), floor].sort()[1] : floor
        const txns = await client.listTransactions(pa.id, dateFrom, dateTo)
        fetched.push({ pa, kind, externalId, dateFrom, rows: txns.map(t => toTxnRow(t, kind)) })
      }
      for (const f of fetched) {
        const balance = typeof f.pa.balance === 'number' && Number.isFinite(f.pa.balance) ? Math.round(f.pa.balance * 100) : null
        const id = await upsertAccount(db, { source: 'pluggy', externalId: f.externalId, institution: item.label, name: f.pa.marketingName || f.pa.name, kind: f.kind, number: f.pa.number ?? null, itemId: item.itemId, lastSyncAt: null,
          balanceCents: balance, balanceAt: balance === null ? null : now().toISOString() })
        const rows = withFingerprints(id, f.rows).map(r => ({ ...r, sourceKey: `pluggy:${r.fingerprint}` }))
        // nenhum lançamento onde antes havia: não apaga a janela inteira por uma leitura vazia
        if (!rows.length && (await db.select<{ n: number }>('SELECT count(*) AS n FROM transactions WHERE account_id = ? AND date >= ?', [id, f.dateFrom]))[0].n > 0) {
          result.errors.push({ itemId: item.itemId, label: item.label, message: `a Pluggy não devolveu lançamentos de ${f.pa.marketingName || f.pa.name}; mantive os que já estavam` })
          continue
        }
        // cartão vem o ano todo: se o banco devolve menos histórico, o que é mais antigo que a leitura fica como estava
        const from = f.kind === 'cartao' && rows.length ? [f.dateFrom, rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date)].sort()[1] : f.dateFrom
        const { inserted, removed } = await replaceWindow(db, id, from, rows)
        await setLastSync(db, id, now().toISOString())
        result.accounts++; result.inserted += inserted; result.removed += removed
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erro ao sincronizar'
      if (e instanceof PluggyError && e.kind === 'credenciais') badCreds = message
      result.errors.push({ itemId: item.itemId, label: item.label, message })
      continue
    }
    try {
      const trades: PluggyTrade[] = []
      const held: BankInvestmentRow[] = [] // o que não é ação/ETF e tem saldo: RDB, caixinha, fundo, CDB…
      let found = 0
      for (const inv of await client.listInvestments(item.itemId)) {
        const rv = rendaVariavel(inv)
        if (!rv) {
          const cents = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : null)
          const balanceCents = cents(inv.balance)
          if (inv.type !== 'EQUITY' && inv.type !== 'ETF' && balanceCents !== null && balanceCents > 0)
          {
            // aplicado só quando faz sentido: zero, ou bem acima do saldo (caixinha com resgates), vira "sem aportado"
            const cost = cents(inv.amountOriginal)
            held.push({ id: inv.id, itemId: item.itemId, name: inv.name, type: inv.type, subtype: inv.subtype ?? null, balanceCents,
              costCents: cost !== null && cost > 0 && cost <= balanceCents * 2 ? cost : null, fetchedAt: now().toISOString() })
          }
          continue
        }
        found++
        for (const t of await client.listInvestmentTransactions(inv.id)) {
          const row = toTradeRow(t)
          if (row) trades.push({ ...row, ...rv })
        }
      }
      result.investments.push({ itemId: item.itemId, label: item.label, found, ...await mergeTrades(db, normalizeBroker(item.label), trades) })
      await replaceBankInvestments(db, item.itemId, held)
    } catch (e) {
      // as contas deste item acabaram de passar com a mesma chave: 403 aqui é falta do produto, não credencial ruim
      const message = e instanceof Error ? e.message : 'Erro ao sincronizar'
      result.errors.push({ itemId: item.itemId, label: item.label, message: `investimentos não lidos (${message})` })
    }
  }
  return result
}

/** Por (dia, ticker, lado), a quantidade que já está no Yield (qualquer nota) cobre a da Pluggy: nota em PDF ou à mão fica como está;
 * a operação única da Negociação da B3 ou da Pluggy só ganha as taxas; o que faltar entra numa operação só, a preço médio. */
async function mergeTrades(db: Db, broker: string, trades: PluggyTrade[]) {
  let inserted = 0, updated = 0, existing = 0
  const groups = new Map<string, PluggyTrade[]>()
  for (const t of trades) { const k = `${t.date}|${t.ticker}|${t.side}`; groups.set(k, [...(groups.get(k) ?? []), t]) }
  const fresh = new Map<ISODate, PluggyTrade[]>()
  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0)
  // uma leitura só: as operações dos tickers que a Pluggy trouxe, em qualquer data
  const tickers = [...new Set(trades.map(t => t.ticker))]
  const known = tickers.length ? await db.select<{ id: string; date: ISODate; ticker: string; side: string; assetType: AssetType; source: string; sourceKey: string | null; qty: number; feesCents: number; irrfCents: number }>(
    `SELECT t.id, n.trade_date AS date, t.ticker, t.side, t.asset_type AS assetType, n.source, n.source_key AS sourceKey, t.qty, t.fees_cents AS feesCents, t.irrf_cents AS irrfCents
      FROM trades t JOIN notes n ON n.id = t.note_id WHERE t.ticker IN (${tickers.map(() => '?').join(', ')}) ORDER BY t.rowid`, tickers) : []
  const typeOf = new Map<string, AssetType>()
  for (const k of known) if (!typeOf.has(k.ticker)) typeOf.set(k.ticker, k.assetType)
  for (const list of groups.values()) {
    const t = list[0]
    const have = known.filter(k => k.date === t.date && k.ticker === t.ticker && k.side === t.side)
    const qty = sum(list, x => x.qty), haveQty = sum(have, x => x.qty)
    if (haveQty >= qty - 1e-9) {
      const m = have[0]
      const auto = have.length === 1 && list.length === 1 && m.qty === t.qty && m.source === 'sem_nota' && /^(b3neg|pluggy):/.test(m.sourceKey ?? '')
      if (auto && (t.feesCents > 0 || t.irrfCents > 0) && (t.feesCents !== m.feesCents || t.irrfCents !== m.irrfCents)) {
        await db.execute('UPDATE trades SET fees_cents = ?, irrf_cents = ? WHERE id = ?', [t.feesCents, t.irrfCents, m.id])
        updated++
      } else existing += list.length
      continue
    }
    const rest = qty - haveQty
    const share = (f: (x: PluggyTrade) => number) => Math.round(sum(list, f) * rest / qty)
    const rows = haveQty === 0 ? list
      : [{ ...t, qty: rest, priceCents: Math.round(sum(list, x => x.qty * x.priceCents) / qty), feesCents: share(x => x.feesCents), irrfCents: share(x => x.irrfCents) }]
    fresh.set(t.date, [...(fresh.get(t.date) ?? []), ...rows])
  }
  for (const [date, list] of fresh) {
    const rows = []
    for (const t of list) {
      // ETF de renda fixa a Pluggy chama só de ETF; o tipo já escolhido no Yield vale
      const assetType = t.assetType === 'ETF' && typeOf.get(t.ticker) === 'ETF RF' ? 'ETF RF' : t.assetType ?? typeOf.get(t.ticker) ?? assetTypeOf(t.ticker)
      rows.push({ side: t.side, assetType, ticker: t.ticker, qty: t.qty, priceCents: t.priceCents, feesCents: t.feesCents, irrfCents: t.irrfCents })
    }
    const sourceKey = `pluggy:${date}:${broker}`
    const [note] = await db.select<{ id: string; seq: number | null }>('SELECT n.id, max(t.seq) AS seq FROM notes n LEFT JOIN trades t ON t.note_id = n.id WHERE n.source_key = ? GROUP BY n.id', [sourceKey])
    if (note) await addTrades(db, note.id, rows.map((r, i) => ({ ...r, seq: (note.seq ?? 0) + i + 1 })))
    else await saveNote(db, { number: `Pluggy ${date}`, broker, tradeDate: date, settleDate: settleDate(date), source: 'sem_nota', sourceKey, label: 'Pluggy (sem nota)' }, rows.map((r, i) => ({ ...r, seq: i + 1 })))
    inserted += list.length
  }
  return { inserted, updated, existing }
}
