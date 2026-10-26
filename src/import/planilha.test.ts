import { createTestDb } from '../db/testDb'
import { loadAll } from '../db/repo'
import { makePlanilha, type NotaRow, type PlanilhaFixture } from '../../tests/fixtures/makePlanilha'
import { importPlanilha, parsePlanilha } from './planilha'

const nota = (o: Partial<NotaRow>): NotaRow => ({
  nota: 1001, corretora: 'CLEAR', pregao: '2024-01-05', liquidacao: '2024-01-09', cv: 'C', tipo: 'Ação', ticker: 'ITSA4', qtd: 100, preco: 10, ...o,
})
const base: PlanilhaFixture = {
  notas: [
    nota({ liquidacaoTaxa: 0.3, emolumentos: 0.07 }),
    nota({ ticker: 'HGLG11F', tipo: 'FII', qtd: 2, preco: 160.5, liquidacaoTaxa: 0.1 }),
    nota({ nota: 1002, corretora: 'Inter DTVM', pregao: '2024-02-01', liquidacao: '2024-02-05', cv: 'V', qtd: 50, preco: 12, irrf: 0.03, corretagem: 1 }),
  ],
  rendimentos: { 2024: [{ label: 'FIIs', rows: [['HGLG11', 110, null, 0, ...Array(9).fill(null)]] }] },
  visaoGeral: [['Ações', 1, 2], ['Tesouro Selic', 1000, 1234.56], ['Pré Fixado', 500, 510], ['Dólar', 10, 11], ['BTC', 10, 12]],
}

test('agrupa linhas em notas e soma taxas sem o IRRF', () => {
  const p = parsePlanilha(makePlanilha(base))
  expect(p.notes).toHaveLength(2)
  expect(p.notes[0].note).toMatchObject({ number: '1001', broker: 'CLEAR', tradeDate: '2024-01-05', settleDate: '2024-01-09', source: 'planilha', sourceKey: 'planilha:CLEAR:1001:2024-01-05' })
  expect(p.notes[0].trades).toHaveLength(2)
  expect(p.notes[0].trades[0]).toMatchObject({ seq: 1, side: 'C', assetType: 'Ação', ticker: 'ITSA4', qty: 100, priceCents: 1000, feesCents: 37, irrfCents: 0 })   // liq 30 + emol 7 na fixture
  expect(p.notes[0].trades[1]).toMatchObject({ seq: 2, ticker: 'HGLG11', priceCents: 16050, feesCents: 10 })
  expect(p.notes[1].note).toMatchObject({ number: '1002', broker: 'INTER', sourceKey: 'planilha:INTER:1002:2024-02-01' })
  expect(p.notes[1].trades[0]).toMatchObject({ side: 'V', feesCents: 100, irrfCents: 3 })
})

test('linhas com tipo desconhecido ou sem data vão para ignored', () => {
  const p = parsePlanilha(makePlanilha({ notas: [
    nota({}), nota({ tipo: 'Opção', ticker: 'PETRA1' }),
    nota({ nota: '', corretora: 'BTG', pregao: null, liquidacao: null, ticker: 'PETR3' }),
  ] }))
  expect(p.notes).toHaveLength(1)
  expect(p.notes[0].trades).toHaveLength(1)
  expect(p.ignored.some(m => m.includes('PETRA1') && m.includes('Opção'))).toBe(true)
  expect(p.ignored.some(m => m.includes('PETR3') && m.includes('sem data'))).toBe(true)
})

test('linhas com data mas sem número de nota viram uma nota de número vazio', () => {
  const p = parsePlanilha(makePlanilha({ notas: [nota({ nota: '' }), nota({ nota: '', ticker: 'WEGE3' })] }))
  expect(p.notes).toHaveLength(1)
  expect(p.notes[0].note).toMatchObject({ number: '', broker: 'CLEAR', tradeDate: '2024-01-05', sourceKey: 'planilha:CLEAR::2024-01-05' })
  expect(p.notes[0].trades.map(t => t.ticker)).toEqual(['ITSA4', 'WEGE3'])
})

