import { useData } from '../../state/DataProvider'
import type { Account, GastosData } from '../../db/gastosRepo'
import { IconGlyph } from '../../ui/CategoryIcon'
import { useHideValues } from '../../ui/HideValues'
import { TINT } from '../../ui/palette'
import { localStamp } from '../../ui/SyncStatus'

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
const contasCents = (as: Account[]) => as.reduce((s, a) => s + (a.kind === 'conta' ? a.balanceCents ?? 0 : 0), 0)

// saldo como a Pluggy informou na última sincronização; conta importada por arquivo não tem saldo
// só contas de bancos ainda conectados: as de um banco removido ficam no banco de dados com o saldo antigo
export function liveAccounts(data: GastosData) {
  const live = data.accounts.filter(a => a.source !== 'pluggy' || data.pluggyItems.some(i => i.itemId === a.itemId))
  const contas = live.filter(a => a.kind === 'conta'), cartoes = live.filter(a => a.kind === 'cartao' && a.balanceCents != null)
  const withBal = contas.filter(a => a.balanceCents != null)
  return { contas, cartoes, withBal, totalCents: withBal.reduce((s, a) => s + (a.balanceCents ?? 0), 0) }
}

export function SaldoContas() {
  const { data } = useData().gastos
  const { brl } = useHideValues()
  const { contas, cartoes, withBal, totalCents } = liveAccounts(data)
  if (!withBal.length && !cartoes.length) return null
  const at = withBal.map(a => a.balanceAt).filter(Boolean).sort().at(-1)
  // um bloco por banco (pelo nome da instituição), o com mais dinheiro primeiro
  const byBank = new Map<string, Account[]>()
  for (const a of [...contas, ...cartoes]) byBank.set(a.institution, [...(byBank.get(a.institution) ?? []), a])
  const banks = [...byBank].sort(([, x], [, y]) => contasCents(y) - contasCents(x))

  const value = (a: Account) => {
    const cartao = a.kind === 'cartao'
    return <span className={`r${cartao ? ' t2' : (a.balanceCents ?? 0) < 0 ? ' dn' : ''}`}>{a.balanceCents == null ? <span className="muted">sem saldo</span> : brl(cartao ? -a.balanceCents : a.balanceCents)}</span>
  }
  const icon = (cartao: boolean) => <IconGlyph name={cartao ? 'credit-card' : 'landmark'} color={cartao ? TINT.cinza : TINT.azul} size={26} />
  const fatura = (a: Account) => (a.kind === 'cartao' ? ' · fatura em aberto' : '')

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="bar"><h5 style={{ margin: 0 }}>Saldo nas contas</h5><span className="muted">{at ? `atualizado ${localStamp(at)}` : ''}</span></div>
      <div className="bal-total">{brl(totalCents)}<span className="muted"> em {plural(withBal.length, 'conta', 'contas')}</span></div>
      <div className="bal-list">
        {banks.map(([bank, as]) => {
          if (as.length === 1) {
            const a = as[0]
            return <div key={bank} className="bal-group"><div className="bal-row">{icon(a.kind === 'cartao')}<span className="grow"><b>{bank}</b><small>{a.name}{fatura(a)}</small></span>{value(a)}</div></div>
          }
          const nContas = as.filter(a => a.kind === 'conta').length, nCartoes = as.length - nContas
          return (
            <div key={bank} className="bal-group">
              <div className="bal-row">{icon(!nContas)}
                <span className="grow"><b>{bank}</b><small>{[nContas && plural(nContas, 'conta', 'contas'), nCartoes && plural(nCartoes, 'cartão', 'cartões')].filter(Boolean).join(' · ')}</small></span>
                {nContas > 0 && <span className={`r${contasCents(as) < 0 ? ' dn' : ''}`}><b>{brl(contasCents(as))}</b></span>}
              </div>
              {as.map(a => <div key={a.id} className="bal-sub"><span className="grow" title={a.name}>{a.name}{fatura(a)}</span>{value(a)}</div>)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
