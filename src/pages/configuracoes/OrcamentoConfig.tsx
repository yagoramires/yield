import { useRef, useState } from 'react'
import { DEFAULT_PJ, deleteSource, type IncomeSource } from '../../db/orcamentoRepo'
import { cltNet, cltTabelaAno, pjNet, sourceNet } from '../../domain/orcamento'
import { formatBRL, monthOf } from '../../domain/money'
import { decodeStatement } from '../../import/ofx'
import { importOrcamentoCsv, ORCAMENTO_CSV_EXEMPLO, parseOrcamentoCsv } from '../../import/orcamentoCsv'
import { CopyButton } from '../declaracao/Copy'
import { todayISO, useData } from '../../state/DataProvider'
import { orcamentoImportSummary, saveSourceForm, validateSource, type SourceForm } from './build'
import { Select } from '../../ui/Select'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const num = (x: number) => String(x).replace('.', ',')
const money = (c: number) => (c / 100).toFixed(2).replace('.', ',')
const brl = (c: number) => formatBRL(c).replace(/^R\$\s*/, '')

const NEW: SourceForm = { name: '', kind: 'pj', gross: '', proLabore: num(DEFAULT_PJ.proLaborePct), irpj: num(DEFAULT_PJ.irpjPct), inss: num(DEFAULT_PJ.inssPct), contabilidade: '', outros: '', net: '', dependents: '' }
const toForm = (s: IncomeSource): SourceForm => ({
  name: s.name, kind: s.kind, gross: s.grossCents == null ? '' : money(s.grossCents), proLabore: num(s.proLaborePct), irpj: num(s.irpjPct), inss: num(s.inssPct),
  contabilidade: money(s.contabilidadeCents), outros: money(s.outrosCents), net: s.netCents == null ? '' : money(s.netCents), dependents: String(s.dependents),
})
const KIND_LABEL: Record<IncomeSource['kind'], string> = { pj: 'PJ', clt: 'CLT', fixo: 'valor fixo' }

