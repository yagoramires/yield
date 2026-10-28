import type { ReactNode } from 'react'
import { classColor } from '../resumoInvestimentos/build'

/** Linha de posição igual para toda classe: avatar, nome + detalhe, valor de hoje, resultado e custo (com as ações embaixo). */
export function PosRow({ cls, avatar, name, detail, value, valueSub, gain, gainSub, gainTone = '', cost, actions }: {
  cls: string; avatar: string; name: ReactNode; detail?: ReactNode; value: ReactNode; valueSub?: ReactNode
  gain: ReactNode; gainSub?: ReactNode; gainTone?: string; cost?: ReactNode; actions?: ReactNode
}) {
  const color = classColor(cls)
  return (
    <div className="pos-row">
      <span className="tk-av" style={{ background: `${color}22`, color }} aria-hidden>{avatar.slice(0, 4).toUpperCase()}</span>
      <span className="pos-n"><span className="pos-name">{name}</span>{detail && <span className="t2">{detail}</span>}</span>
      <span className="r">{value}{valueSub && <small className="t2">{valueSub}</small>}</span>
      <span className={`r ${gainTone}`}>{gain}{gainSub && <small>{gainSub}</small>}</span>
      <span className="r t2 pos-cost">{cost}{actions && <span className="pos-act">{actions}</span>}</span>
    </div>
  )
}
