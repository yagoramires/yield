import { useState } from 'react'
import type { Db } from '../../db/client'
import { getAlias, saveAlias, type Note } from '../../db/repo'
import { formatCents } from '../../domain/money'
import type { AssetType } from '../../domain/types'
import { parseSinacorNote, type NoteDraft } from '../../import/sinacorPdf'
import { extractPdfText, PdfPasswordError } from '../../import/pdfText'
import { ASSET_TYPES, DUP_MSG, draftToSave, FEE_FIELDS, noteNet, type Built } from './build'
import { Select } from '../../ui/Select'

interface Entry { draft: NoteDraft; askBroker: boolean; dup: boolean; resolved: { ticker: string; assetType: AssetType | '' }[]; remember: boolean[]; done: boolean }
const br = (iso: string) => iso.split('-').reverse().join('/')
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface Props { db: Db; notes: Note[]; onSave(built: Built): Promise<string | null>; onClose(): void }

export function PdfImport({ db, notes, onSave, onClose }: Props) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [idx, setIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pwd, setPwd] = useState<{ file: File; rest: File[]; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async (files: File[], password?: string) => {
    setBusy(true)
    const found: Entry[] = []
    const problems: string[] = []
    for (const [n, file] of files.entries()) {
      try {
        const drafts = parseSinacorNote(await extractPdfText(new Uint8Array(await file.arrayBuffer()), password))
        if (!drafts.length) problems.push(`${file.name}: nenhuma nota no padrão SINACOR encontrada.`)
        for (const d of drafts) {
          const dup = d.broker !== null && notes.some(x => (x.broker === d.broker && x.number === d.number && x.tradeDate === d.tradeDate) || x.sourceKey === `pdf:${d.broker}:${d.number}`)
          const resolved = await Promise.all(d.items.map(async it => ({ ticker: it.ticker ?? (await getAlias(db, it.spec)) ?? '', assetType: it.assetType ?? '' as const })))
          found.push({ draft: d, askBroker: d.broker === null, dup, resolved, remember: d.items.map(() => true), done: false })
        }
      } catch (e) {
        if (e instanceof PdfPasswordError) { setPwd({ file, rest: files.slice(n + 1), text: '' }); break }
        problems.push(`${file.name}: ${errText(e)}`)
      }
    }
    setEntries(prev => { const all = [...prev, ...found]; if (!prev.length) setIdx(0); return all })
    setError(problems.join(' ') || null)
    setBusy(false)
  }

  const upd = (i: number, fn: (e: Entry) => Entry) => setEntries(es => es.map((e, n) => (n === i ? fn(e) : e)))
  const cur = entries[idx]

  const save = async () => {
    let built: Built
    try { built = draftToSave(cur.draft, cur.resolved) } catch (e) { return setError(errText(e)) }
    const err = await onSave(built)
    if (err === DUP_MSG) { setError(null); return upd(idx, e => ({ ...e, dup: true })) }
    if (err) return setError(err)
    // apelidos só depois de salvar a nota: o que veio sem ticker e o usuário pediu para lembrar
    for (const [k, it] of cur.draft.items.entries()) if (!it.ticker && cur.remember[k]) await saveAlias(db, it.spec, cur.resolved[k].ticker)
    setError(null); upd(idx, e => ({ ...e, done: true }))
  }

  let net: number | null = null
  let fees: number[] = []
  if (cur) try { const b = draftToSave(cur.draft, cur.resolved); net = noteNet(b.trades); fees = b.trades.map(t => t.feesCents) } catch { /* rascunho incompleto: sem prévia */ }

  return (
    <div className="card">
      <div className="bar"><b style={{ color: 'var(--strong)' }}>Importar nota em PDF (padrão SINACOR)</b><button className="link t2" onClick={onClose}>fechar</button></div>
      <div style={{ margin: '10px 0' }}>
        <input type="file" accept="application/pdf" multiple disabled={busy} onChange={e => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void load(fs) }} />
      </div>
      {pwd && (
        <div className="info" style={{ marginBottom: 8 }}>
          {pwd.file.name} está protegido por senha (normalmente os 5 primeiros dígitos do CPF).{' '}
          <input className="in" type="password" autoFocus value={pwd.text} onChange={e => setPwd({ ...pwd, text: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') { const p = pwd; setPwd(null); void load([p.file, ...p.rest], p.text) } }} />{' '}
          <button className="link" onClick={() => { const p = pwd; setPwd(null); void load([p.file, ...p.rest], p.text) }}>Abrir</button>{' '}
          <button className="link" onClick={() => setPwd(null)}>Pular</button>
        </div>
      )}
      {error && <div className="note" style={{ marginBottom: 8 }}>{error}</div>}
      {busy && <div className="muted">Lendo…</div>}
      {cur && (
        <>
          <div className="bar">
            <b style={{ color: 'var(--strong)' }}>Nota {cur.draft.number} · {cur.askBroker ? <input className="in" style={{ width: 140 }} placeholder="corretora" aria-label="Corretora" value={cur.draft.broker ?? ''} onChange={e => upd(idx, x => ({ ...x, draft: { ...x.draft, broker: e.target.value } }))} /> : cur.draft.broker} · {br(cur.draft.tradeDate)}</b>
            <span className="muted">
              {entries.length > 1 && <><button className="link" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>‹</button> {idx + 1} de {entries.length} <button className="link" disabled={idx === entries.length - 1} onClick={() => setIdx(idx + 1)}>›</button></>}
            </span>
          </div>
          {cur.askBroker && !cur.done && <div className="note" style={{ margin: '8px 0' }}>Não deu para ler a corretora no cabeçalho da nota: escreva o nome dela (ex. XP, Rico).</div>}
          {cur.dup && <div className="info" style={{ margin: '8px 0' }}>Já importada: essa nota já existe e não será salva de novo.</div>}
          {cur.done && <div className="info" style={{ margin: '8px 0' }}>Nota salva.</div>}
          {cur.draft.items.some((_, k) => !cur.resolved[k].ticker || !cur.resolved[k].assetType) && <div className="note" style={{ margin: '8px 0' }}>Há itens sem ticker ou sem tipo: preencha antes de salvar.</div>}
          <div className="table-scroll" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table>
            <thead><tr><th>C/V</th><th>Especificação</th><th>Tipo</th><th>Ticker</th><th className="r">Qtd</th><th className="r">Preço</th><th className="r">Taxa rateada</th></tr></thead>
            <tbody>
              {cur.draft.items.map((it, k) => (
                <tr key={k}>
                  <td>{it.side}</td><td className="t2">{it.spec}</td>
                  <td><Select small ariaLabel="Tipo do ativo" value={cur.resolved[k].assetType} onChange={v => upd(idx, x => ({ ...x, resolved: x.resolved.map((r, n) => (n === k ? { ...r, assetType: v as AssetType | '' } : r)) }))}
                    options={[{ value: '', label: '— tipo —' }, ...ASSET_TYPES.map(t => ({ value: t, label: t }))]} /></td>
                  <td>
                    {it.ticker ? it.ticker : (
                      <span className="row" style={{ flexWrap: 'nowrap' }}>
                        <input className="in" style={{ width: 80 }} placeholder="ticker" value={cur.resolved[k].ticker} onChange={e => upd(idx, x => ({ ...x, resolved: x.resolved.map((r, n) => (n === k ? { ...r, ticker: e.target.value.toUpperCase() } : r)) }))} />
                        <label className="t2"><input type="checkbox" checked={cur.remember[k]} onChange={e => upd(idx, x => ({ ...x, remember: x.remember.map((v, n) => (n === k ? e.target.checked : v)) }))} /> lembrar</label>
                      </span>
                    )}
                  </td>
                  <td className="r">{it.qty}</td><td className="r">{formatCents(it.priceCents)}</td><td className="r t2">{fees[k] === undefined ? '—' : formatCents(fees[k])}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <h5>Taxas lidas</h5>
          <div className="t2">{FEE_FIELDS.map(([k, name]) => `${name} ${formatCents(cur.draft.fees[k])}`).join(' · ')}</div>
          <div className="bar" style={{ marginTop: 12 }}>
            <span className="t2">{net !== null && <>Líquido calculado: <b className={net < 0 ? 'dn' : 'up'}>{formatCents(net)}</b>{cur.draft.settleDate && ` para ${br(cur.draft.settleDate)}`} · confira com o PDF</>}</span>
            <div className="btns">
              <button className="b" onClick={() => { const rest = entries.filter((_, n) => n !== idx); setEntries(rest); setIdx(Math.max(0, Math.min(idx, rest.length - 1))) }}>{cur.done ? 'Remover da lista' : 'Descartar'}</button>
              <button className="b pri" disabled={cur.dup || cur.done} onClick={() => void save()}>Salvar nota</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
