import { useState } from 'react'
import { setCryptoCost } from '../../db/rendaFixaRepo'
import { formatCents } from '../../domain/money'
import type { CryptoRow } from '../../domain/portfolio'
import { useData } from '../../state/DataProvider'
import { errText } from '../lancamentos/GastosHeader'
import { parseMoney } from '../notas/build'

const sign = (c: number, s: string) => (c > 0 ? `+${s}` : c < 0 ? `−${s.replace('-', '')}` : s)
const tone = (c: number) => (c === 0 ? '' : c > 0 ? 'up' : 'dn')
const when = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Saldos da Binance com o aportado que o dono informa (a API não diz quanto ele pagou). */
export function Cripto({ rows, onOpenSettings }: { rows: CryptoRow[]; onOpenSettings(): void }) {
  const { db, data, reload, binance, refreshQuotesNow } = useData()
  const [editing, setEditing] = useState<{ asset: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fetchedAt = data.cryptoBalances[0]?.fetchedAt
  if (!data.cryptoBalances.length && !binance.error) return null

  const saveCost = async () => {
    if (!editing) return
    try {
      await setCryptoCost(db, editing.asset, editing.text.trim() ? parseMoney(editing.text, 'Aportado', false) : null)
      setEditing(null); setError(null); await reload()
    } catch (e) { setError(errText(e)) }
  }

  return (
    <>
      <div className="bar" style={{ marginTop: 4 }}>
        <h5>Cripto <span className="muted">· Binance{fetchedAt && `, saldo de ${when(fetchedAt)}`}</span></h5>
        <button className="b ghost" disabled={binance.syncing} onClick={() => void binance.syncNow().then(refreshQuotesNow)}>{binance.syncing ? 'Lendo…' : '↻ Atualizar'}</button>
      </div>
      {binance.error && <div className="note" style={{ marginBottom: 8 }}>{binance.error} <button className="link" onClick={onOpenSettings}>Configurações</button></div>}
      {binance.earnSkipped && <div className="muted" style={{ marginBottom: 8 }}>Saldos do Earn não lidos: a chave não tem acesso a eles.</div>}
      {error && <div className="note" style={{ marginBottom: 8 }}>{error}</div>}
      {rows.length > 0 && (
        <div className="table-scroll" role="region" aria-label="Cripto" tabIndex={0} style={{ marginBottom: 14 }}><table>
          <thead><tr><th>Moeda</th><th className="r">Quantidade</th><th className="r">Valor de hoje</th><th className="r">Aportado</th><th className="r">Rendimento</th></tr></thead>
          <tbody>
            {rows.map(c => {
              const gain = c.valueCents !== null && c.costCents !== null ? c.valueCents - c.costCents : null
              return (
                <tr key={c.asset}>
                  <td>{c.asset}</td>
                  <td className="r">{c.qty.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}</td>
                  <td className="r">{c.valueCents === null ? <span className="t2">sem cotação</span> : formatCents(c.valueCents)}</td>
                  <td className="r">{editing?.asset === c.asset ? (
                    <span><input className="in" style={{ width: 100 }} autoFocus inputMode="decimal" placeholder="0,00" aria-label={`Aportado em ${c.asset}`} value={editing.text}
                      onChange={e => setEditing({ ...editing, text: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') void saveCost(); if (e.key === 'Escape') setEditing(null) }} />
                      {' '}<button className="link" onClick={() => void saveCost()}>salvar</button></span>
                  ) : <button className="link" onClick={() => setEditing({ asset: c.asset, text: c.costCents === null ? '' : formatCents(c.costCents) })}>{c.costCents === null ? 'informar' : formatCents(c.costCents)}</button>}</td>
                  <td className={`r ${gain === null ? '' : tone(gain)}`}>{gain === null ? '—' : <>{sign(gain, formatCents(gain))}{c.costCents ? <div className="t2">{sign(gain, `${((gain / c.costCents) * 100).toFixed(1).replace('.', ',')}%`)}</div> : null}</>}</td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      )}
    </>
  )
}