export function ImportarOrcamento() {
  const { db, orcamento } = useData()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const importFile = async (file: File) => {
    setBusy(true); setResult(null); setError(null)
    try { setResult(orcamentoImportSummary(await importOrcamentoCsv(db, parseOrcamentoCsv(decodeStatement(await file.arrayBuffer()))))) } catch (e) { setError(`Não foi possível importar ${file.name}: ${errText(e)}`) }
    try { await orcamento.reload() } catch (e) { setError(`Não foi possível recarregar os dados: ${errText(e)}`) }
    setBusy(false)
  }

  return (
    <div className="card">
      <b style={{ color: '#fff' }}>Importar orçamento (CSV)</b>
      <div className="muted" style={{ margin: '4px 0 10px' }}>
        Uma linha por item com as colunas <b>mes</b> (AAAA-MM), <b>tipo</b> (receita, fixa, variavel ou meta), <b>nome</b> e <b>valor</b>, separadas por ponto e vírgula.
        Salve sua planilha nesse formato como CSV. Pode importar de novo: o que já existe no mês é pulado.
      </div>
      <pre className="t2" style={{ margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>{ORCAMENTO_CSV_EXEMPLO}</pre>
      <div className="btns">
        <button className="b pri" disabled={busy} onClick={() => input.current?.click()}>Escolher arquivo…</button>
        <CopyButton text={ORCAMENTO_CSV_EXEMPLO} label="Copiar exemplo" what="exemplo de CSV" />
      </div>
      <input ref={input} type="file" accept=".csv,.txt" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />
      {busy && <span className="muted"> Importando…</span>}
      {error && <div className="note" style={{ marginTop: 10 }}>{error}</div>}
      {result && <div className="info" style={{ marginTop: 10 }}>Última importação<br />{result}</div>}
    </div>
  )
}

export function FontesRenda() {
  const { db, orcamento } = useData()
  const sources = orcamento.data.sources
  const [form, setForm] = useState<SourceForm | null>(null)
  const [editing, setEditing] = useState<IncomeSource | null>(null) // null com form aberto = fonte nova
  const [del, setDel] = useState<IncomeSource | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const open = (s: IncomeSource | null) => { setEditing(s); setForm(s ? toForm(s) : NEW); setError(null); setMsg(null); setDel(null) }
  const set = (k: keyof SourceForm) => (e: { target: { value: string } }) => setForm(f => f && { ...f, [k]: e.target.value })

  const month = monthOf(todayISO()), year = Number(month.slice(0, 4)), tabelaAno = cltTabelaAno(year)
  let preview: ReturnType<typeof pjNet> | null = null
  let clt: ReturnType<typeof cltNet> | null = null
  try {
    const v = form && form.kind !== 'fixo' ? validateSource(form) : null
    if (v?.kind === 'pj') preview = pjNet(v.grossCents!, v)
    if (v?.kind === 'clt') clt = cltNet(v.grossCents!, v.dependents, v.outrosCents, year)
  } catch { /* inválido: sem prévia */ }

  const salvar = async () => {
    if (!form) return
    setBusy(true); setError(null)
    try {
      const n = await saveSourceForm(db, validateSource(form), editing, monthOf(todayISO()), setEditing)
      setMsg(`Fonte salva. ${n} ${n === 1 ? 'entrada deste mês e dos próximos foi recalculada' : 'entradas deste mês e dos próximos foram recalculadas'}.`)
      setForm(null); setEditing(null)
      await orcamento.reload()
    } catch (e) {
      setError(errText(e))
      try { await orcamento.reload() } catch { /* o erro principal já está na tela */ }
    }
    setBusy(false)
  }

  const apagar = async (s: IncomeSource) => {
    setBusy(true); setError(null)
    try { await deleteSource(db, s.id); setDel(null); setMsg(null); await orcamento.reload() }
    catch (e) { setError(`Não foi possível apagar a fonte: ${errText(e)}`) }
    setBusy(false)
  }

  const field = (label: string, k: keyof SourceForm, w = 110) => (
    <label className="field"><span>{label}</span><input className="in" style={{ width: w }} value={form![k]} onChange={set(k)} /></label>
  )

  return (
    <div className="card">
      <div className="bar"><b style={{ color: '#fff' }}>Fontes de renda</b><button className="b ghost" disabled={busy} onClick={() => open(null)}>+ Fonte de renda</button></div>
      <div className="muted" style={{ margin: '4px 0 8px' }}>As entradas do orçamento podem usar uma fonte. Mudar uma fonte recalcula este mês e os próximos; meses que já passaram ficam como estão.</div>
      {sources.length === 0 ? <div className="muted">Nenhuma fonte ainda.</div> : (
        <div className="table-scroll" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table>
          <thead><tr><th>Fonte</th><th>Tipo</th><th className="r">Bruto</th><th className="r">Líquido/mês</th><th></th></tr></thead>
          <tbody>
            {sources.map(s => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td><span className="pill">{KIND_LABEL[s.kind]}</span></td>
                <td className={`r${s.grossCents == null ? ' t2' : ''}`}>{s.grossCents == null ? '—' : brl(s.grossCents)}</td>
                <td className="r">{brl(sourceNet(s, month))}</td>
                <td><button className="b ghost" disabled={busy} onClick={() => open(s)}>editar</button> <button className="b ghost" disabled={busy} onClick={() => { setDel(s); setForm(null); setMsg(null) }}>apagar</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {del && (
        <div className="note" style={{ marginTop: 10 }}>
          Apagar a fonte "{del.name}"? As entradas que usam essa fonte ficam com o último valor.
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="b" disabled={busy} onClick={() => setDel(null)}>Cancelar</button>
            <button className="b pri" disabled={busy} onClick={() => void apagar(del)}>Apagar</button>
          </div>
        </div>
      )}
      {form && (
        <div className="card" style={{ marginTop: 10, background: '#16171a' }}>
          <div className="muted" style={{ marginBottom: 6 }}>{editing ? <>Editando <b style={{ color: '#e8e9ec' }}>{editing.name}</b></> : 'Nova fonte de renda'}</div>
          <div className="row">
            {field('Nome', 'name', 180)}
            <div className="field"><span>Tipo</span>
              <Select ariaLabel="Tipo" value={form.kind} onChange={v => setForm({ ...form, kind: v as SourceForm['kind'] })} options={[{ value: 'pj', label: 'PJ' }, { value: 'clt', label: 'CLT' }, { value: 'fixo', label: 'valor fixo' }]} />
            </div>
            {form.kind === 'fixo' ? field('Líquido do mês (R$)', 'net') : field('Bruto (R$)', 'gross')}
          </div>
          {form.kind === 'pj' && (
            <>
              <div className="row" style={{ marginTop: 6 }}>
                {field('Pró-labore (% do bruto)', 'proLabore', 90)}
                {field('IRPJ (% do bruto)', 'irpj', 90)}
                {field('INSS (% do pró-labore)', 'inss', 90)}
                {field('Contabilidade (R$)', 'contabilidade', 90)}
                {field('Outros descontos (R$)', 'outros', 90)}
              </div>
              {preview && (
                <div className="info" style={{ marginTop: 8 }}>
                  Líquido: <b style={{ color: '#e8e9ec' }}>R$ {brl(preview.netCents)}</b> (pró-labore {brl(preview.proLaboreCents)} · IRPJ {brl(preview.irpjCents)} · INSS {brl(preview.inssCents)} · contabilidade {brl(preview.contabilidadeCents)} · outros {brl(preview.outrosCents)})
                </div>
              )}
            </>
          )}
          {form.kind === 'clt' && (
            <>
              <div className="row" style={{ marginTop: 6 }}>
                {field('Dependentes (IRRF)', 'dependents', 90)}
                {field('Outros descontos (R$)', 'outros', 110)}
              </div>
              {clt && (
                <div className="info" style={{ marginTop: 8 }}>
                  Líquido: <b style={{ color: '#e8e9ec' }}>R$ {brl(clt.netCents)}</b> (INSS {brl(clt.inssCents)} · IRRF {brl(clt.irrfCents)}{clt.outrosCents > 0 && ` · outros ${brl(clt.outrosCents)}`}) · FGTS de {brl(clt.fgtsCents)} depositado pela empresa, fora do líquido
                </div>
              )}
              <div className="muted" style={{ marginTop: 6 }}>
                INSS e IRRF pelas tabelas de {tabelaAno}{tabelaAno === 2026 && ', com a isenção até R$ 5.000'}.{tabelaAno !== year && ` A tabela de ${year} ainda não está no app: usando a tabela de ${tabelaAno}.`} Outros descontos: plano de saúde, VT, VR… do seu holerite.
              </div>
            </>
          )}
          <div className="btns" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
            <button className="b ghost" disabled={busy} onClick={() => setForm(null)}>Cancelar</button>
            <button className="b pri" disabled={busy} onClick={() => void salvar()}>{busy ? 'Salvando…' : 'Salvar'}</button>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>Tipo "valor fixo" pede só o líquido do mês (freela recorrente, aluguel recebido…). Apagar uma fonte mantém as entradas que a usavam, com o último valor.</div>
        </div>
      )}
      {error && <div className="note" style={{ marginTop: 10 }}>{error}</div>}
      {msg && <div className="info" style={{ marginTop: 10 }}>{msg}</div>}
    </div>
  )
}
