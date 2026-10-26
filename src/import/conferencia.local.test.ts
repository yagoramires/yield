import { existsSync, readFileSync } from 'node:fs'
import { read, utils } from 'xlsx'
import { loadAll } from '../db/repo'
import { createTestDb } from '../db/testDb'
import { computeDarfs } from '../domain/darf'
import { replay } from '../domain/ledger'
import { computeTax } from '../domain/tax'
import { parseBRDate, parseBRL } from './parse'
import { importPlanilha, parsePlanilha } from './planilha'

// Confere o app contra a planilha real do Yago. Só imprime as diferenças no terminal: nunca falha e nunca grava valores.
const FILE = 'planilhas/Controle de Investimentos.xlsm'

type Cell = string | number | null
const cents = (v: Cell | undefined) => (typeof v === 'number' || typeof v === 'string' ? parseBRL(v) : 0)

describe.skipIf(!existsSync(FILE))('conferência com a planilha antiga', () => {
  test('imprime as diferenças por mês e ticker', async () => {
    const buf = readFileSync(FILE)
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const wb = read(data, { cellDates: false })
    const table = (name: string) => {
      const [h, ...rows] = utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, raw: true, defval: null })
      return rows.map(r => Object.fromEntries(h.map((k, i) => [String(k ?? '').trim(), r[i]])) as Record<string, Cell>)
    }
    const byMonth = (name: string, col: string) => new Map(table(name)
      .filter(r => typeof r['Mês'] === 'number')
      .map(r => [parseBRDate(r['Mês'] as number).slice(0, 7), cents(r[col])]))

    const db = createTestDb()
    const p = parsePlanilha(data)
    console.log('importação:', await importPlanilha(db, p), '\ntypeConflicts:', p.typeConflicts, '\nignored:', p.ignored)
    const d = await loadAll(db)
    const r = replay(d.trades, d.events)
    console.log('warnings:', r.warnings.map(w => `${w.kind} ${w.ticker} ${w.date}`))
    // IR comum e DARF da planilha param em 2021-12; a tabela de FII vai além, então confere FII até 2025.
    const months = computeTax(r.sales, r.warnings, '2020-01', '2025-12')
    const darfs = computeDarfs(months, [], '2026-10-26')

    const diff = (label: string, sheet: Map<string, number>, app: (m: number) => number) => {
      // Contagem de meses lidos/com valor: prova que a aba foi de fato lida (senão "sem diferença" seria 0 = 0).
      const both = months.flatMap((m, i) => (sheet.has(m.month) ? [{ month: m.month, s: sheet.get(m.month)!, a: app(i) }] : []))
      console.log(`${label}: ${both.length} meses comparados, ${both.filter(x => x.s).length} com valor na planilha, ${both.filter(x => x.a).length} no app`)
      for (const { month, s, a } of both) if (s !== a) console.log(`${month} ${label}: planilha ${s} × app ${a} (dif ${a - s})`)
    }
    diff('IR comum (Resultado Total)', byMonth('Imposto de Renda', 'Resultado Total'), i => months[i].comum.resultCents - months[i].comum.exemptProfitCents)
    diff('IR comum (Lucro Isento)', byMonth('Imposto de Renda', 'Lucro Isento'), i => months[i].comum.exemptProfitCents)
    diff('IR comum (Prejuízo a Compensar)', byMonth('Imposto de Renda', 'Prejuízo a Compensar'), i => months[i].comum.lossInCents)
    diff('IR comum (Imposto Devido)', byMonth('Imposto de Renda', 'Imposto Devido'), i => months[i].comum.taxDueCents)
    diff('IR comum (Imposto a pagar)', byMonth('Imposto de Renda', 'Imposto a pagar'), i => months[i].comum.taxPayableCents)
    diff('IR FII (Resultado FII)', byMonth('Imposto de Renda F.I.I.', 'Resultado FII'), i => months[i].fii.resultCents)
    diff('IR FII (Prejuízo a Compensar)', byMonth('Imposto de Renda F.I.I.', 'Prejuízo a Compensar'), i => months[i].fii.lossInCents)
    diff('IR FII (Imposto Devido)', byMonth('Imposto de Renda F.I.I.', 'Imposto Devido'), i => months[i].fii.taxDueCents)
    diff('IR FII (Imposto a pagar)', byMonth('Imposto de Renda F.I.I.', 'Imposto a pagar'), i => months[i].fii.taxPayableCents)
    diff('DARF', byMonth('DARF a Pagar', 'DARF a pagar'), i => darfs.rows[i].darfCents)

    // Resumo M–T: tabela de posições abertas (colunas repetem nomes, então lê por posição).
    const resumo = utils.sheet_to_json<Cell[]>(wb.Sheets['Resumo'], { header: 1, raw: true, defval: null }).slice(1)
      .filter(row => typeof row[12] === 'string' && row[12])
      .map(row => ({ ticker: String(row[12]).trim(), qty: Number(row[13]), cost: cents(row[15]) }))
    const app = new Map(r.positions.map(x => [x.ticker, x]))
    for (const s of resumo) {
      const a = app.get(s.ticker)
      if (!a) console.log(`posição ${s.ticker}: só na planilha (qtd ${s.qty}, custo ${s.cost})`)
      else if (a.qty !== s.qty || Math.abs(a.totalCostCents - s.cost) > 1) console.log(`posição ${s.ticker}: planilha qtd ${s.qty} custo ${s.cost} × app qtd ${a.qty} custo ${a.totalCostCents}`)
      app.delete(s.ticker)
    }
    for (const a of app.values()) console.log(`posição ${a.ticker}: só no app (qtd ${a.qty}, custo ${a.totalCostCents})`)
  })
})
