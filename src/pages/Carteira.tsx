import { useState } from 'react'
import { deleteManualAsset, deleteQuote, saveManualAsset, upsertQuote, type ManualAsset } from '../db/repo'
import { formatBRL, formatCents } from '../domain/money'
import type { Cents } from '../domain/types'
import type { PortfolioRow } from '../domain/portfolio'
import { AMBIGUOUS_MSG, parseDecimal } from '../import/parse'
import { yahooSymbol } from '../quotes/yahoo'
import { parseMoney } from './notas/build'
import { useData } from '../state/DataProvider'
import { Select } from '../ui/Select'
import { RendaFixa } from './carteira/RendaFixa'
import { Cripto } from './carteira/Cripto'

const CLASS_LABEL: Record<string, string> = { renda_fixa: 'Renda fixa', cripto: 'Cripto', dolar: 'Dólar', exterior: 'Exterior (US$)', outro: 'Outro' }
const label = (c: string) => CLASS_LABEL[c] ?? c
const sign = (c: number, s: string) => (c > 0 ? `+${s}` : c < 0 ? `−${s.replace('-', '')}` : s)
const cls = (c: number | null) => (c === null || c === 0 ? '' : c > 0 ? 'up' : 'dn')
const pct = (p: number | null) => (p === null ? '—' : sign(p, `${(p * 100).toFixed(1).replace('.', ',')}%`))
const money = (c: number | null) => (c === null ? '—' : formatCents(c))
const varText = (c: number | null) => (c === null ? '—' : sign(c, formatCents(c)))
const when = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}`
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const today = () => new Date().toISOString().slice(0, 10)

interface Form { id?: string; name: string; assetClass: ManualAsset['assetClass']; quoteSymbol: string; quantity: string; value: string; cost: string; sourceKey: string | null }
const EMPTY: Form = { name: '', assetClass: 'renda_fixa', quoteSymbol: '', quantity: '', value: '', cost: '', sourceKey: null }

export function Carteira({ onOpenSettings }: { onOpenSettings(): void }) {
  const { data, db, derived, reload, refreshing, refreshQuotesNow } = useData()
  const { portfolio: p } = derived
  const [grouped, setGrouped] = useState(true)
  const [form, setForm] = useState<Form | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [priceFor, setPriceFor] = useState<{ ticker: string; text: string } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null) // 'asset:<id>' | 'price:<symbol>'
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    try { await fn(); setError(null); await reload() } catch (e) { setError(`Não foi possível salvar: ${e instanceof Error ? e.message : String(e)}`) }
  }

  const quoteOf = (ticker: string) => data.quotes.find(q => q.symbol === yahooSymbol(ticker))
  const yahooTimes = data.quotes.filter(q => q.source === 'yahoo').map(q => q.fetchedAt).sort()
  const lastQuote = yahooTimes[yahooTimes.length - 1]

  const quoted = p.rows.filter(r => r.valueCents !== null)
  // mesmas contas do Resumo: renda variável cotada + renda fixa e cripto com rendimento conhecido
  const varTotal = quoted.reduce((s, r) => s + (r.varCents ?? 0), 0) + p.otherGainCents
  const costQuoted = quoted.reduce((s, r) => s + r.costCents, 0) + p.otherCostCents
  // o mesmo dinheiro pode estar num ativo manual antigo e agora vir da B3 / Binance
  const dupRf = p.rf.some(h => !h.closed) ? data.manualAssets.filter(a => a.assetClass === 'renda_fixa') : []
  const dupCripto = p.crypto.length ? data.manualAssets.filter(a => a.assetClass === 'cripto') : []
  const avg12 = Math.round(p.dividends12mCents / 12)

  const sorted = [...p.rows].sort((a, b) => (b.valueCents ?? -1) - (a.valueCents ?? -1))
  const classRows = p.byClass.filter(c => p.rows.some(r => r.assetType === c.cls))
  const unclassified = sorted.filter(r => !r.assetType)

  const saveForm = async () => {
    if (!form) return
    let qty: number | null, value: Cents | null
    try { qty = form.quantity.trim() ? parseDecimal(form.quantity) : null } catch (e) {
      return setFormError(e instanceof Error && e.message === AMBIGUOUS_MSG ? AMBIGUOUS_MSG : 'Quantidade em formato inválido. Use, por exemplo, 0,01 ou 1500.')
    }
    let cost: Cents | null
    try { value = form.value.trim() ? parseMoney(form.value, 'Valor', false) : null; cost = form.cost.trim() ? parseMoney(form.cost, 'Aportado', false) : null } catch (e) { return setFormError(errText(e)) }
    // ticker americano vai cru para o Yahoo (yahooSymbol acrescentaria .SA)
    const symbol = !form.quoteSymbol.trim() ? null : form.assetClass === 'exterior' ? form.quoteSymbol.trim().toUpperCase() : yahooSymbol(form.quoteSymbol)
    if (form.assetClass === 'exterior' && (!symbol || qty === null)) return setFormError('No exterior, informe o ticker (como no Yahoo) e a quantidade.')
    if (!form.name.trim()) return setFormError('Informe o nome do ativo.')
    if (qty !== null && !(qty >= 0)) return setFormError('Quantidade inválida.')
    if (symbol && qty === null) return setFormError('Com símbolo de cotação, informe a quantidade.')
    if (!symbol && value === null) return setFormError('Informe o valor ou um símbolo de cotação com quantidade.')
    setFormError(null)
    await run(async () => {
      await saveManualAsset(db, { id: form.id, name: form.name.trim(), assetClass: form.assetClass, currency: form.assetClass === 'exterior' ? 'USD' : 'BRL', costCents: form.assetClass === 'exterior' ? cost : null, quoteSymbol: symbol, quantity: qty, valueCents: value, updatedAt: today(), sourceKey: form.sourceKey })
      setForm(null)
    })
  }

  const savePrice = async () => {
    if (!priceFor) return
    let cents: Cents
    try { cents = parseMoney(priceFor.text, 'Preço') } catch (e) { return setError(errText(e)) }
    await run(async () => {
      await upsertQuote(db, { symbol: yahooSymbol(priceFor.ticker), priceCents: cents, fetchedAt: new Date().toISOString(), source: 'manual' })
      setPriceFor(null)
    })
  }

  const assetRow = (r: PortfolioRow) => {
    const quote = quoteOf(r.ticker)
    const symbol = yahooSymbol(r.ticker)
    return (
      <tr key={r.ticker}>
        <td>{r.ticker}</td>
        <td className="r">{r.qty.toLocaleString('pt-BR')}</td>
        <td className="r">{formatCents(r.avgPriceCents)}</td>
        <td className="r">{formatCents(r.costCents)}</td>
        <td className="r">{money(r.priceCents)} {quote?.source === 'manual' && <span className="tag">à mão</span>}</td>
        <td className="r">{money(r.valueCents)}</td>
        <td className={`r ${cls(r.varCents)}`}>{varText(r.varCents)}</td>
        <td className={`r ${cls(r.varCents)}`}>{pct(r.varPct)}</td>
        <td className="r t2">
          {confirm === `price:${symbol}` ? (
            <span>Remover preço manual? <button className="link dn" onClick={() => run(async () => { await deleteQuote(db, symbol); setConfirm(null) })}>Remover</button> <button className="link" onClick={() => setConfirm(null)}>Cancelar</button></span>
          ) : priceFor?.ticker === r.ticker ? (
            <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
              <input className="in" style={{ width: 80 }} autoFocus placeholder="0,00" value={priceFor.text} onChange={e => setPriceFor({ ticker: r.ticker, text: e.target.value })} onKeyDown={e => e.key === 'Enter' && void savePrice()} />
              <button className="link" onClick={() => void savePrice()}>Salvar</button> <button className="link" onClick={() => setPriceFor(null)}>Cancelar</button>
            </span>
          ) : (
            <>
              <button className="link" onClick={() => setPriceFor({ ticker: r.ticker, text: '' })}>preço manual</button>
              {quote?.source === 'manual' && <> · <button className="link" onClick={() => setConfirm(`price:${symbol}`)}>remover</button></>}
            </>
          )}
        </td>
      </tr>
    )
  }

  return (
    <>
      <div className="bar">
        <div>
          <h1>Carteira</h1>
          <div className="muted">
            {lastQuote ? `Cotações do Yahoo de ${when(lastQuote)} (atraso de ~15 min) · atualiza a cada 15 min` : 'Sem cotações do Yahoo ainda · atualiza a cada 15 min'}
          </div>
        </div>
        <div className="btns">
          <button className="b ghost" disabled={refreshing} onClick={() => void refreshQuotesNow()}>{refreshing ? 'Atualizando…' : '↻ Atualizar cotações'}</button>
          <button className="b" onClick={() => { setForm(EMPTY); setFormError(null) }}>+ Ativo manual</button>
        </div>
      </div>
      {error && <div className="note" style={{ marginTop: 10 }}>{error}</div>}

      <div className="kpis">
        <div className="k"><div className="muted">Patrimônio</div><div className="v">{formatBRL(p.totalValueCents)}</div>
          <div className="s muted">custo {formatBRL(p.totalCostCents)}{p.missingQuotes.length > 0 && ` · sem cotação: ${p.missingQuotes.length} ${p.missingQuotes.length === 1 ? 'ativo' : 'ativos'}`}</div></div>
        <div className="k"><div className="muted">Resultado</div><div className={`v ${cls(varTotal)}`}>{sign(varTotal, formatBRL(varTotal))}</div>
          <div className={`s ${cls(varTotal)}`}>{costQuoted > 0 ? pct(varTotal / costQuoted) : '—'}</div></div>
        <div className="k"><div className="muted">Proventos 12 meses</div><div className="v">{formatBRL(p.dividends12mCents)}</div><div className="s muted">média {formatBRL(avg12)}/mês</div></div>
      </div>

      <div className="bar" style={{ marginBottom: 6 }}>
        <div className="row">
          <button className={`chip ${grouped ? 'on' : ''}`} onClick={() => setGrouped(true)}>Agrupar por classe</button>
          <button className={`chip ${grouped ? '' : 'on'}`} onClick={() => setGrouped(false)}>Lista única</button>
        </div>
        <span className="muted">Ordenar: valor atual ↓</span>
      </div>
      {data.notes.length === 0 ? (
        <div className="card">
          <b style={{ color: '#fff' }}>Comece importando da B3</b>
          <div className="muted" style={{ margin: '4px 0 10px' }}>Baixe os relatórios de Negociação, Proventos Recebidos, Movimentação e Posição na Área do Investidor e importe em Configurações. Ações do exterior e dólar entram em Ativos manuais.</div>
          <button className="b pri" onClick={onOpenSettings}>Ir para Configurações</button>
        </div>
      ) : p.rows.length === 0 ? <div className="info">Nenhuma posição ainda. Lance notas em Notas ou importe a Negociação da B3 em Configurações.</div> : (
        <div className="table-scroll" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table>
          <thead><tr><th>Ativo</th><th className="r">Qtd</th><th className="r">Preço médio</th><th className="r">Custo</th><th className="r">Cotação</th><th className="r">Valor atual</th><th className="r">Var. R$</th><th className="r">Var. %</th><th /></tr></thead>
          <tbody>
            {grouped ? (
              <>
                {classRows.map(c => {
                  const v = c.costCents === null ? null : c.valueCents - c.costCents
                  return [
                    <tr key={`c-${c.cls}`} className="cls">
                      <td>{c.cls} · {p.totalValueCents ? Math.round((c.valueCents / p.totalValueCents) * 100) : 0}%</td><td /><td />
                      <td className="r">{money(c.costCents)}</td><td /><td className="r">{formatCents(c.valueCents)}</td>
                      <td className={`r ${cls(v)}`}>{varText(v)}</td>
                      <td className={`r ${cls(v)}`}>{v === null || !c.costCents ? '—' : pct(v / c.costCents)}</td><td />
                    </tr>,
                    ...sorted.filter(r => r.assetType === c.cls).map(assetRow),
                  ]
                })}
                {unclassified.map(assetRow)}
                {/* posições sem nenhuma cotação ficam fora de byClass: listadas ao fim */}
                {sorted.filter(r => r.assetType && !classRows.some(c => c.cls === r.assetType)).map(assetRow)}
              </>
            ) : sorted.map(assetRow)}
          </tbody>
        </table></div>
      )}

      <RendaFixa list={p.rf} onOpenSettings={onOpenSettings} />
      <Cripto rows={p.crypto} onOpenSettings={onOpenSettings} />

      <h5>Ativos manuais <span className="muted">· valor que você informa, ou quantidade × cotação</span></h5>
      {[{ list: dupRf, what: 'renda fixa', from: 'da B3' }, { list: dupCripto, what: 'cripto', from: 'da Binance' }].map(({ list, what, from }) => list.length > 0 && (
        <div key={what} className="note" style={{ marginBottom: 8 }}>
          Você tem {list.length} {list.length === 1 ? 'ativo manual' : 'ativos manuais'} de {what} ({list.map(x => x.name).join(', ')}); se já {list.length === 1 ? 'veio' : 'vieram'} {from}, exclua para não contar duas vezes.
        </div>
      ))}
      {form && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="row">
            <label className="field"><span>Nome</span><input className="in" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <div className="field"><span>Classe</span>
              <Select ariaLabel="Classe" value={form.assetClass} onChange={v => setForm({ ...form, assetClass: v as Form['assetClass'], quoteSymbol: v === 'dolar' && !form.quoteSymbol.trim() ? 'BRL=X' : form.quoteSymbol })} options={Object.entries(CLASS_LABEL).map(([k, v]) => ({ value: k, label: v }))} /></div>
            <label className="field"><span>{form.assetClass === 'exterior' ? 'Ticker no Yahoo' : 'Símbolo da cotação (opcional)'}</span><input className="in" placeholder={form.assetClass === 'exterior' ? 'VOO, AAPL' : 'BRL=X'} value={form.quoteSymbol} onChange={e => setForm({ ...form, quoteSymbol: e.target.value })} /></label>
            <label className="field"><span>Quantidade</span><input className="in" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></label>
            {form.assetClass !== 'exterior' ? <label className="field"><span>Valor (R$)</span><input className="in" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></label>
              : <label className="field"><span>Aportado (US$, opcional)</span><input className="in" inputMode="decimal" placeholder="0,00" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} /></label>}
          </div>
          {formError && <div className="note" style={{ marginTop: 8 }}>{formError}</div>}
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="b pri" onClick={() => void saveForm()}>Salvar</button>
            <button className="b ghost" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {data.manualAssets.length === 0 ? <div className="muted">Nenhum ativo manual.</div> : (
        <div className="table-scroll" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table>
          <thead><tr><th>Ativo</th><th>Classe</th><th className="r">Qtd</th><th className="r">Cotação</th><th className="r">Valor</th><th>Atualizado</th><th /></tr></thead>
          <tbody>
            {data.manualAssets.map(a => {
              const quote = a.quoteSymbol ? data.quotes.find(q => q.symbol === a.quoteSymbol) : undefined
              const row = p.manual.find(m => m.id === a.id)
              const value = row?.valueCents ?? null
              return (
                <tr key={a.id}>
                  <td>{a.name}</td><td className="t2">{label(a.assetClass)}</td>
                  <td className="r">{a.quantity === null ? '—' : a.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}</td>
                  <td className="r">{quote ? `${a.currency === 'USD' ? 'US$ ' : ''}${formatCents(quote.priceCents)}` : '—'}</td>
                  <td className="r">{a.currency === 'USD' && value === null && row?.usdCents != null ? <span className="t2">sem dólar do dia</span> : money(value)}{row?.usdCents != null && <div className="t2">US$ {formatCents(row.usdCents)}{row.usdCostCents ? <> · <span className={cls(row.usdCents - row.usdCostCents)}>{sign(row.usdCents - row.usdCostCents, `US$ ${formatCents(row.usdCents - row.usdCostCents)}`)} ({pct((row.usdCents - row.usdCostCents) / row.usdCostCents)})</span></> : null}</div>}</td>
                  <td className="t2">{quote ? <>{when(quote.fetchedAt)} <span className="tag">{quote.source === 'manual' ? 'à mão' : 'Yahoo'}</span></> : <>{a.updatedAt.split('-').reverse().join('/')} <span className="tag">à mão</span></>}</td>
                  <td className="r t2">
                    {confirm === `asset:${a.id}` ? (
                      <span>Excluir {a.name}? <button className="link dn" onClick={() => run(async () => { await deleteManualAsset(db, a.id); setConfirm(null) })}>Excluir</button> <button className="link" onClick={() => setConfirm(null)}>Cancelar</button></span>
                    ) : (
                      <>
                        <button className="link" onClick={() => { setForm({ id: a.id, name: a.name, assetClass: a.assetClass, quoteSymbol: a.quoteSymbol ?? '', quantity: a.quantity === null ? '' : String(a.quantity).replace('.', ','), value: a.valueCents === null ? '' : formatCents(a.valueCents), cost: a.costCents === null ? '' : formatCents(a.costCents), sourceKey: a.sourceKey }); setFormError(null) }}>editar</button>
                        {' · '}<button className="link" onClick={() => setConfirm(`asset:${a.id}`)}>excluir</button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      )}
      {data.manualAssets.some(a => a.currency === 'USD' && a.costCents !== null) && <div className="muted" style={{ marginTop: 6 }}>No exterior, o rendimento é em dólar; no patrimônio e no resultado em reais, o aportado em US$ é convertido pelo dólar de hoje (sem a variação do câmbio).</div>}
    </>
  )
}
