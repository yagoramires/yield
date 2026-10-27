import { useRef, useState, type ReactNode } from 'react'
import { importB3, parseB3Movimentacao, type B3Import } from '../../import/b3'
import { useData } from '../../state/DataProvider'
import { b3Summary, planilhaReplacedByB3 } from './build'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Fluxo do extrato da B3, usado em Configurações e em Proventos: `button` abre o arquivo, `panel` mostra confirmação e resumo. */
export function useB3Import(): { button(label: string, className: string): ReactNode; panel: ReactNode } {
  const { data, db, reload } = useData()
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ parsed: B3Import; replaces: number; name: string } | null>(null)
  const [summary, setSummary] = useState<ReturnType<typeof b3Summary> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pick = async (file: File) => {
    setPending(null); setSummary(null); setError(null)
    try {
      const parsed = parseB3Movimentacao(await file.arrayBuffer())
      if (!parsed.dividends.length && !parsed.events.length && !parsed.toReview.length && !parsed.ignored) {
        return setError(`Nenhuma movimentação encontrada em ${file.name}. Use a planilha de Movimentação baixada da Área do Investidor da B3.`)
      }
      setPending({ parsed, replaces: planilhaReplacedByB3(data.dividends, parsed.dividends), name: file.name })
    } catch (e) { setError(`Não foi possível ler ${file.name}: ${errText(e)}`) }
  }

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      setSummary(b3Summary(await importB3(db, pending.parsed), pending.parsed))
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
        <input ref={input} type="file" accept=".xlsx" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f) }} />
      </>
    ),
    panel: (error || pending || summary) && (
      <div style={{ marginTop: 10 }}>
        {error && <div className="note" style={{ marginBottom: 8 }}>{error}</div>}
        {pending && p && (
          <div className="note">
            {pending.name}: {p.dividends.length} proventos, {p.events.length} eventos e {p.toReview.length} movimentações para revisar.{' '}
            {pending.replaces === 1 ? '1 provento da planilha será substituído' : `${pending.replaces} proventos da planilha serão substituídos`} pelos do extrato.
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
            {summary.toReview.length > 0 && <><br /><span className="warn">Movimentações não tratadas, revise e lance à mão:</span> {summary.toReview.join(' · ')}</>}
          </div>
        )}
      </div>
    ),
  }
}
