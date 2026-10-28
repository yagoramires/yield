import { ChevronLeft, ChevronRight, CircleAlert, Coins, Landmark, ReceiptText, Wallet } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadCadastro, type Broker, type Issuer } from '../db/irRepo'
import { BEM_CODES, bensDoAno, discriminacao, discriminacaoRf, LOCALIZACAO, lucroIsentoDoAno, pendencias, RF_CODES, rendaFixaDoAno, rendaVariavelDoAno, rendimentosDoAno, rendimentosRfDoAno, type Bem, type TipoRf } from '../domain/declaracao'
import { rfInstitution } from '../domain/rendaFixa'
import { normalizeBroker } from '../import/parse'
import { formatBRL, formatCents } from '../domain/money'
import type { AssetType } from '../domain/types'
import { todayISO, useData } from '../state/DataProvider'
import { Cadastro } from './declaracao/Cadastro'
import { CopyButton } from './declaracao/Copy'
import { RendaVariavel, Rendimentos } from './declaracao/Rendimentos'
import { errText } from './lancamentos/GastosHeader'
import { classColor } from './resumoInvestimentos/build'

type Tab = 'bens' | 'rendimentos' | 'rv' | 'cadastro'
const CLASSES: AssetType[] = ['Ação', 'FII', 'ETF', 'BDR', 'ETF RF']
const money = (c: number) => formatCents(c)

const Avatar = ({ b, size = 32 }: { b: Bem; size?: number }) => (
  <span className="tk-av" style={{ width: size, height: size, background: `${classColor(b.assetType)}22`, color: classColor(b.assetType) }} aria-hidden>{b.ticker.slice(0, 4)}</span>
)