test('grade de rendimentos vira proventos por mês', () => {
  const p = parsePlanilha(makePlanilha({
    rendimentos: {
      2023: [
        { label: 'Dividendos Ações', rows: [['ITSA4', null, 1.5, ...Array(10).fill(null)]] },
        { label: 'JCP Ações', rows: [['ITSA4', ...Array(11).fill(null), 2]] },
        { label: 'FIIs', rows: [['HGLG11', 1.1, 0, 1.2, ...Array(9).fill(null)]] },
      ],
    },
  }))
  expect(p.dividends).toEqual([
    { ticker: 'ITSA4', kind: 'Dividendo', payDate: '2023-02-01', amountCents: 150, broker: null, source: 'planilha', sourceKey: 'planilha:ITSA4:2023-02:Dividendo' },
    { ticker: 'ITSA4', kind: 'JCP', payDate: '2023-12-01', amountCents: 200, broker: null, source: 'planilha', sourceKey: 'planilha:ITSA4:2023-12:JCP' },
    { ticker: 'HGLG11', kind: 'Rendimento', payDate: '2023-01-01', amountCents: 110, broker: null, source: 'planilha', sourceKey: 'planilha:HGLG11:2023-01:Rendimento' },
    { ticker: 'HGLG11', kind: 'Rendimento', payDate: '2023-03-01', amountCents: 120, broker: null, source: 'planilha', sourceKey: 'planilha:HGLG11:2023-03:Rendimento' },
  ])
})

test('FII num bloco "Dividendos" genérico vira Rendimento pelo tipo das notas', () => {
  const p = parsePlanilha(makePlanilha({
    notas: [nota({ ticker: 'MXRF11', tipo: 'FII' })],
    rendimentos: { 2025: [{ label: 'Dividendos', rows: [['MXRF11', 1, ...Array(11).fill(null)], ['WEGE3', 2, ...Array(11).fill(null)]] }] },
  }))
  expect(p.dividends.map(d => [d.ticker, d.kind])).toEqual([['MXRF11', 'Rendimento'], ['WEGE3', 'Dividendo']])
})

test('Visão Geral: renda fixa vira ativo manual e Dólar/BTC entram no resumo', () => {
  const p = parsePlanilha(makePlanilha(base))
  expect(p.manualAssets).toEqual([
    expect.objectContaining({ name: 'Tesouro Selic', assetClass: 'renda_fixa', valueCents: 123456, quoteSymbol: null, quantity: null, sourceKey: 'planilha:visao-geral:Tesouro Selic' }),
    expect.objectContaining({ name: 'Pré Fixado', assetClass: 'renda_fixa', valueCents: 51000, sourceKey: 'planilha:visao-geral:Pré Fixado' }),
  ])
  expect(p.ignored).toContain('Dólar e BTC: lance a quantidade em Carteira › Ativos manuais')
})

test('importar duas vezes não duplica', async () => {
  const db = createTestDb(); const p = parsePlanilha(makePlanilha(base))
  expect(await importPlanilha(db, p)).toEqual({ notes: 2, notesSkipped: 0, dividends: 1, dividendsSkipped: 0, manualAssets: 2 })
  expect(await importPlanilha(db, p)).toEqual({ notes: 0, notesSkipped: 2, dividends: 0, dividendsSkipped: 1, manualAssets: 0 })
  const d = await loadAll(db)
  expect([d.notes.length, d.trades.length, d.dividends.length, d.manualAssets.length]).toEqual([2, 3, 1, 2])
})

test('aba faltando entra no resumo, sem erro', () => {
  const p = parsePlanilha(makePlanilha({ notas: [nota({})] }))
  expect(p.notes).toHaveLength(1)
  expect(p.ignored).toEqual(expect.arrayContaining([expect.stringContaining('Rendimentos'), expect.stringContaining('Visão Geral')]))
  const vazia = parsePlanilha(makePlanilha({ visaoGeral: [] }))
  expect(vazia.notes).toEqual([])
  expect(vazia.ignored).toEqual(expect.arrayContaining([expect.stringContaining('Notas')]))
})

test('ticker com dois tipos usa o mais frequente e entra em typeConflicts', () => {
  const p = parsePlanilha(makePlanilha({
    notas: [
      nota({ ticker: 'HGLG11', tipo: 'FII' }),
      nota({ nota: 1002, ticker: 'HGLG11', tipo: 'ETF', corretora: 'BTG' }),
      nota({ nota: 1003, ticker: 'HGLG11F', tipo: 'FII', pregao: '2024-03-01' }),
      nota({ nota: 1003, ticker: 'ITSA4', pregao: '2024-03-01' }),
    ],
  }))
  expect(p.notes.flatMap(n => n.trades).map(t => [t.ticker, t.assetType])).toEqual([['HGLG11', 'FII'], ['HGLG11', 'FII'], ['HGLG11', 'FII'], ['ITSA4', 'Ação']])
  expect(p.typeConflicts).toEqual(['HGLG11'])
})
