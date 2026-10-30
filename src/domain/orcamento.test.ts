import { describe, expect, it } from 'vitest'
import type { BudgetLine, IncomeSource } from '../db/orcamentoRepo'
import { DEFAULT_PJ } from '../db/orcamentoRepo'
import type { Category, Txn } from '../db/gastosRepo'
import type { Subscription } from './assinaturas'
import { averageByCategory, blocoOf, copyLines, custos, goalsAt, goalsFor, investido, missingSources, monthSummary, nextMonthLines, withSources, pjNet, sourceNet, cltNet, cltTabelaAno, inssEmpregado, irrfMensal } from './orcamento'
import { suggestForMonth } from './sugestoes'

const line = (o: Partial<BudgetLine>): BudgetLine => ({ id: 'l', month: '2026-03', kind: 'saida', name: 'Item', amountCents: 1000, recurring: true, position: 0, categoryId: null, installmentCurrent: null, installmentTotal: null, sourceId: null, grupo: null, sourceKey: 'k', ...o })
const src = (o: Partial<IncomeSource> = {}): IncomeSource => ({ id: 's1', name: 'F', kind: 'pj', grossCents: 1_000_000, ...DEFAULT_PJ, contabilidadeCents: 30_000, netCents: null, dependents: 0, sourceKey: null, ...o })
const cat = (id: string, countsAsSpending = true): Category => ({ id, name: id, countsAsSpending, builtin: true, icon: null, color: null })
const cats: Record<string, Category> = { mercado: cat('mercado'), fatura: cat('pagamento-de-fatura', false) }
const txn = (o: Partial<Txn> & { cat?: string }): Txn => ({ id: 't', accountId: 'c1', date: '2026-03-10', description: 'LOJA', amountCents: -1000, pending: false, installment: null, operationType: null, fingerprint: 'fp', sourceKey: 's', ...o })
const catOf = (t: Txn) => cats[t.description] ?? null

describe('pjNet', () => {
  it('divide o bruto e fecha o líquido', () => {
    expect(pjNet(1_000_000, { ...DEFAULT_PJ, contabilidadeCents: 30_000 })).toEqual({ grossCents: 1_000_000, proLaboreCents: 280_000, irpjCents: 60_000, inssCents: 30_800, contabilidadeCents: 30_000, outrosCents: 0, dasCents: 0, netCents: 879_200 })
  })
  it('bruto ímpar fecha em centavos', () => {
    const b = pjNet(333_333, { ...DEFAULT_PJ, contabilidadeCents: 12_345, outrosCents: 99 })
    expect(b.irpjCents + b.inssCents + b.contabilidadeCents + b.outrosCents + b.netCents).toBe(333_333)
    expect(b.proLaboreCents).toBe(Math.round(333_333 * 0.28))
    expect(b.inssCents).toBe(Math.round(b.proLaboreCents * 0.11))
  })
})

describe('sourceNet', () => {
  it('pj usa pjNet; fixo usa o líquido informado', () => {
    expect(sourceNet(src())).toBe(879_200)
    expect(sourceNet(src({ kind: 'fixo', grossCents: null, netCents: 400_000 }))).toBe(400_000)
  })
  it('MEI: bruto menos o DAS fixo do mês e os outros descontos, sem pró-labore nem INSS', () => {
    const mei = src({ kind: 'mei', grossCents: 500_000, proLaborePct: 0, irpjPct: 0, inssPct: 0, contabilidadeCents: 0, outrosCents: 1_000, dasCents: 7_600 })
    expect(sourceNet(mei)).toBe(491_400)
    expect(pjNet(500_000, mei)).toMatchObject({ proLaboreCents: 0, inssCents: 0, dasCents: 7_600, netCents: 491_400 })
  })
})

describe('monthSummary', () => {
  it('soma entradas, saídas e saldo', () => {
    expect(monthSummary([line({ kind: 'entrada', amountCents: 5000 }), line({ amountCents: 1200 }), line({ amountCents: 300 })])).toEqual({ entradasCents: 5000, saidasCents: 1500, saldoCents: 3500 })
  })
})

