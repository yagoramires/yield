import type { Db } from '../db/client'
import type { Possession } from '../db/bensRepo'
import type { Category, GastosData, Txn } from '../db/gastosRepo'
import { createMonth, deleteLine, loadOrcamento, saveLine, type OrcamentoData } from '../db/orcamentoRepo'
import type { Subscription } from '../domain/assinaturas'
import { monthOf } from '../domain/money'
import { copyLines, withSources } from '../domain/orcamento'
import { purchases, staleInstallmentLines, type Purchase } from '../domain/parcelas'
import { displayName, fold } from '../domain/gastos'
import { suggestForMonth } from '../domain/sugestoes'
import type { ISODate, Month } from '../domain/types'

/** Dispensas que valem no mês: as dele e as de "nunca mais" (mês '*', chave sem o mês). */
export const dismissedFor = (ds: OrcamentoData['dismissed'], month: Month): string[] =>
  ds.flatMap(d => (d.month === month ? [d.key] : d.month === '*' ? [`${d.key}@${month}`] : []))

// dispensa do mês atual que a pessoa excluiu: o automático não o recria
export const MES_APAGADO = 'mes-apagado'

const firstWord = (name: string) => fold(name).split(/[^a-z0-9]+/).find(w => w.length >= 3) ?? fold(name)

/**
 * O plano se mantém sozinho: o mês que começou nasce do último planejado; parcela quitada no cartão ou repetida sai (deste mês em diante);
 * assinatura, parcela em aberto e financiamento de bem que aparecem entram no mês atual e nos próximos já criados. Linha que a pessoa
 * apagou não volta (fica nas dispensas de "nunca mais").
 */
export async function autoPlan(db: Db, o: OrcamentoData, g: GastosData, cat: (t: Txn) => Category | null, subs: Subscription[], bens: Possession[], today: ISODate, ps: Purchase[] = purchases(g.txns, today)):
  Promise<{ changed: boolean; removed: string[] }> {
  const cur = monthOf(today)
  let changed = false
  const last = o.months.at(-1)
  if (last && last < cur && !o.dismissed.some(d => d.month === cur && d.key === MES_APAGADO)) {
    const lines = withSources(copyLines(o.lines.filter(l => l.month === last), o.sources, cur), o.sources, cur)
    if (await createMonth(db, cur, lines) === 'criado') { changed = true; o = await loadOrcamento(db) }
  }
  const stale = staleInstallmentLines(o.lines, ps, cur)
  // assinatura marcada "cancelei": sai dos meses depois do cancelamento (senão cada mês novo a copiaria do anterior)
  const canceled = new Map(subs.filter(s => s.canceledAt).map(s => [`sub:${s.merchantKey}`, monthOf(s.canceledAt!)]))
  // e a que a pessoa apagou ("nunca mais") sai também dos meses seguintes que já existiam, senão o próximo mês a copiaria de volta
  const never = new Set(o.dismissed.filter(d => d.month === '*').map(d => d.key))
  const gone = o.lines.filter(l => {
    const base = l.sourceKey?.replace(/@\d{4}-\d{2}$/, '')
    if (!base || l.month < cur) return false
    const c = canceled.get(base)
    return never.has(base) || (!!c && l.month > c)
  })
  for (const l of [...stale, ...gone]) await deleteLine(db, l.id)
  if (stale.length || gone.length) { changed = true; o = await loadOrcamento(db) }
  for (const m of o.months.filter(m => m >= cur)) {
    // a mesma despesa já escrita à mão no mês (ex.: "Netflix" para a assinatura NETFLIX.COM) não entra de novo
    const manual = o.lines.filter(l => l.month === m && l.kind === 'saida' && !l.sourceKey).map(l => firstWord(l.name))
    for (const s of suggestForMonth(m, subs, g.txns, cat, o.lines, dismissedFor(o.dismissed, m), bens, today, ps)) {
      if (manual.includes(firstWord(displayName(s.name)))) continue
      await saveLine(db, { month: m, kind: 'saida', name: s.name, amountCents: s.amountCents, recurring: s.recurring, categoryId: s.categoryId, installmentCurrent: s.installmentCurrent,
        installmentTotal: s.installmentTotal, sourceId: null, sourceKey: s.key, position: 0, grupo: 'fixo' })
      changed = true
    }
  }
  return { changed, removed: stale.map(l => l.name) }
}
