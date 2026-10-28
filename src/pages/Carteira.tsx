import { useState } from 'react'
import { deleteManualAsset, deleteQuote, saveManualAsset, upsertQuote, type ManualAsset } from '../db/repo'
import { formatBRL, formatCents, monthOf } from '../domain/money'
import type { Cents } from '../domain/types'
import { portfolioResult, type ManualRow, type PortfolioRow } from '../domain/portfolio'
import { rfJurosByMonth } from '../domain/rendaFixa'
import { AMBIGUOUS_MSG, parseDecimal } from '../import/parse'
import { cryptoSymbol, yahooSymbol } from '../quotes/yahoo'
import { parseMoney } from './notas/build'
import { todayISO, useData } from '../state/DataProvider'
import { Select } from '../ui/Select'
import { RendaFixa } from './carteira/RendaFixa'
import { Cripto } from './carteira/Cripto'
import { ClassList } from './carteira/ClassList'
import { PosRow } from './carteira/PosRow'
import { BOLSA, carteiraClasses, pickClass, type ClassKey } from './carteira/build'
import { br, pct, qtyText, signedCents, sign, tone, when } from './carteira/fmt'

const FORM_CLASSES: Record<string, string> = { renda_fixa: 'Renda fixa', cripto: 'Cripto', dolar: 'Dólar', exterior: 'Exterior (US$)', outro: 'Outro' }
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface Form { id?: string; name: string; assetClass: ManualAsset['assetClass']; quoteSymbol: string; quantity: string; value: string; cost: string; sourceKey: string | null }
const emptyForm = (cls: ClassKey | null): Form => ({ name: '', assetClass: cls && cls in FORM_CLASSES ? (cls as ManualAsset['assetClass']) : 'exterior', quoteSymbol: cls === 'dolar' ? 'BRL=X' : '', quantity: '', value: '', cost: '', sourceKey: null })