describe('nextMonthLines', () => {
  it('só recorrentes; parcela avança; última sai; sourceKey nulo; posição mantida', () => {
    const out = nextMonthLines([
      line({ name: 'a', position: 0, installmentCurrent: 4, installmentTotal: 5 }),
      line({ name: 'b', position: 1, installmentCurrent: 5, installmentTotal: 5 }),
      line({ name: 'c', position: 2, recurring: false }),
      line({ name: 'd', position: 3 }),
    ], [])
    expect(out.map(l => [l.name, l.position, l.installmentCurrent, l.sourceKey])).toEqual([['a', 0, 5, null], ['d', 3, null, null]])
    expect(out[0]).not.toHaveProperty('id')
    expect(out[0]).not.toHaveProperty('month')
  })
  it('linha ligada a fonte recalcula pela fonte atual', () => {
    const l = line({ kind: 'entrada', sourceId: 's1', amountCents: 1 })
    expect(nextMonthLines([l], [src()])[0]).toMatchObject({ amountCents: 879_200, sourceId: 's1' })
    expect(nextMonthLines([l], [src({ irpjPct: 10 })])[0].amountCents).toBe(sourceNet(src({ irpjPct: 10 })))
    expect(nextMonthLines([l], [src({ kind: 'fixo', netCents: 123 })])[0].amountCents).toBe(123)
  })
  it('fonte que sumiu: mantém o valor e solta o vínculo', () => {
    const l = line({ kind: 'entrada', sourceId: 'x', amountCents: 555 })
    expect(nextMonthLines([l], [src()])[0]).toMatchObject({ amountCents: 555, sourceId: null })
  })
  it('chave de sugestão vai junto com o mês novo; chave da planilha vira nula', () => {
    const out = nextMonthLines([line({ sourceKey: 'sub:c1|netflix@2026-03' }), line({ sourceKey: 'parc:c1|loja|10|100@2026-03' }), line({ sourceKey: 'planilha:2026-03:3' })], [])
    expect(out.map(l => l.sourceKey)).toEqual(['sub:c1|netflix@2026-04', 'parc:c1|loja|10|100@2026-04', null])
  })
  it('assinatura copiada esconde a sugestão no mês novo', () => {
    const s: Subscription = { merchantKey: 'c1|netflix', name: 'NETFLIX', accountId: 'c1', period: 'mensal', amountCents: 3990, monthlyCents: 3990, yearlyCents: 47880, lastDate: '2026-03-05', nextDate: '2026-04-05', active: true, charges: 3, previousAmountCents: null }
    const [copied] = nextMonthLines([line({ sourceKey: suggestForMonth('2026-03', [s], [], () => null, [], [])[0].key })], [])
    expect(suggestForMonth('2026-04', [s], [], () => null, [{ ...copied, id: 'n', month: '2026-04' }], [])).toEqual([])
  })
  it('parcela 4/10 aceita vira 5/10 no mês seguinte e esconde a sugestão 5/10', () => {
    const t = [txn({ date: '2026-02-10', description: 'LOJA X', amountCents: -10000, installment: '3/10' })]
    const [sug] = suggestForMonth('2026-03', [], t, () => null, [], [])
    expect(sug.installmentCurrent).toBe(4)
    const [copied] = nextMonthLines([line({ sourceKey: sug.key, installmentCurrent: 4, installmentTotal: 10 })], [])
    expect(copied.installmentCurrent).toBe(5)
    expect(suggestForMonth('2026-04', [], t, () => null, [{ ...copied, id: 'n', month: '2026-04' }], [])).toEqual([])
    expect(suggestForMonth('2026-04', [], t, () => null, [], [])[0].installmentCurrent).toBe(5)
  })
})

