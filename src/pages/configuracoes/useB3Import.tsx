import { useRef, useState, type ReactNode } from 'react'
import type { AssetType } from '../../domain/types'
import { importB3, parseB3, type B3Import } from '../../import/b3'
import { useData } from '../../state/DataProvider'
import { b3Summary, mergeB3, planilhaReplacedByB3, typeMap, typesToConfirm } from './build'
import { Select } from '../../ui/Select'

const TYPES: AssetType[] = ['FII', 'ETF', 'Ação']

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Fluxo do extrato da B3, usado em Configurações e em Proventos: `button` abre o arquivo, `panel` mostra confirmação e resumo. */
export function useB3Import(): { button(label: string, className: string): ReactNode; panel: ReactNode } {
  const { data, db, reload } = useData()
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ parsed: B3Import; replaces: number; name: string; types: { ticker: string; type: AssetType }[]; inferred: { ticker: string; type: AssetType }[] } | null>(null)
  const [summary, setSummary] = useState<ReturnType<typeof b3Summary> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pick = async (files: File[]) => {
    setPending(null); setSummary(null); setError(null)
    const list: B3Import[] = []
    for (const file of files) {
      try { list.push(parseB3(await file.arrayBuffer(), file.name)) } catch (e) { return setError(`Não foi possível ler ${file.name}: ${errText(e)}`) }
    }
    const parsed = mergeB3(list)
    const name = files.length === 1 ? files[0].name : `${files.length} arquivos`
    if (!parsed.trades.length && !parsed.dividends.length && !parsed.events.length && !parsed.toReview.length && !parsed.ignored && !parsed.rfMoves.length && !parsed.rfPositions.length) {
      return setError(`Nada encontrado em ${name}. Use os relatórios de Negociação, Proventos Recebidos, Movimentação ou Posição da Área do Investidor da B3.`)
    }
    setPending({ parsed, replaces: planilhaReplacedByB3(data.dividends, parsed.dividends), name, ...(({ ask, inferred }) => ({ types: ask, inferred }))(typesToConfirm(parsed, data.trades, data.dividends)) })
  }

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      setSummary(b3Summary(await importB3(db, pending.parsed, typeMap(data.trades, [...pending.inferred, ...pending.types])), pending.parsed))
      setPending(null)
    } catch (e) { setError(`Não foi possível importar o extrato: ${errText(e)}`) }
    try { await reload() } catch (e) { setError(`Não foi possível recarregar os dados: ${errText(e)}`) }
    setBusy(false)
  }

  const p = pending?.parsed
  return {
    button: (label, className) => (
      <>
        <button className={className} disabled={busy} onClick={() => input.current?.click()}>{label}</button>
        <input ref={input} type="file" accept=".xlsx" multiple hidden onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) void pick(f) }} />
      </>
    ),
    panel: (error || pending || summary) && (
      <div style={{ marginTop: 10 }}>
        {error && <div className="note" style={{ marginBottom: 8 }}>{error}</div>}
        {pending && p && (
          <div className="note">
            {pending.name}: {p.trades.length} operações, {p.dividends.length} proventos, {p.events.length} eventos{p.rfMoves.length + p.rfPositions.length > 0 && `, ${p.rfMoves.length} movimentações e ${p.rfPositions.length} títulos de renda fixa`} e {p.toReview.length} itens para revisar.
            {pending.replaces > 0 && <> {pending.replaces === 1 ? '1 provento da planilha será substituído' : `${pending.replaces} proventos da planilha serão substituídos`} pelos do extrato.</>}
            {p.trades.length > 0 && <> A B3 não informa as taxas: as operações entram sem custos; se tiver a nota do dia, ela vale no lugar.</>}
            {pending.inferred.length > 0 && (
              <div style={{ marginTop: 8 }}>
                Tipo pelo nome ou pelos proventos: {pending.inferred.map(t => `${t.ticker} ${t.type === 'Ação' ? 'unit' : t.type}`).join(' · ')}
              </div>
            )}
            {pending.types.length > 0 && (
              <div style={{ marginTop: 8 }}>
                Sem nome nem proventos para saber o tipo; confira (FII, ETF ou unit de ação):
                <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {pending.types.map((t, i) => (
                    <span key={t.ticker} className="t2 row" style={{ alignItems: 'center', gap: 6 }}>{t.ticker}
                      <Select small ariaLabel={`Tipo de ${t.ticker}`} value={t.type} disabled={busy} onChange={v => setPending({ ...pending, types: pending.types.map((x, j) => (j === i ? { ...x, type: v as AssetType } : x)) })}
                        options={TYPES.map(o => ({ value: o, label: o === 'Ação' ? 'Ação (unit)' : o }))} />
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="btns" style={{ marginTop: 8 }}>
              <button className="b" disabled={busy} onClick={() => setPending(null)}>Cancelar</button>
              <button className="b pri" disabled={busy} onClick={() => void confirm()}>{busy ? 'Importando…' : 'Importar'}</button>
            </div>
          </div>
        )}
        {summary && (
          <div className="info">
            Última importação<br />{summary.counts}
            {summary.applied.length > 0 && <><br />Eventos aplicados: {summary.applied.join(' · ')}</>}
            {summary.toReview.length > 0 && <><br /><span className="warn">Não importados, revise e lance à mão se fizer sentido:</span> {summary.toReview.join(' · ')}</>}
          </div>
        )}
      </div>
    ),
  }
}