export function Carteira({ onOpenSettings, initialClass = null }: { onOpenSettings(): void; initialClass?: string | null }) {
  const { data, db, derived, reload, refreshing, refreshQuotesNow, binance } = useData()
  const { portfolio: p } = derived
  const [wanted, setWanted] = useState<string | null>(initialClass)
  const [form, setForm] = useState<Form | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [priceFor, setPriceFor] = useState<{ ticker: string; text: string } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null) // 'asset:<id>' | 'price:<symbol>'
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    try { await fn(); setError(null); await reload() } catch (e) { setError(`Não foi possível salvar: ${errText(e)}`) }
  }

  const classes = carteiraClasses(p)
  const sel = pickClass(classes, wanted)
  const current = classes.find(c => c.key === sel)
  const quoteOf = (symbol: string) => data.quotes.find(q => q.symbol === symbol)
  const lastQuote = data.quotes.filter(q => q.source === 'yahoo').map(q => q.fetchedAt).sort().at(-1)
  const { gainCents: result, baseCents: resultBase } = portfolioResult(p)
  const today = todayISO()
  // mesma janela da renda passiva do Resumo: 12 meses de calendário até o atual
  const juros12 = rfJurosByMonth(data.rfMoves, monthOf(today), 12).reduce((s, m) => s + m.cents, 0)
  const income12 = p.dividends12mCents + juros12
  // o mesmo dinheiro pode estar num ativo manual antigo e agora vir da B3 / Binance
  const dup = sel === 'renda_fixa' && p.rf.some(h => !h.closed) ? { list: data.manualAssets.filter(a => a.assetClass === 'renda_fixa'), what: 'renda fixa', from: 'da B3' }
    : sel === 'cripto' && p.crypto.length ? { list: data.manualAssets.filter(a => a.assetClass === 'cripto'), what: 'cripto', from: 'da Binance' } : null

  const saveForm = async () => {
    if (!form) return
    let qty: number | null, value: Cents | null, cost: Cents | null
    try { qty = form.quantity.trim() ? parseDecimal(form.quantity) : null } catch (e) {
      return setFormError(e instanceof Error && e.message === AMBIGUOUS_MSG ? AMBIGUOUS_MSG : 'Quantidade em formato inválido. Use, por exemplo, 0,01 ou 1500.')
    }
    try { value = form.value.trim() ? parseMoney(form.value, 'Valor', false) : null; cost = form.cost.trim() ? parseMoney(form.cost, 'Aportado', false) : null } catch (e) { return setFormError(errText(e)) }
    // ticker americano vai cru para o Yahoo (yahooSymbol acrescentaria .SA)
    const symbol = !form.quoteSymbol.trim() ? null : form.assetClass === 'exterior' ? form.quoteSymbol.trim().toUpperCase() : form.assetClass === 'cripto' ? cryptoSymbol(form.quoteSymbol) : yahooSymbol(form.quoteSymbol)
    if (form.assetClass === 'exterior' && (!symbol || qty === null)) return setFormError('No exterior, informe o ticker (como no Yahoo) e a quantidade.')
    if (!form.name.trim()) return setFormError('Informe o nome do ativo.')
    if (qty !== null && !(qty >= 0)) return setFormError('Quantidade inválida.')
    if (symbol && qty === null) return setFormError('Com símbolo de cotação, informe a quantidade.')
    if (!symbol && value === null) return setFormError('Informe o valor ou um símbolo de cotação com quantidade.')
    setFormError(null)
    await run(async () => {
      await saveManualAsset(db, { id: form.id, name: form.name.trim(), assetClass: form.assetClass, currency: form.assetClass === 'exterior' || (form.assetClass === 'cripto' && symbol) ? 'USD' : 'BRL', costCents: form.assetClass === 'exterior' ? cost : null, quoteSymbol: symbol, quantity: qty, valueCents: value, updatedAt: today, sourceKey: form.sourceKey })
      setForm(null); setWanted(form.assetClass)
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

  const stockRow = (r: PortfolioRow) => {
    const symbol = yahooSymbol(r.ticker)
    const manualPrice = quoteOf(symbol)?.source === 'manual'
    return (
      <PosRow key={r.ticker} cls={r.assetType ?? 'outro'} avatar={r.ticker} name={r.ticker}
        detail={`${qtyText(r.qty)} × ${r.priceCents === null ? 'sem cotação' : formatCents(r.priceCents)}${manualPrice ? ' (à mão)' : ''} · médio ${formatCents(r.avgPriceCents)}`}
        value={r.valueCents === null ? '—' : formatCents(r.valueCents)} valueSub={r.valueCents !== null && current?.valueCents ? `${Math.round((r.valueCents / current.valueCents) * 100)}% da classe` : null}
        gain={r.varCents === null ? '—' : signedCents(r.varCents)} gainSub={r.varPct !== null && pct(r.varPct)} gainTone={tone(r.varCents)}
        cost={`custo ${formatCents(r.costCents)}`}
        actions={confirm === `price:${symbol}` ? (
          <span>Remover preço manual? <button className="link dn" onClick={() => run(async () => { await deleteQuote(db, symbol); setConfirm(null) })}>Remover</button> <button className="link" onClick={() => setConfirm(null)}>Cancelar</button></span>
        ) : priceFor?.ticker === r.ticker ? (
          <span><input className="in" style={{ width: 80 }} autoFocus placeholder="0,00" aria-label={`Preço de ${r.ticker}`} value={priceFor.text} onChange={e => setPriceFor({ ticker: r.ticker, text: e.target.value })} onKeyDown={e => e.key === 'Enter' && void savePrice()} />
            {' '}<button className="link" onClick={() => void savePrice()}>salvar</button> <button className="link" onClick={() => setPriceFor(null)}>cancelar</button></span>
        ) : <><button className="link" aria-label={`Preço manual de ${r.ticker}`} onClick={() => setPriceFor({ ticker: r.ticker, text: '' })}>preço manual</button>{manualPrice && <> · <button className="link" aria-label={`Remover preço manual de ${r.ticker}`} onClick={() => setConfirm(`price:${symbol}`)}>remover</button></>}</>} />
    )
  }

  const manualRow = (a: ManualAsset) => {
    const m = p.manual.find(x => x.id === a.id) as ManualRow | undefined
    const quote = a.quoteSymbol ? quoteOf(a.quoteSymbol) : undefined
    const usdGain = m?.usdCents != null && m.usdCostCents ? m.usdCents - m.usdCostCents : null
    const gain = usdGain === null && m?.valueCents != null && m.costCents !== null ? m.valueCents - m.costCents : null
    return (
      <PosRow key={a.id} cls={a.assetClass} avatar={a.quoteSymbol && a.assetClass === 'exterior' ? a.quoteSymbol : a.name} name={a.name}
        detail={a.quantity !== null && quote ? `${qtyText(a.quantity)} × ${a.currency === 'USD' ? 'US$ ' : ''}${formatCents(quote.priceCents)} · ${quote.source === 'manual' ? 'à mão' : `Yahoo, ${when(quote.fetchedAt)}`}` : `valor informado em ${br(a.updatedAt)}`}
        value={m?.valueCents == null ? <span className="t2">{a.currency === 'USD' && m?.usdCents != null ? 'sem dólar do dia' : 'sem cotação'}</span> : formatCents(m.valueCents)}
        valueSub={m?.usdCents != null && `US$ ${formatCents(m.usdCents)}`}
        gain={usdGain !== null ? sign(usdGain, `US$ ${formatCents(usdGain)}`) : gain !== null ? signedCents(gain) : '—'}
        gainSub={usdGain !== null ? pct(usdGain / m!.usdCostCents!) : gain !== null && m?.costCents ? pct(gain / m.costCents) : null} gainTone={tone(usdGain ?? gain)}
        cost={a.costCents !== null ? `aportado ${a.currency === 'USD' ? 'US$ ' : ''}${formatCents(a.costCents)}` : 'sem aportado'}
        actions={confirm === `asset:${a.id}` ? (
          <span>Excluir {a.name}? <button className="link dn" onClick={() => run(async () => { await deleteManualAsset(db, a.id); setConfirm(null) })}>Excluir</button> <button className="link" onClick={() => setConfirm(null)}>Cancelar</button></span>
        ) : <><button className="link" onClick={() => { setForm({ id: a.id, name: a.name, assetClass: a.assetClass, quoteSymbol: a.quoteSymbol ?? '', quantity: a.quantity === null ? '' : String(a.quantity).replace('.', ','), value: a.valueCents === null ? '' : formatCents(a.valueCents), cost: a.costCents === null ? '' : formatCents(a.costCents), sourceKey: a.sourceKey }); setFormError(null) }} aria-label={`Editar ${a.name}`}>editar</button>
          {' · '}<button className="link" aria-label={`Excluir ${a.name}`} onClick={() => setConfirm(`asset:${a.id}`)}>excluir</button></>} />
    )
  }

  const manualOf = (k: ClassKey) => data.manualAssets.filter(a => a.assetClass === k).map(manualRow)
  const panel = (k: ClassKey) => {
    if (BOLSA.includes(k) || (k === 'outro' && p.rows.some(r => !r.assetType)))
      return <>{[...p.rows].filter(r => (r.assetType ?? 'outro') === k).sort((a, b) => (b.valueCents ?? -1) - (a.valueCents ?? -1)).map(stockRow)}{k === 'outro' && manualOf(k)}</>
    if (k === 'renda_fixa') return <>{p.rows.filter(r => r.assetType === 'ETF RF').map(stockRow)}<RendaFixa list={p.rf} onOpenSettings={onOpenSettings} />{manualOf(k)}</>
    if (k === 'cripto') return <><Cripto rows={p.crypto} onOpenSettings={onOpenSettings} />{manualOf(k)}</>
    return <>{manualOf(k)}{k === 'exterior' && data.manualAssets.some(a => a.currency === 'USD' && a.costCents !== null) && <div className="muted pos-empty">O rendimento do exterior é em dólar; no patrimônio e no resultado em reais, o aportado em US$ é convertido pelo dólar de hoje (sem a variação do câmbio).</div>}</>
  }

  return (
    <>
      <div className="bar">
        <div>
          <h1>Carteira</h1>
          <div className="muted">{lastQuote ? `Cotações do Yahoo de ${when(lastQuote)} (atraso de ~15 min) · atualiza a cada 15 min` : 'Sem cotações do Yahoo ainda · atualiza a cada 15 min'}</div>
        </div>
        <div className="btns">
          <button className="b ghost" disabled={refreshing} onClick={() => void refreshQuotesNow()}>{refreshing ? 'Atualizando…' : '↻ Atualizar cotações'}</button>
          <button className="b" onClick={() => { setForm(emptyForm(sel)); setFormError(null) }}>+ Ativo</button>
        </div>
      </div>
      {error && <div className="note" style={{ marginTop: 10 }}>{error}</div>}
      {binance.error && !classes.some(c => c.key === 'cripto') && <div className="note" style={{ marginTop: 10 }}>{binance.error} <button className="link" onClick={onOpenSettings}>Configurações</button></div>}

      <div className="kpis">
        <div className="k"><div className="muted">Patrimônio</div><div className="v">{formatBRL(p.totalValueCents)}</div>
          <div className="s muted">aportado {formatBRL(p.totalCostCents)}{p.missingQuotes.length > 0 && ` · sem cotação: ${p.missingQuotes.length}`}</div></div>
        <div className="k"><div className="muted">Resultado</div><div className={`v ${tone(result)}`}>{sign(result, formatBRL(result))}</div>
          <div className={`s ${tone(result)}`}>{resultBase > 0 ? `${pct(result / resultBase)} sobre o aportado` : '—'}</div></div>
        <div className="k"><div className="muted">Proventos + juros 12 meses</div><div className="v">{formatBRL(income12)}</div><div className="s muted">média {formatBRL(Math.round(income12 / 12))}/mês</div></div>
        <div className="k"><div className="muted">Sem aportado</div><div className="v">{p.noCostCount ? `${p.noCostCount} ${p.noCostCount === 1 ? 'item' : 'itens'}` : 'nenhum'}</div><div className="s muted">{p.noCostCount ? 'ficam fora do resultado' : 'todos com aportado'}</div></div>
      </div>

      {form && (
        <div className="card" style={{ marginBottom: 12 }}>
          <b style={{ color: '#fff' }}>{form.id ? 'Editar ativo' : 'Novo ativo'}</b>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="field"><span>Nome</span><input className="in" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <div className="field"><span>Classe</span>
              <Select ariaLabel="Classe" value={form.assetClass} onChange={v => setForm({ ...form, assetClass: v as Form['assetClass'], quoteSymbol: v === 'dolar' && !form.quoteSymbol.trim() ? 'BRL=X' : form.quoteSymbol })} options={Object.entries(FORM_CLASSES).map(([k, v]) => ({ value: k, label: v }))} /></div>
            <label className="field"><span>{form.assetClass === 'exterior' ? 'Ticker no Yahoo' : form.assetClass === 'cripto' ? 'Moeda (opcional)' : 'Símbolo da cotação (opcional)'}</span><input className="in" placeholder={form.assetClass === 'exterior' ? 'VOO, AAPL' : form.assetClass === 'cripto' ? 'BTC, ETH, SOL' : 'BRL=X'} value={form.quoteSymbol} onChange={e => setForm({ ...form, quoteSymbol: e.target.value })} /></label>
            <label className="field"><span>Quantidade</span><input className="in" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></label>
            {form.assetClass !== 'exterior' ? <label className="field"><span>Valor (R$)</span><input className="in" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></label>
              : <label className="field"><span>Aportado (US$, opcional)</span><input className="in" inputMode="decimal" placeholder="0,00" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} /></label>}
          </div>
          {form.assetClass === 'exterior' && <div className="muted" style={{ marginTop: 6 }}>Só ativos cotados em dólar (US$): o ticker precisa ter a cotação em US$ no Yahoo, que o app converte pelo dólar do dia. Outras moedas não são convertidas.</div>}
          {formError && <div className="note" style={{ marginTop: 8 }}>{formError}</div>}
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="b pri" onClick={() => void saveForm()}>Salvar</button>
            <button className="b ghost" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {classes.length === 0 ? (
        <div className="card">
          <b style={{ color: '#fff' }}>{data.notes.length ? 'Nenhuma posição agora' : 'Comece importando da B3'}</b>
          <div className="muted" style={{ margin: '4px 0 10px' }}>{data.notes.length ? 'Tudo o que você tinha foi vendido. Lance compras em Notas, importe da B3 ou adicione um ativo em + Ativo. ' : ''}Baixe os relatórios de Negociação, Proventos Recebidos, Movimentação e Posição na Área do Investidor e importe em Configurações. Ações do exterior, dólar e cripto entram em + Ativo; cripto também pela Binance em Configurações.</div>
          <button className="b pri" onClick={onOpenSettings}>Ir para Configurações</button>
        </div>
      ) : (
        <div className="cart-cols">
          <ClassList list={classes} selected={sel} onSelect={k => { setWanted(k); setConfirm(null); setPriceFor(null) }} />
          {current && (
            <div className="card cart-panel">
              <div className="cart-head">
                <b>{current.label}</b><span className="muted">{current.count} {current.count === 1 ? 'item' : 'itens'}{current.missingQuotes > 0 && ` · ${current.missingQuotes} sem cotação`}</span>
                <span className="cart-tot">{formatBRL(current.valueCents)}
                  <small className={current.gainPct === null ? 'muted' : tone(current.gainPct)}>{current.gainPct === null ? 'sem aportado' : current.usdGain ? `US$ ${pct(current.gainPct)}` : `${signedCents(current.gainCents!)} · ${pct(current.gainPct)}`}</small></span>
              </div>
              {dup && dup.list.length > 0 && (
                <div className="note" style={{ margin: '6px 0' }}>
                  Você tem {dup.list.length} {dup.list.length === 1 ? 'ativo manual' : 'ativos manuais'} de {dup.what} ({dup.list.map(x => x.name).join(', ')}); se já {dup.list.length === 1 ? 'veio' : 'vieram'} {dup.from}, exclua para não contar duas vezes.
                </div>
              )}
              {panel(current.key)}
            </div>
          )}
        </div>
      )}
    </>
  )
}
