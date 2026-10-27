import { Building2, Sprout } from 'lucide-react'
import { RENDIMENTO_LABEL, type LinhaRendimento, type LinhaRV, type Rendimento } from '../../domain/declaracao'
import { formatCents } from '../../domain/money'
import { monthName } from '../lancamentos/GastosHeader'
import { CopyButton } from './Copy'

const money = (c: number) => formatCents(c)

function Grupo({ titulo, linhas }: { titulo: string; linhas: Rendimento[] }) {
  if (!linhas.length) return null
  return (
    <div className="day-card">
      <div className="day-h"><span>{titulo}</span><span>R$ {money(linhas.reduce((s, r) => s + r.cents, 0))}</span></div>
      {linhas.map(r => (
        <div key={r.payerKey} className="srow">
          <span className="cat-ico" style={{ width: 30, height: 30, color: '#5fb3ff', background: '#5fb3ff22' }} aria-hidden><Building2 size={14} /></span>
          <div className="lmid">
            <div className={`lname ${r.name ? '' : 'warn-text'}`}>{r.name ?? 'CNPJ não cadastrado'}</div>
            <div className="lsub">{r.cnpj && <span>{r.cnpj}</span>}<span>{r.cnpj ? '· ' : ''}{r.tickers.join(', ')}</span></div>
          </div>
          <div className="lval">{money(r.cents)}</div>
          {r.cnpj && <CopyButton text={r.cnpj} label="CNPJ" what={`CNPJ de ${r.name}`} small />}
          <CopyButton text={money(r.cents)} label="Valor" what={`valor de ${r.name ?? r.payerKey}`} small />
        </div>
      ))}
    </div>
  )
}

export function Rendimentos({ rendimentos, isento20 }: { rendimentos: Rendimento[]; isento20: number }) {
  const of = (l: LinhaRendimento) => rendimentos.filter(r => r.linha === l)
  const vazio = !rendimentos.length && !isento20
  if (vazio) return <div className="info">Nenhum provento nem lucro isento neste ano.</div>
  return (
    <div className="decl-cols">
      <div>
        <div className="sec-h"><span>Rendimentos isentos e não tributáveis</span></div>
        <Grupo titulo={`Isentos · ${RENDIMENTO_LABEL['09']}`} linhas={of('09')} />
        <Grupo titulo={`Isentos · ${RENDIMENTO_LABEL['26']}`} linhas={of('26')} />
        {isento20 > 0 && (
          <div className="day-card">
            <div className="day-h"><span>Isentos · 20 – Ganhos líquidos em ações (vendas até R$ 20 mil no mês)</span></div>
            <div className="srow">
              <span className="cat-ico" style={{ width: 30, height: 30, color: '#c6ff3d', background: '#c6ff3d22' }} aria-hidden><Sprout size={14} /></span>
              <div className="lmid"><div className="lname">Lucro isento no ano</div><div className="lsub">soma dos meses em que as vendas de ações ficaram até R$ 20 mil</div></div>
              <div className="lval">{money(isento20)}</div>
              <CopyButton text={money(isento20)} label="Valor" what="lucro isento" small />
            </div>
          </div>
        )}
      </div>
      <div>
        <div className="sec-h"><span>Rendimentos sujeitos à tributação exclusiva</span></div>
        {of('10').length ? <Grupo titulo={`Exclusiva · ${RENDIMENTO_LABEL['10']}`} linhas={of('10')} /> : <div className="muted">Nenhum JCP neste ano.</div>}
      </div>
    </div>
  )
}

function Tabela({ titulo, linhas, vazio }: { titulo: string; linhas: LinhaRV[]; vazio: string }) {
  return (
    <div className="day-card">
      <div className="day-h"><span>{titulo}</span><span>só meses com operação</span></div>
      {linhas.length === 0 ? <div className="srow muted">{vazio}</div> : (
        <div className="table-scroll" role="region" aria-label={titulo} tabIndex={0}>
          <table className="rv-table">
            <thead><tr><th>Mês</th><th className="r">Resultado</th><th className="r">Prejuízo a compensar</th><th className="r">IR na fonte</th><th className="r">Imposto a pagar</th><th className="r">DARF pago</th></tr></thead>
            <tbody>
              {linhas.map(l => (
                <tr key={l.month}>
                  <td>{monthName(l.month)}</td>
                  <td className={`r ${l.resultCents > 0 ? 'up' : l.resultCents < 0 ? 'dn' : ''}`}>{l.resultCents < 0 ? '−' : ''}{money(Math.abs(l.resultCents))}</td>
                  <td className="r">{money(Math.abs(l.lossInCents))}</td>
                  <td className="r">{money(l.irrfCents)}</td>
                  <td className="r">{money(l.taxPayableCents)}</td>
                  <td className="r">{money(l.darfPaidCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function RendaVariavel({ rv, year }: { rv: { comum: LinhaRV[]; fii: LinhaRV[] }; year: number }) {
  return (
    <>
      <Tabela titulo="Operações comuns (ações, ETFs e BDRs)" linhas={rv.comum} vazio={`Nenhuma venda de ações, ETFs ou BDRs em ${year}.`} />
      <Tabela titulo="Fundos imobiliários" linhas={rv.fii} vazio={`Nenhuma venda de FII em ${year}.`} />
      <div className="muted">Mesmos números da tela Imposto. Day trade não é separado pelo Yield.</div>
    </>
  )
}
