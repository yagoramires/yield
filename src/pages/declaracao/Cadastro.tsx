import { Landmark, Pencil, Upload } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { importCadastro, saveBroker, saveIssuer, type Broker, type Issuer } from '../../db/irRepo'
import { parseCadastroPlanilha } from '../../import/cadastroPlanilha'
import { useData } from '../../state/DataProvider'
import { errText } from '../lancamentos/GastosHeader'
import { classColor } from '../resumoInvestimentos/build'

type Edit = { kind: 'issuer' | 'broker'; key: string; name: string; cnpj: string }

/** Empresas (por ticker) e corretoras (pelo nome das notas), com as pendências do ano primeiro. */
export function Cadastro({ issuers, brokers, tickers, brokerCodes, pending, onChanged }: {
  issuers: Map<string, Issuer>; brokers: Map<string, Broker>; tickers: { ticker: string; cls: string }[]; brokerCodes: string[]
  pending: { tickers: string[]; brokers: string[] }; onChanged(): Promise<void>
}) {
  const { db } = useData()
  const input = useRef<HTMLInputElement>(null)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

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

  const importFile = async (f: File) => {
    setBusy(true); setMsg(null); setError(null)
    try {
      const p = parseCadastroPlanilha(await f.arrayBuffer(), brokerCodes)
      const r = await importCadastro(db, p)
      await onChanged()
      setMsg([`${r.issuers} ${r.issuers === 1 ? 'empresa importada' : 'empresas importadas'}`, `${r.brokers} ${r.brokers === 1 ? 'corretora' : 'corretoras'}`, `${r.skipped} já existiam`,
        ...(p.unknownBrokers ? [`${p.unknownBrokers} ${p.unknownBrokers === 1 ? 'corretora não reconhecida' : 'corretoras não reconhecidas'}`] : []),
        ...(p.invalid ? [`${p.invalid} com CNPJ inválido`] : [])].join(' · '))
    } catch (e) { setError(`Não foi possível ler ${f.name}: ${errText(e)}`) }
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
      {msg && <div className="info" style={{ marginBottom: 10 }}>{msg}</div>}
      {error && !edit && <div className="note" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="decl-cols">
        <div className="day-card">
          <div className="day-h"><span>Empresas e fundos</span>
            <button className="b with-ico" disabled={busy} onClick={() => input.current?.click()}><Upload size={13} aria-hidden />Importar da planilha</button>
            <input ref={input} type="file" accept=".xlsx,.xlsm" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />
          </div>
          {order(tickers.map(t => t.ticker), pending.tickers).map(t => row('issuer', t, issuers.get(t),
            <span className="tk-av" style={{ background: `${classColor(cls.get(t) ?? '')}22`, color: classColor(cls.get(t) ?? '') }} aria-hidden>{t.slice(0, 4)}</span>, pending.tickers.includes(t)))}
          <div className="muted cad-hint">A planilha antiga tem a aba “Empresas Listadas”: importar só acrescenta quem ainda não está aqui.</div>
        </div>
        <div className="day-card">
          <div className="day-h"><span>Corretoras</span><span className="muted">nomes como vêm das notas e da B3</span></div>
          {brokerCodes.length === 0 ? <div className="srow muted">Nenhuma corretora nas notas ainda.</div>
            : order(brokerCodes, pending.brokers).map(c => row('broker', c, brokers.get(c), <span className="cat-ico" style={{ width: 30, height: 30, color: '#9a9da6', background: '#9a9da622' }} aria-hidden><Landmark size={14} /></span>, pending.brokers.includes(c)))}
        </div>
      </div>
    </>
  )
}