describe('copyLines', () => {
  it('copiar de 3 meses antes avança a parcela 3 vezes e larga as que já acabaram', () => {
    const out = copyLines([
      line({ name: 'a', installmentCurrent: 2, installmentTotal: 10, sourceKey: 'parc:k@2026-03' }),
      line({ name: 'b', installmentCurrent: 8, installmentTotal: 10 }),
      line({ name: 'c' }),
    ], [], '2026-06')
    expect(out.map(l => [l.name, l.installmentCurrent, l.sourceKey])).toEqual([['a', 5, 'parc:k@2026-06'], ['c', null, null]])
  })
})

describe('CLT 2026', () => {
  it('INSS progressivo por faixa, centavo truncado, e limitado ao teto', () => {
    expect(inssEmpregado(150000)).toBe(11250) // só a 1ª faixa: 7,5%
    expect(inssEmpregado(300000)).toBe(24859) // 121,575 + 115,3656 + 11,6592 = 248,5998
    expect(inssEmpregado(1000000)).toBe(98809) // acima do teto de 8.475,55 paga o máximo
  })
  it('IRRF bate com os exemplos da Receita para a Lei 15.270/2025', () => {
    expect(irrfMensal(303600, 25773, 0)).toBe(0) // desconto simplificado, 1ª faixa
    expect(irrfMensal(400000, 37341, 0)).toBe(0) // até 5 mil: redução zera
    expect(irrfMensal(500000, 50960, 0)).toBe(0)
    expect(irrfMensal(600000, 64960, 0)).toBe(38288) // 562,63 − 179,75
    expect(irrfMensal(800000, 80000, 0)).toBe(Math.round((800000 - 80000) * 0.275 - 90873)) // acima de 7.350 sem redução
  })
  it('dependentes entram nas deduções legais quando passam do desconto simplificado', () => {
    expect(irrfMensal(800000, 80000, 2)).toBe(Math.round((800000 - 80000 - 2 * 18959) * 0.275 - 90873))
  })
  it('líquido = bruto − INSS − IRRF − outros descontos; FGTS 8% é só informativo', () => {
    const b = cltNet(600000, 0, 15000)
    expect(b.inssCents).toBe(inssEmpregado(600000))
    expect(b.irrfCents).toBe(irrfMensal(600000, b.inssCents, 0))
    expect(b.netCents).toBe(600000 - b.inssCents - b.irrfCents - 15000)
    expect(b.fgtsCents).toBe(48000)
  })
})

describe('tabelas CLT por ano', () => {
  it('ano com tabela usa a dele; ano sem tabela usa a mais recente conhecida', () => {
    expect(cltTabelaAno(2026)).toBe(2026)
    expect(cltTabelaAno(2027)).toBe(2026)
    expect(cltTabelaAno(2024)).toBe(2026) // não há tabela mais antiga no app
  })
  it('o ano escolhe a tabela no cálculo', () => {
    expect(inssEmpregado(300000, 2027)).toBe(inssEmpregado(300000, 2026))
    expect(cltNet(600000, 0, 0, 2030)).toEqual(cltNet(600000, 0, 0, 2026))
  })
  it('sourceNet de CLT usa o ano do mês informado', () => {
    const s = src({ kind: 'clt', grossCents: 600000 })
    expect(sourceNet(s, '2027-03')).toBe(cltNet(600000, 0, 0, 2026).netCents)
  })
})

describe('blocos', () => {
  it('n/total é parcela; sem grupo (linha antiga) é custo fixo', () => {
    expect([line({ installmentCurrent: 2, installmentTotal: 5, grupo: 'variavel' }), line({ grupo: 'meta' }), line({})].map(blocoOf)).toEqual(['parcela', 'meta', 'fixo'])
  })
})

