import { useState } from 'react'
import { formatCents } from '../../domain/money'
import type { RfHolding } from '../../domain/rendaFixa'

const br = (iso: string) => iso.split('-').reverse().join('/')
const sign = (c: number, s: string) => (c > 0 ? `+${s}` : c < 0 ? `−${s.replace('-', '')}` : s)
const tone = (c: number | null) => (c === null || c === 0 ? '' : c > 0 ? 'up' : 'dn')
const pct = (p: number) => sign(p, `${(p * 100).toFixed(1).replace('.', ',')}%`)

/** Títulos da B3 (Tesouro e CDB/LCI…): aplicado, valor de hoje e rendimento; os encerrados ficam recolhidos. */
export function RendaFixa({ list, onOpenSettings }: { list: RfHolding[]; onOpenSettings(): void }) {
  const [showClosed, setShowClosed] = useState(false)
  const open = list.filter(h => !h.closed)
  const closed = list.filter(h => h.closed)
  const row = (h: RfHolding) => {
    const sub = [h.issuer ?? (/^tesouro/i.test(h.name) ? 'Tesouro Nacional' : null), h.indexer, h.maturity && `vence ${br(h.maturity)}`].filter(Boolean).join(' · ')
    return (
      <tr key={h.key}>
        <td><div>{h.name}</div>{sub && <div className="t2">{sub}</div>}</td>
        <td className="r">{h.closed ? '—' : h.appliedCents === null ? <span className="t2">desconhecido</span> : formatCents(h.appliedCents)}</td>
        <td className="r">{h.closed ? (h.gainCents === null ? '—' : <span className="t2">recebido {formatCents(h.receivedCents)}</span>) : h.valueCents === null ? '—' : formatCents(h.valueCents)}</td>
        <td className={`r ${tone(h.gainCents)}`}>{h.gainCents === null ? <span className="t2">{h.closed ? 'sem valor de resgate na B3' : '—'}</span> : <>{sign(h.gainCents, formatCents(h.gainCents))}{h.gainPct !== null && <div className="t2">{pct(h.gainPct)}</div>}</>}</td>
        <td className="t2">{h.needsNewerPosicao ? <span className="tag">importe uma Posição mais recente</span> : h.asOf ? `valor de ${br(h.asOf).slice(0, 5)}` : ''}</td>
      </tr>
    )
  }
  return (
    <>
      <h5>Renda fixa <span className="muted">· Tesouro e títulos da B3, pela Posição e pela Movimentação</span></h5>
      {list.length === 0 ? (
        <div className="muted" style={{ marginBottom: 14 }}>Nenhum título ainda. Importe a <b>Posição</b> e a <b>Movimentação</b> da Área do Investidor em <button className="link" onClick={onOpenSettings}>Configurações › B3</button>.</div>
      ) : (
        <div className="table-scroll" role="region" aria-label="Renda fixa" tabIndex={0} style={{ marginBottom: 14 }}><table>
          <thead><tr><th>Título</th><th className="r">Aplicado</th><th className="r">Valor de hoje</th><th className="r">Rendimento</th><th /></tr></thead>
          <tbody>
            {open.map(row)}
            {closed.length > 0 && (
              <tr className="cls"><td colSpan={5}><button className="link" aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>{showClosed ? 'esconder encerrados' : `ver encerrados (${closed.length})`}</button></td></tr>
            )}
            {showClosed && closed.map(row)}
          </tbody>
        </table></div>
      )}
    </>
  )
}