export function Declaracao() {
  const { db, data, derived } = useData()
  const thisYear = Number(todayISO().slice(0, 4))
  const firstYear = Math.min(thisYear - 1, ...data.trades.map(t => Number(t.settleDate.slice(0, 4))), ...data.rfMoves.map(m => Number(m.date.slice(0, 4))))
  const [year, setYear] = useState(thisYear - 1)
  const [tab, setTab] = useState<Tab>('bens')
  const [picked, setPicked] = useState<string | null>(null)
  const [cad, setCad] = useState<{ issuers: Issuer[]; brokers: Broker[] }>({ issuers: [], brokers: [] })
  const [error, setError] = useState<string | null>(null)

  const reloadCad = useCallback(async () => { setCad(await loadCadastro(db)) }, [db])
  useEffect(() => { reloadCad().catch(e => setError(`Não foi possível ler o cadastro: ${errText(e)}`)) }, [reloadCad])

  const issuers = new Map(cad.issuers.map(i => [i.ticker, i]))
  const brokers = new Map(cad.brokers.map(b => [b.code, b]))
  // dois replays por ano: só refaz quando os dados ou o ano mudam, não a cada clique
  const bens = useMemo(() => bensDoAno(data.trades, data.events, year), [data.trades, data.events, year])
  const issuerOf = (b: Bem) => issuers.get(b.ticker) ?? b.oldTickers.map(t => issuers.get(t)).find(Boolean)
  const types = useMemo(() => new Map(data.trades.map(t => [t.ticker, t.assetType])), [data.trades])
  // provento pago com o ticker antigo de uma mudança de ticker acha a empresa pelo ticker novo
  const issuersRend = new Map([...issuers, ...bens.flatMap(b => { const i = issuerOf(b); return i ? b.oldTickers.map(o => [o, i] as const) : [] })])
  const rendimentos = rendimentosDoAno(data.dividends, year, issuersRend, t => types.get(t))
  const rf = useMemo(() => rendaFixaDoAno(data.rfMoves, data.rfPositions, year), [data.rfMoves, data.rfPositions, year])
  const rendimentosRf = rendimentosRfDoAno(data.rfMoves, data.rfPositions, year)
  const isento20 = lucroIsentoDoAno(derived.tax, year)
  const rv = rendaVariavelDoAno(derived.tax, data.payments, year)
  // o CNPJ também é achado pelo ticker antigo de uma mudança de ticker
  const issuersEff = new Map([...issuers, ...bens.flatMap(b => { const i = issuerOf(b); return i ? [[b.ticker, i] as const] : [] })])
  const pend = pendencias(bens, rendimentos, issuersEff, brokers)
  const pendCount = pend.tickers.length + pend.brokers.length

  const total = bens.reduce((s, b) => s + b.costCents, 0) + rf.reduce((s, b) => s + b.appliedCents, 0)
  const totalPrev = bens.reduce((s, b) => s + b.costPrevCents, 0) + rf.reduce((s, b) => s + b.appliedPrevCents, 0)
  const isentos = [...rendimentos, ...rendimentosRf].filter(r => r.linha === '09' || r.linha === '26' || r.linha === '12').reduce((s, r) => s + r.cents, 0) + isento20
  const exclusiva = [...rendimentos, ...rendimentosRf].filter(r => r.linha === '10' || r.linha === '06')
  const darf = [...rv.comum, ...rv.fii].reduce((s, l) => s + l.darfPaidCents, 0)
  const sel = bens.find(b => b.ticker === picked) ?? bens[0]
  const cadTickers = useMemo(() => [...new Set([...data.trades.map(t => t.ticker), ...data.dividends.map(d => d.ticker)])].sort().map(ticker => ({ ticker, cls: types.get(ticker) ?? '' })), [data.trades, data.dividends, types])

  const todas = bens.map(b => `${b.ticker} (${BEM_CODES[b.assetType].grupo}/${BEM_CODES[b.assetType].codigo})\n${discriminacao(b, year, issuerOf(b), brokers)}`).join('\n\n')
  const tabs: [Tab, string][] = [['bens', 'Bens e Direitos'], ['rendimentos', 'Rendimentos'], ['rv', 'Renda variável'], ['cadastro', 'Cadastro']]

  return (
    <>
      <div className="bar">
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <h1 style={{ margin: 0 }}>Declaração de IR</h1>
          <button className="icon-btn" aria-label="Ano anterior" disabled={year <= firstYear} onClick={() => { setYear(year - 1); setPicked(null) }}><ChevronLeft size={14} aria-hidden /></button>
          <b style={{ color: '#fff', fontSize: 13 }}>Ano-calendário {year}</b>
          <button className="icon-btn" aria-label="Próximo ano" disabled={year >= thisYear} onClick={() => { setYear(year + 1); setPicked(null) }}><ChevronRight size={14} aria-hidden /></button>
          <span className="muted">declaração entregue em {year + 1}</span>
        </div>
        {bens.length > 0 && <CopyButton text={todas} label="Copiar todas as discriminações" what="todas as discriminações" />}
      </div>

      <div className="kpis">
        <div className="k"><div className="muted k-l"><Wallet size={12} aria-hidden />Bens em 31/12/{year}</div><div className="v">{formatBRL(total)}</div>
          <div className="s muted">{bens.filter(b => b.qty > 0).length + rf.filter(b => b.qty > 0).length} ativos · era {formatBRL(totalPrev)} em {year - 1}</div></div>
        <div className="k"><div className="muted k-l"><Coins size={12} aria-hidden />Rendimentos isentos</div><div className="v">{formatBRL(isentos)}</div>
          <div className="s muted">dividendos, FII, LCI/LCA e vendas até R$ 20 mil</div></div>
        <div className="k"><div className="muted k-l"><ReceiptText size={12} aria-hidden />Tributação exclusiva</div><div className="v">{formatBRL(exclusiva.reduce((s, r) => s + r.cents, 0))}</div>
          <div className="s muted">JCP e juros de renda fixa · {exclusiva.length} {exclusiva.length === 1 ? 'pagadora' : 'pagadoras'}</div></div>
        <div className="k"><div className="muted k-l"><Landmark size={12} aria-hidden />DARF pago do ano</div><div className="v">{formatBRL(darf)}</div>
          <div className="s muted">renda variável, pelo mês da operação</div></div>
      </div>

      <div className="info" style={{ marginBottom: 10 }}>
        <b>O que entra aqui:</b> ações, FIIs, ETFs e BDRs na B3, e a renda fixa custodiada na B3 (Tesouro Direto, CDB, LCI/LCA, CRI/CRA, debêntures).{' '}
        <b>O que fica de fora:</b> conta corrente e poupança, renda fixa fora da B3 (CDB direto no banco, por exemplo), investimentos no exterior, cripto e previdência (PGBL/VGBL).
        Para esses, use o informe de rendimentos de cada instituição.
      </div>
      {error && <div className="note" style={{ marginBottom: 10 }}>{error}</div>}
      {pendCount > 0 && tab !== 'cadastro' && (
        <div className="sem-alert"><CircleAlert size={15} aria-hidden />
          <span>{[pend.tickers.length && `Falta o CNPJ de ${pend.tickers.length === 1 ? '1 ativo' : `${pend.tickers.length} ativos`} (${pend.tickers.slice(0, 4).join(', ')}${pend.tickers.length > 4 ? '…' : ''})`, pend.brokers.length && `${pend.brokers.length === 1 ? '1 corretora' : `${pend.brokers.length} corretoras`} sem cadastro`].filter(Boolean).join(' e ')} — a discriminação sai incompleta</span>
          <button className="link" onClick={() => setTab('cadastro')}>Completar cadastro</button>
        </div>
      )}

      <div className="seg decl-tabs" role="tablist" aria-label="Partes da declaração">
        {tabs.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}{t === 'cadastro' && pendCount > 0 && <i className="seg-n">{pendCount}</i>}</button>)}
      </div>

      {tab === 'bens' && (bens.length === 0 && rf.length === 0 ? <div className="info">Nenhum ativo em bolsa em 31/12/{year - 1} nem em 31/12/{year}.</div> : (
        <div className="decl-cols picking">
          <div>
            {CLASSES.map(c => {
              const list = bens.filter(b => b.assetType === c)
              if (!list.length) return null
              return (
                <div key={c} className="day-card">
                  <div className="day-h"><span>{BEM_CODES[c].classe} · Grupo {BEM_CODES[c].grupo} · Código {BEM_CODES[c].codigo}</span><span>R$ {money(list.reduce((s, b) => s + b.costCents, 0))}</span></div>
                  {list.map(b => {
                    const i = issuerOf(b)
                    return (
                      <button key={b.ticker} className={`srow bem-row ${sel?.ticker === b.ticker ? 'picked' : ''}`} onClick={() => setPicked(b.ticker)}>
                        <Avatar b={b} />
                        <span className="lmid"><span className="lname">{b.ticker}{b.oldTickers.length > 0 && <span className="muted"> (antes {b.oldTickers.join(', ')})</span>}</span>
                          <span className="lsub">{i ? <span>{i.name}</span> : <span className="warn-text">CNPJ não cadastrado</span>}<span>· {b.qty > 0 ? `${String(b.qty).replace('.', ',')} ${c === 'Ação' ? 'ações' : 'cotas'}` : `vendida em ${year}`}</span></span></span>
                        <span className="sum-val">{money(b.costCents)}<small>era {money(b.costPrevCents)}</small></span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
            {(Object.keys(RF_CODES) as TipoRf[]).map(t => {
              const list = rf.filter(b => b.tipo === t)
              if (!list.length) return null
              return (
                <div key={t} className="day-card">
                  <div className="day-h"><span>{RF_CODES[t].classe} · Grupo {RF_CODES[t].grupo} · Código {RF_CODES[t].codigo}</span><span>R$ {money(list.reduce((s, b) => s + b.appliedCents, 0))}</span></div>
                  {list.map(b => (
                    <div key={b.key} className="srow bem-row">
                      <span className="lmid"><span className="lname">{b.name}</span>
                        <span className="lsub"><span>{b.qty > 0 ? `${String(Math.round(b.qty * 100) / 100).replace('.', ',')} títulos` : `resgatado em ${year}`}</span>{b.partial && <span className="warn-text">· faltam compras antigas na Movimentação: confira o aplicado</span>}</span></span>
                      <span className="sum-val">{money(b.appliedCents)}<small>era {money(b.appliedPrevCents)}</small></span>
                      <CopyButton text={discriminacaoRf(b, year, brokers)} label="Discriminação" what={`discriminação de ${b.name}`} small />
                    </div>
                  ))}
                </div>
              )
            })}
            {rf.length > 0 && <div className="muted" style={{ marginBottom: 10 }}>
              Renda fixa pelo valor aplicado ainda em aberto em 31/12 (custo de aquisição), só pelo que a Movimentação da B3 mostra. Localização {LOCALIZACAO}.
              CNPJ: o do emissor ou da instituição, como no informe de rendimentos; no Tesouro Direto pode ficar em branco.
              Debênture incentivada é isenta e vai no código 03 (isentos). Confira grupo e código no programa da Receita.
            </div>}
          </div>
          {sel && (() => {
            const i = issuerOf(sel)
            const text = discriminacao(sel, year, i, brokers)
            const fields: [string, string][] = [['Grupo / Código', BEM_CODES[sel.assetType].label], ['Localização', LOCALIZACAO], ['CNPJ', i?.cnpj ?? 'não cadastrado'], ['Código de negociação', sel.ticker], [`Situação 31/12/${year - 1}`, money(sel.costPrevCents)], [`Situação 31/12/${year}`, money(sel.costCents)]]
            return (
              <div className="side-card decl-panel">
                <div className="side-h"><span className="row" style={{ alignItems: 'center', gap: 8 }}><Avatar b={sel} size={26} /><b>{sel.ticker}</b></span><span className="muted">copie campo a campo</span></div>
                {fields.map(([k, v]) => (
                  <div key={k} className="copy-field"><span className="cf-k">{k}</span><span className={`cf-v ${v === 'não cadastrado' ? 'warn-text' : ''}`}>{v}</span>{v !== 'não cadastrado' && <CopyButton text={v} what={k} />}</div>
                ))}
                <div className="disc-box">{text}</div>
                <div className="panel-foot"><span className="muted">custo médio, não valor de mercado</span><CopyButton text={text} label="Copiar discriminação" what="discriminação" primary /></div>
              </div>
            )
          })()}
        </div>
      ))}

      {tab === 'rendimentos' && <Rendimentos rendimentos={[...rendimentos, ...rendimentosRf]} isento20={isento20} />}
      {tab === 'rv' && <RendaVariavel rv={rv} year={year} />}
      {tab === 'cadastro' && (
        <Cadastro issuers={issuers} brokers={brokers} pending={pend} onChanged={reloadCad}
          tickers={cadTickers}
          brokerCodes={[...new Set([...data.trades.map(t => t.broker), ...data.rfMoves.flatMap(m => rfInstitution(m) ?? []).map(normalizeBroker)])].sort()} />
      )}
    </>
  )
}