describe('fontes de renda no mês', () => {
  it('falta a fonte sem entrada ligada; mês novo nasce com ela pelo líquido do mês, depois das copiadas', () => {
    const a = src(), b = src({ id: 's2', name: 'G', kind: 'fixo', netCents: 50_000 })
    const lines = [line({ kind: 'entrada', sourceId: 's1' }), line({ sourceId: 's2' /* saída não conta */ })]
    expect(missingSources(lines, [a, b]).map(s => s.id)).toEqual(['s2'])
    const out = withSources([{ ...line({}), id: undefined, month: undefined }].map(({ id: _i, month: _m, ...l }) => l), [a, b], '2026-04')
    expect(out.map(l => [l.kind, l.name, l.amountCents, l.sourceId, l.position])).toEqual([['saida', 'Item', 1000, null, 0], ['entrada', 'F', sourceNet(a, '2026-04'), 's1', 1], ['entrada', 'G', 50_000, 's2', 2]])
  })
  it('fonte com líquido zerado não entra sozinha', () => {
    expect(withSources([], [src({ kind: 'fixo', netCents: 0 })], '2026-04')).toEqual([])
  })
})

describe('metas', () => {
  it('vale do mês dela em diante; mudar depois não reescreve o passado; null desliga', () => {
    const goals = [
      { month: '2026-01', key: 'cat:mercado', amountCents: 100 },
      { month: '2026-03', key: 'cat:mercado', amountCents: 150 },
      { month: '2026-02', key: 'investir', amountCents: 500 },
      { month: '2026-04', key: 'investir', amountCents: null },
    ]
    expect([...goalsAt(goals, '2026-01')]).toEqual([['cat:mercado', 100]])
    expect(Object.fromEntries(goalsAt(goals, '2026-02'))).toEqual({ 'cat:mercado': 100, investir: 500 })
    expect(Object.fromEntries(goalsAt(goals, '2026-09'))).toEqual({ 'cat:mercado': 150 })
  })
})

describe('custos', () => {
  it('gasto do mês por categoria, sem parcela, assinatura aceita nem conta fixa paga pelo banco; meta da categoria aparece mesmo sem gasto', () => {
    const lines = [
      line({ id: 's', sourceKey: 'sub:c1|mercado@2026-03' }),
      line({ id: 'f', name: 'Aluguel', amountCents: 100_000, categoryId: 'mercado', grupo: 'fixo' }),
      line({ id: 'm', name: 'Feira em dinheiro', amountCents: 2000, grupo: 'variavel' }),
      line({ id: 'p', sourceKey: 'parc:c2|mercado|10|300@2026-03', installmentCurrent: 4, installmentTotal: 10, amountCents: 300 }),
      line({ id: 'd', name: 'Diarista', amountCents: 20_000, categoryId: 'mercado', grupo: 'fixo' }),
    ]
    const txns = [
      txn({ id: '1', description: 'mercado', amountCents: -5000 }), // assinatura c1|mercado
      txn({ id: '2', accountId: 'c2', description: 'mercado', amountCents: -300, installment: '4/10' }),
      txn({ id: '3', accountId: 'c2', description: 'mercado', amountCents: -101_000 }), // a conta fixa (1% de diferença)
      txn({ id: '4', accountId: 'c2', description: 'mercado', amountCents: -700 }),
      txn({ id: '6', accountId: 'c2', description: 'PIX MARIA', amountCents: -20_000 }), // sem categoria: a diarista paga por Pix
      txn({ id: '7', accountId: 'c2', description: 'sem categoria', amountCents: -50, installment: '1/2' }), // parcela fora do plano conta
      txn({ id: '5', accountId: 'c2', description: 'mercado', amountCents: -900, date: '2026-04-01' }),
    ]
    const r = custos(lines, txns, catOf, '2026-03', new Map([['cat:mercado', 1000], ['cat:lazer', 400]]), new Set())
    expect(r.variaveis.map(({ txns, ...x }) => ({ ...x, txns: txns.map(t => t.id) }))).toEqual([
      { categoryId: 'mercado', realCents: 700, goalCents: 1000, txns: ['4'] }, { categoryId: null, realCents: 50, goalCents: null, txns: ['7'] }, { categoryId: 'lazer', realCents: 0, goalCents: 400, txns: [] },
    ])
    expect([r.manual.map(l => l.id), r.realCents, r.goalCents]).toEqual([['m'], 2750, null])
    expect(custos([], txns, catOf, '2026-03', new Map([['cat:mercado', 1000], ['variaveis', 5000]]), new Set()).goalCents).toBe(5000)
    // quem pagou cada linha: a assinatura pelo comerciante, a parcela pela chave, a conta fixa pelo valor (a diarista, por Pix)
    expect(Object.fromEntries([...r.paid].map(([l, t]) => [l, t.id]))).toEqual({ s: '1', p: '2', f: '3', d: '6' })
  })
  it('categoria fixa sai dos variáveis e vai para os fixos (o que saiu fora do plano)', () => {
    const txns = [txn({ id: 'a', description: 'mercado', amountCents: -700 }), txn({ id: 'b', description: 'PIX', amountCents: -30 })]
    const r = custos([], txns, catOf, '2026-03', new Map(), new Set(['mercado']))
    expect([r.fixas.map(x => x.categoryId), r.fixasCents, r.variaveis.map(x => x.categoryId), r.realCents]).toEqual([['mercado'], 700, [null], 30])
  })
})

