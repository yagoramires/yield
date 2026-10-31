import { Landmark, Pencil } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { saveBroker, saveIssuer, type Broker, type Issuer } from '../../db/irRepo'
import { useData } from '../../state/DataProvider'
import { errText } from '../lancamentos/GastosHeader'
import { classColor } from '../resumoInvestimentos/build'
import { ico, TINT } from '../../ui/palette'

type Edit = { kind: 'issuer' | 'broker'; key: string; name: string; cnpj: string }

/** Empresas (por ticker) e corretoras (pelo nome das notas), com as pendências do ano primeiro. */
export function Cadastro({ issuers, brokers, tickers, brokerCodes, pending, onChanged }: {
  issuers: Map<string, Issuer>; brokers: Map<string, Broker>; tickers: { ticker: string; cls: string }[]; brokerCodes: string[]
  pending: { tickers: string[]; brokers: string[] }; onChanged(): Promise<void>
}) {
  const { db } = useData()
  const [edit, setEdit] = useState<Edit | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!edit) return
    setBusy(true)
    try {
      if (edit.kind === 'issuer') await saveIssuer(db, { ticker: edit.key, name: edit.name, cnpj: edit.cnpj })
      else await saveBroker(db, { code: edit.key, name: edit.name, cnpj: edit.cnpj })
      await onChanged(); setEdit(null); setError(null)
    } catch (e) { setError(errText(e)) }
    setBusy(false)
  }

  const order = (keys: string[], missing: string[]) => [...new Set([...missing, ...keys])]
  const form = (e: Edit) => (
    <div className="cad-form">
      <input className="in" aria-label="Razão social" placeholder="Razão social" autoFocus value={e.name} onChange={x => setEdit({ ...e, name: x.target.value })} />
      <input className="in" aria-label="CNPJ" placeholder="CNPJ" value={e.cnpj} onChange={x => setEdit({ ...e, cnpj: x.target.value })} onKeyDown={x => x.key === 'Enter' && void save()} />
      <span className="btns"><button className="b" disabled={busy} onClick={() => { setEdit(null); setError(null) }}>Cancelar</button><button className="b pri" disabled={busy} onClick={() => void save()}>Salvar</button></span>
      {error && <div className="note">{error}</div>}
    </div>
  )

  const row = (kind: Edit['kind'], key: string, current: Issuer | Broker | undefined, avatar: ReactNode, missing: boolean) => (
    <div key={key} className={`srow ${edit?.kind === kind && edit.key === key ? 'editing' : ''}`}>
      {avatar}
      <div className="lmid">
        {edit?.kind === kind && edit.key === key ? <><div className="sname"><b>{key}</b></div>{form(edit)}</> : <>
          <div className="lname">{current?.name ?? key}</div>
          <div className="lsub">{kind === 'issuer' || current ? <span>{key}</span> : null}{current ? <span>· {current.cnpj}</span> : <span className={missing ? 'warn-text' : ''}>{kind === 'issuer' ? '· ' : ''}sem CNPJ cadastrado</span>}</div>
        </>}
      </div>
      {!(edit?.kind === kind && edit.key === key) && (
        <button className="icon-btn sq" aria-label={`Editar ${key}`} onClick={() => { setEdit({ kind, key, name: current?.name ?? '', cnpj: current?.cnpj ?? '' }); setError(null) }}><Pencil size={12} aria-hidden /></button>
      )}
    </div>
  )

  const cls = new Map(tickers.map(t => [t.ticker, t.cls]))
  return (
    <>
      {error && !edit && <div className="note" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="decl-cols">
        <div className="day-card">
          <div className="day-h"><span>Empresas e fundos</span></div>
          {order(tickers.map(t => t.ticker), pending.tickers).map(t => row('issuer', t, issuers.get(t),
            <span className="tk-av" style={ico(classColor(cls.get(t) ?? ''))} aria-hidden>{t.slice(0, 4)}</span>, pending.tickers.includes(t)))}
          <div className="muted cad-hint">Preenchido ao importar a Posição da B3 em Configurações › Importar arquivos (razão social e CNPJ de ações, ETFs e fundos). O que você editar aqui não é sobrescrito.</div>
        </div>
        <div className="day-card">
          <div className="day-h"><span>Corretoras</span><span className="muted">nomes como vêm das notas e da B3</span></div>
          {brokerCodes.length === 0 ? <div className="srow muted">Nenhuma corretora nas notas ainda.</div>
            : order(brokerCodes, pending.brokers).map(c => row('broker', c, brokers.get(c), <span className="cat-ico" style={{ width: 30, height: 30, ...ico(TINT.cinza) }} aria-hidden><Landmark size={14} /></span>, pending.brokers.includes(c)))}
        </div>
      </div>
    </>
  )
}
