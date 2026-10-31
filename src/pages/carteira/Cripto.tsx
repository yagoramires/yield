import { useState } from 'react'
import { setCryptoCost } from '../../db/rendaFixaRepo'
import { formatCents, editCents } from '../../domain/money'
import type { CryptoRow } from '../../domain/portfolio'
import { useData } from '../../state/DataProvider'
import { errText } from '../lancamentos/GastosHeader'
import { parseMoney } from '../notas/build'
import { pct, qtyText, signedCents, tone, when } from './fmt'
import { PosRow } from './PosRow'
import type { SectionId } from '../configuracoes/secoes'

const PARTIAL = 'Parte do histórico não tem custo em real conhecido (paga com outra cripto ou moeda, ou uma fonte não foi lida). Informe à mão se souber.'

/** Saldos da Binance com o aportado calculado do histórico (só quando o dono pede) ou informado à mão, que sempre vale. */
export function Cripto({ rows, onOpenSettings }: { rows: CryptoRow[]; onOpenSettings(at?: SectionId): void }) {
  const { db, data, reload, binance, refreshQuotesNow } = useData()
  const [editing, setEditing] = useState<{ asset: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fetchedAt = data.cryptoBalances[0]?.fetchedAt
  const bal = new Map(data.cryptoBalances.map(c => [c.asset, c]))
  const computed = rows.some(c => c.costCents !== null && !bal.get(c.asset)?.costManual)
  if (!data.cryptoBalances.some(c => c.qty > 0) && !binance.error) return null

  const saveCost = async () => {
    if (!editing) return
    try {
      await setCryptoCost(db, editing.asset, editing.text.trim() ? parseMoney(editing.text, 'Aportado', false) : null)
      setEditing(null); setError(null); await reload()
    } catch (e) { setError(errText(e)) }
  }

  return (
    <>
      <div className="pos-sub">
        <span className="muted">Binance{fetchedAt && ` · saldo de ${when(fetchedAt)}`}</span>
        <button className="link" disabled={binance.syncing} onClick={() => void binance.syncNow().then(refreshQuotesNow)}>{binance.syncing ? 'lendo…' : '↻ atualizar'}</button>
        <button className="link" disabled={binance.cost.loading} onClick={() => void binance.fetchCost()}>{binance.cost.loading ? 'lendo histórico…' : 'Buscar aportado na Binance'}</button>
      </div>
      {binance.cost.loading && <div className="muted" role="status" style={{ margin: '6px 0' }}>Lendo o histórico da Binance (leva alguns minutos): {binance.cost.progress ?? 'começando…'}</div>}
      {binance.error && <div className="note" style={{ margin: '6px 0' }}>{binance.error} <button className="link" onClick={() => onOpenSettings('contas')}>Configurações</button></div>}
      {binance.earnSkipped && <div className="muted" style={{ margin: '6px 0' }}>Saldos do Earn não lidos: a chave não tem acesso a eles.</div>}
      {binance.cost.note && <div className="note" style={{ margin: '6px 0' }}>{binance.cost.note}</div>}
      {computed && <div className="muted" style={{ margin: '6px 0' }}>Aportado (Binance): custo médio do histórico; o pago em dólar digital (USDT e afins) usa o dólar do fechamento do mês.</div>}
      {error && <div className="note" style={{ margin: '6px 0' }}>{error}</div>}
      {rows.map(c => {
        const gain = c.valueCents !== null && c.costCents !== null ? c.valueCents - c.costCents : null
        return (
          <PosRow key={c.asset} cls="cripto" avatar={c.asset} name={c.asset} detail={`${qtyText(c.qty)} ${c.asset}`}
            value={c.valueCents === null ? <span className="t2">sem cotação</span> : formatCents(c.valueCents)}
            gain={gain === null ? '—' : signedCents(gain)} gainSub={gain !== null && c.costCents ? pct(gain / c.costCents) : null} gainTone={tone(gain)}
            cost={editing?.asset === c.asset ? (
              <span><input className="in" style={{ width: 90 }} autoFocus inputMode="decimal" placeholder="0,00" aria-label={`Aportado em ${c.asset}`} value={editing.text}
                onChange={e => setEditing({ ...editing, text: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') void saveCost(); if (e.key === 'Escape') setEditing(null) }} />
                {' '}<button className="link" onClick={() => void saveCost()}>salvar</button></span>
            ) : <span><button className="link" onClick={() => setEditing({ asset: c.asset, text: c.costCents === null ? '' : editCents(c.costCents) })}>
                {c.costCents === null ? 'informar aportado' : `aportado (${bal.get(c.asset)?.costManual ? 'à mão' : 'Binance'}) ${formatCents(c.costCents)}`}</button>
                {c.costCents !== null && bal.get(c.asset)?.costPartial ? <> <span className="tag" title={PARTIAL} aria-label={`parcial: ${PARTIAL}`}>parcial</span></> : null}</span>} />
        )
      })}
    </>
  )
}
