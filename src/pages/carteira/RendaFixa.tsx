import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { formatCents } from '../../domain/money'
import type { RfHolding } from '../../domain/rendaFixa'
import { br, pct, signedCents, tone } from './fmt'
import { PosRow } from './PosRow'
import type { SectionId } from '../configuracoes/secoes'

/** Títulos da B3 (Tesouro e CDB/LCI…): aplicado, valor de hoje e rendimento; os encerrados ficam recolhidos. */
export function RendaFixa({ list, onOpenSettings }: { list: RfHolding[]; onOpenSettings(at?: SectionId): void }) {
  const [showClosed, setShowClosed] = useState(false)
  const open = list.filter(h => !h.closed)
  const closed = list.filter(h => h.closed)
  const row = (h: RfHolding) => (
    <PosRow key={h.key} cls="renda_fixa" avatar={/^tesouro/i.test(h.name) ? 'TD' : h.name.split(' ')[0]} name={h.name}
      detail={[h.issuer ?? (/^tesouro/i.test(h.name) ? 'Tesouro Nacional' : null), h.indexer, h.maturity && `vence ${br(h.maturity)}`].filter(Boolean).join(' · ')}
      value={h.closed ? (h.gainCents === null ? '—' : `recebido ${formatCents(h.receivedCents)}`) : h.valueCents === null ? '—' : formatCents(h.valueCents)}
      valueSub={h.needsNewerPosicao ? <span className="tag">importe uma Posição mais recente</span> : h.asOf && `valor de ${br(h.asOf).slice(0, 5)}`}
      gain={h.gainCents === null ? <span className="t2">{h.closed ? 'sem valor de resgate na B3' : '—'}</span> : signedCents(h.gainCents)}
      gainSub={h.gainPct !== null && pct(h.gainPct)} gainTone={tone(h.gainCents)}
      cost={h.closed ? 'encerrado' : h.appliedCents === null ? 'aplicado desconhecido' : `aplicado ${formatCents(h.appliedCents)}`} />
  )
  if (!list.length) return <div className="muted pos-empty">Nenhum título da B3 ainda. Importe a <b>Posição</b> e a <b>Movimentação</b> da Área do Investidor em <button className="link" onClick={() => onOpenSettings('importar')}>Configurações › Importar arquivos</button>.</div>
  return (
    <>
      {open.map(row)}
      {closed.length > 0 && <button className="link pos-more" aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}><ChevronRight size={13} className="chev" aria-hidden />{showClosed ? 'Esconder encerrados' : `Ver encerrados (${closed.length})`}</button>}
      {showClosed && closed.map(row)}
    </>
  )
}