describe('investido', () => {
  it('o que saiu na categoria Investimento no mês mais as linhas à mão; meta do bloco', () => {
    const inv: Record<string, Category> = { aporte: cat('investimento', false) }
    const txns = [txn({ description: 'aporte', amountCents: -30_000 }), txn({ description: 'aporte', amountCents: 5000 }), txn({ description: 'aporte', amountCents: -1, date: '2026-04-02' })]
    const r = investido([line({ grupo: 'meta', amountCents: 2000 })], txns, t => inv[t.description] ?? null, '2026-03', new Map([['investir', 50_000]]))
    expect([r.fromTxnsCents, r.realCents, r.goalCents, r.txns.length]).toEqual([30_000, 32_000, 50_000, 1])
  })
  it('categoria criada que não conta como gasto (uma reserva) também é investimento; fatura e transferência não', () => {
    const cs: Record<string, Category> = { reserva: { ...cat('reserva', false), builtin: false }, fatura: cat('pagamento-de-fatura', false) }
    const txns = [txn({ description: 'reserva', amountCents: -700 }), txn({ description: 'fatura', amountCents: -900 })]
    expect(investido([], txns, t => cs[t.description] ?? null, '2026-03', new Map()).fromTxnsCents).toBe(700)
  })
})

describe('goalsFor', () => {
  it('sem plano no mês não há meta; meta de categoria apagada ou fora do gasto some', () => {
    const goals = [{ month: '2026-01', key: 'cat:mercado', amountCents: 100 }, { month: '2026-01', key: 'cat:velha', amountCents: 5 }, { month: '2026-01', key: 'cat:pagamento-de-fatura', amountCents: 5 }, { month: '2026-01', key: 'investir', amountCents: 9 }]
    const cats = [cat('mercado'), cat('pagamento-de-fatura', false)]
    expect(goalsFor(goals, ['2026-02'], '2026-03', cats).size).toBe(0)
    expect(Object.fromEntries(goalsFor(goals, ['2026-03'], '2026-03', cats))).toEqual({ 'cat:mercado': 100, investir: 9 })
  })
})

describe('averageByCategory', () => {
  it('média dos 3 meses anteriores, sem o mês atual', () => {
    const txns = [txn({ description: 'mercado', date: '2026-02-10', amountCents: -900 }), txn({ description: 'mercado', date: '2026-01-10', amountCents: -300 }), txn({ description: 'mercado', date: '2026-03-10', amountCents: -99_999 })]
    expect([...averageByCategory(txns, catOf, '2026-03')]).toEqual([['mercado', 400]])
  })
})
