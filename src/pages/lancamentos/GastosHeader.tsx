import { ChevronLeft, ChevronRight, RefreshCw, Upload } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import type { Account } from '../../db/gastosRepo'
import { addMonths } from '../../domain/money'
import type { Month } from '../../domain/types'
import { importStatement } from '../../import/extrato'
import { detectCsvPreset, parseExtratoCsv, type CsvPreset } from '../../import/extratoCsv'
import { decodeStatement, parseOfx, type ParsedStatement } from '../../import/ofx'
import { useData } from '../../state/DataProvider'
import { duplicateAccountWarning } from './build'

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
export const monthName = (m: Month) => MONTHS[Number(m.slice(5, 7)) - 1]
export const accountLabel = (a: Account | undefined) => (a ? `${a.name}${a.number ? ` ···${a.number.replace(/\D/g, '').slice(-4)}` : ''}` : '—')
export const brDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const PRESET_LABEL: Record<CsvPreset, string> = { 'nubank-conta': 'Nubank', mercadopago: 'Mercado Pago' }

function syncedLabel(iso: string) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  return d.toDateString() === new Date().toDateString() ? `hoje ${hm}` : `${p(d.getDate())}/${p(d.getMonth() + 1)} ${hm}`
}

/** Cabeçalho comum de Resumo e Lançamentos: mês, sincronização, importação de extrato e a linha de avisos. */
export function GastosHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  const { gastos: { data, month, setMonth, syncing, syncNow, lastSyncResult } } = useData()
  const imp = useExtratoImport()
  const [open, setOpen] = useState(false)
  const lastSync = data.accounts.flatMap(a => (a.source === 'pluggy' && a.lastSyncAt ? [a.lastSyncAt] : [])).sort().at(-1)
  const avisos = [...(lastSyncResult?.errors ?? []).map(e => `${e.label} não sincronizou (${e.message})`), ...duplicateAccountWarning(data.accounts, data.txns)]
  return (
    <>
      <div className="bar">
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <h1 style={{ margin: 0 }}>{title}</h1>
          <button className="icon-btn" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={14} aria-hidden /></button>
          <b style={{ color: '#fff', fontSize: 13 }}>{monthName(month)} {month.slice(0, 4)}</b>
          <button className="icon-btn" aria-label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={14} aria-hidden /></button>
        </div>
        <div className="btns">
          {(syncing || lastSync) && <span className="muted" style={{ alignSelf: 'center' }}>{syncing ? 'sincronizando…' : `sincronizado ${syncedLabel(lastSync!)}`}</span>}
          {actions}
          <button className="b ghost with-ico" disabled={syncing} onClick={() => void syncNow()}><RefreshCw size={13} aria-hidden />Sincronizar</button>
          {imp.button}
        </div>
      </div>
      {avisos.length > 0 && (
        <div className="alert">
          <span>⚠ <b>{avisos.length === 1 ? '1 aviso' : `${avisos.length} avisos`}:</b></span>
          {open ? <ul>{avisos.map(a => <li key={a}>{a}</li>)}</ul> : <span className="one">{avisos.join(' · ')}</span>}
          <button className="link" onClick={() => setOpen(!open)}>{open ? 'Fechar' : 'Ver'}</button>
        </div>
      )}
      {imp.panel}
    </>
  )
}

function useExtratoImport() {
  const { db, reload } = useData()
  const input = useRef<HTMLInputElement>(null)
  const [csv, setCsv] = useState<{ text: string; preset: CsvPreset; file: string; label: string } | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (file: string, parse: () => ParsedStatement) => {
    setBusy(true)
    try {
      const r = await importStatement(db, parse())
      setSummary(`${file}: ${r.inserted} novos · ${r.skipped} já existiam`)
      setCsv(null)
    } catch (e) { setError(`Não foi possível importar ${file}: ${errText(e)}`) }
    try { await reload() } catch (e) { setError(`Não foi possível recarregar os dados: ${errText(e)}`) }
    setBusy(false)
  }

  const pick = async (f: File) => {
    setCsv(null); setSummary(null); setError(null)
    try {
      const text = decodeStatement(await f.arrayBuffer())
      if (/\.ofx$/i.test(f.name)) return await save(f.name, () => parseOfx(text))
      const preset = detectCsvPreset(text)
      if (!preset) return setError(`${f.name}: Formato de CSV não reconhecido (aceito: Nubank conta, Mercado Pago)`)
      setCsv({ text, preset, file: f.name, label: PRESET_LABEL[preset] })
    } catch (e) { setError(`Não foi possível ler ${f.name}: ${errText(e)}`) }
  }

  return {
    button: (
      <>
        <button className="b with-ico" disabled={busy} onClick={() => input.current?.click()}><Upload size={13} aria-hidden />Importar extrato…</button>
        <input ref={input} type="file" accept=".ofx,.csv" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f) }} />
      </>
    ),
    panel: (error || csv || summary) && (
      <div style={{ marginTop: 10 }}>
        {error && <div className="note" style={{ marginBottom: 8 }}>{error}</div>}
        {csv && (
          <div className="note">
            {csv.file}: extrato do {PRESET_LABEL[csv.preset]}. Dê um nome para a conta (os lançamentos ficam nela).
            <div className="row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
              <label className="field"><span>Nome da conta</span>
                <input className="in" autoFocus value={csv.label} onChange={e => setCsv({ ...csv, label: e.target.value })} /></label>
              <div className="btns">
                <button className="b" disabled={busy} onClick={() => setCsv(null)}>Cancelar</button>
                <button className="b pri" disabled={busy || !csv.label.trim()} onClick={() => void save(csv.file, () => parseExtratoCsv(csv.text, csv.preset, csv.label.trim()))}>{busy ? 'Importando…' : 'Importar'}</button>
              </div>
            </div>
          </div>
        )}
        {summary && <div className="info">Última importação: {summary}</div>}
      </div>
    ),
  }
}

export function GastosVazio({ onOpenSettings }: { onOpenSettings(): void }) {
  return (
    <div className="info" style={{ marginTop: 14 }}>
      Nenhum lançamento ainda. Conecte seus bancos em <button className="link" onClick={onOpenSettings}>Configurações › Open Finance</button> ou
      use "Importar extrato…" acima (OFX, ou CSV do Nubank conta e do Mercado Pago).
    </div>
  )
}
