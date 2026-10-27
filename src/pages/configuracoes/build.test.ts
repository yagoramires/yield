import { describe, expect, it, vi } from 'vitest'
import { loadOrcamento, type IncomeSource } from '../../db/orcamentoRepo'
import { createTestDb } from '../../db/testDb'
import type { Dividend } from '../../domain/types'
import { b3Summary, backupPasswordError, orcamentoImportSummary, parseItemId, planilhaReplacedByB3, refreshLine, typesToConfirm, typeMap, restoreBackup, saveSourceForm, validateSource } from './build'

const div = (ticker: string, payDate: string, source: Dividend['source'], sourceKey: string | null): Dividend =>
  ({ id: sourceKey ?? payDate, ticker, kind: 'Rendimento', payDate, amountCents: 100, broker: null, source, sourceKey })
const b3 = (ticker: string, payDate: string, sourceKey: string) => {
  const { id: _id, ...rest } = div(ticker, payDate, 'b3', sourceKey)
  return rest
}

describe('planilhaReplacedByB3', () => {
  const existing = [
    div('HGLG11', '2024-03-01', 'planilha', 'p1'),
    div('HGLG11', '2024-04-01', 'planilha', 'p2'),
    div('ITSA4', '2024-03-01', 'planilha', 'p3'),
    div('HGLG11', '2024-03-20', 'manual', null),
    div('BBAS3', '2024-05-10', 'b3', 'b3:ja'),
  ]
  it('conta os da planilha no mesmo ticker e mês de um provento novo da B3', () => {
    expect(planilhaReplacedByB3(existing, [b3('HGLG11', '2024-03-14', 'b3:a'), b3('HGLG11', '2024-03-28', 'b3:b')])).toBe(1)
    expect(planilhaReplacedByB3(existing, [b3('HGLG11', '2024-03-14', 'b3:a'), b3('ITSA4', '2024-03-15', 'b3:c')])).toBe(2)
  })
  it('provento da B3 já importado não substitui nada', () => {
    expect(planilhaReplacedByB3([...existing, div('ITSA4', '2024-03-15', 'b3', 'b3:c')], [b3('ITSA4', '2024-03-15', 'b3:c')])).toBe(0)
  })
  it('sem provento novo no mês, zero', () => {
    expect(planilhaReplacedByB3(existing, [b3('HGLG11', '2024-06-14', 'b3:d')])).toBe(0)
  })
})

describe('b3Summary', () => {
  it('contagens, eventos aplicados e o que revisar', () => {
    expect(b3Summary(
      {
        notes: 0, notesSkipped: 0, trades: 0, tradesSkipped: 0, dividends: 38, dividendsSkipped: 5, replaced: 12, eventsSkipped: 1,
        applied: [
          { kind: 'bonificacao', ticker: 'ITSA4', date: '2024-04-20', qtyDelta: 160, unitCostCents: null, sourceKey: 'a' },
          { kind: 'grupamento', ticker: 'MGLU3', date: '2024-05-02', qtyDelta: -1000, sourceKey: 'b' },
          { kind: 'desdobramento', ticker: 'BBAS3', date: '2024-05-02', qtyDelta: 0.5, sourceKey: 'c' },
        ],
      },
      { ignored: 7, toReview: [{ date: '2024-06-10', movimentacao: 'Amortização', produto: 'HGLG11 - CSHG LOGISTICA FII' }] },
    )).toEqual({
      counts: '38 proventos · 12 substituíram os da planilha · 5 já existiam · 1 evento já existia · 7 movimentações ignoradas (liquidações; as compras e vendas vêm do relatório de Negociação)',
      applied: ['ITSA4 bonificação +160 (20/04/2024)', 'MGLU3 grupamento −1000 (02/05/2024)', 'BBAS3 desdobramento +0,5 (02/05/2024)'],
      toReview: ['Amortização HGLG11 (10/06/2024)'],
    })
  })
})

describe('restoreBackup', () => {
  const steps = (fail: Partial<Record<'checkpoint' | 'swap' | 'reopen' | 'reload', boolean>> = {}) => {
    const f = (name: keyof typeof fail) => vi.fn(async () => { if (fail[name]) throw new Error(`${name} falhou`) })
    const swap = vi.fn(async () => { if (fail.swap) throw new Error('swap falhou'); return '/cfg/seguranca-1.db' })
    return { checkpoint: f('checkpoint'), close: vi.fn(async () => {}), swap, reopen: f('reopen'), reload: f('reload') }
  }
  it('sucesso: mensagem com o caminho da cópia de segurança', async () => {
    const s = steps()
    expect(await restoreBackup(s)).toEqual({ ok: true, message: 'Dados substituídos. A cópia de segurança dos dados anteriores está em /cfg/seguranca-1.db.' })
    expect(s.reload).toHaveBeenCalledOnce()
  })
  it('checkpoint falha: nada é fechado nem trocado', async () => {
    const s = steps({ checkpoint: true })
    expect(await restoreBackup(s)).toEqual({ ok: false, message: 'Não foi possível importar o backup: checkpoint falhou' })
    expect(s.close).not.toHaveBeenCalled(); expect(s.swap).not.toHaveBeenCalled(); expect(s.reopen).not.toHaveBeenCalled()
  })
  it('troca falha: reabre o banco antigo, sem cópia de segurança na mensagem', async () => {
    const s = steps({ swap: true })
    expect(await restoreBackup(s)).toEqual({ ok: false, message: 'Não foi possível importar o backup: swap falhou' })
    expect(s.reopen).toHaveBeenCalledOnce(); expect(s.reload).toHaveBeenCalledOnce()
  })
  it('reabrir falha depois da troca: diz que foi aplicado e dá o caminho da cópia', async () => {
    const s = steps({ reopen: true })
    const r = await restoreBackup(s)
    expect(r.ok).toBe(false)
    expect(r.message).toBe('O backup foi aplicado, mas houve um erro depois (reopen falhou). O banco não reabriu (reopen falhou): feche e abra o Yield. Seus dados anteriores estão em /cfg/seguranca-1.db.')
    expect(s.reopen).toHaveBeenCalledTimes(2)
  })
  it('recarregar falha depois da troca: diz que foi aplicado e dá o caminho da cópia', async () => {
    const s = steps({ reload: true })
    expect(await restoreBackup(s)).toEqual({ ok: false, message: 'O backup foi aplicado, mas houve um erro depois (reload falhou). Seus dados anteriores estão em /cfg/seguranca-1.db.' })
    expect(s.reopen).toHaveBeenCalledOnce()
  })
})

describe('refreshLine', () => {
  it('conta ok e falhas, listando as que falharam', () => {
    expect(refreshLine({ ok: ['ITSA4.SA', 'BBAS3.SA'], failed: [] })).toBe('2 ok · 0 falharam')
    expect(refreshLine({ ok: ['ITSA4.SA'], failed: ['XXXX3.SA', 'YYYY3.SA'] })).toBe('1 ok · 2 falharam (XXXX3.SA, YYYY3.SA)')
    expect(refreshLine({ ok: [], failed: ['XXXX3.SA'] })).toBe('0 ok · 1 falhou (XXXX3.SA)')
  })
})

describe('parseItemId', () => {
  const id = '3F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8'
  it('aceita UUID com espaços e devolve em minúsculas', () => {
    expect(parseItemId(`  ${id} `)).toBe(id.toLowerCase())
  })
  it.each(['', 'abc', '3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f', `${id}x`, '3f1a2b3c4d5e6f708192a3b4c5d6e7f8'])('recusa %j', text => {
    expect(() => parseItemId(text)).toThrow('itemId inválido: copie do painel da Pluggy')
  })
})

describe('validateSource', () => {
  const pj = { name: ' Empresa Alfa ', kind: 'pj' as const, gross: '15.000,00', proLabore: '28', irpj: '6', inss: '11', contabilidade: '300,00', outros: '150,00', net: '' }
  it('PJ ok: nome aparado, percentuais com vírgula, líquido fica nulo', () => {
    expect(validateSource(pj)).toEqual({ name: 'Empresa Alfa', kind: 'pj', grossCents: 1500000, netCents: null, proLaborePct: 28, irpjPct: 6, inssPct: 11, contabilidadeCents: 30000, outrosCents: 15000 })
    expect(validateSource({ ...pj, irpj: '6,5', contabilidade: '', outros: '0' })).toMatchObject({ irpjPct: 6.5, contabilidadeCents: 0, outrosCents: 0 })
  })
  it('exige nome', () => expect(() => validateSource({ ...pj, name: '  ' })).toThrow('Dê um nome para a fonte'))
  it('percentual fora de 0–100 ou não numérico', () => {
    for (const bad of ['120', 'abc', '-1', '']) expect(() => validateSource({ ...pj, inss: bad })).toThrow('Percentual inválido: use um número entre 0 e 100')
  })
  it('PJ sem bruto ou com líquido negativo', () => {
    expect(() => validateSource({ ...pj, gross: '' })).toThrow('Bruto')
    expect(() => validateSource({ ...pj, contabilidade: '20.000,00' })).toThrow('O líquido ficou negativo: confira os descontos')
  })
  it('fixo: só o líquido, PJ no padrão', () => {
    expect(validateSource({ ...pj, kind: 'fixo', net: '6.500,00' })).toEqual({ name: 'Empresa Alfa', kind: 'fixo', grossCents: null, netCents: 650000, proLaborePct: 28, irpjPct: 6, inssPct: 11, contabilidadeCents: 0, outrosCents: 0 })
    expect(() => validateSource({ ...pj, kind: 'fixo', net: '' })).toThrow('Líquido')
  })
})

describe('orcamentoImportSummary', () => {
  it('contagens e fonte criada', () => {
    expect(orcamentoImportSummary({ months: 11, lines: 186, skipped: 0 }, true)).toBe('11 meses · 186 linhas · 0 já existiam · 1 fonte de renda PJ criada')
    expect(orcamentoImportSummary({ months: 1, lines: 1, skipped: 2 }, false)).toBe('1 mês · 1 linha · 2 já existiam')
  })
})

describe('saveSourceForm', () => {
  it('se recalcular as entradas falhar, salvar de novo edita a mesma fonte em vez de criar outra', async () => {
    const db = createTestDb()
    const failing = { ...db, execute: (sql: string, p?: unknown[]) => (sql.startsWith('UPDATE budget_lines') ? Promise.reject(new Error('falhou')) : db.execute(sql, p)) }
    const v = validateSource({ name: 'Freela', kind: 'fixo', gross: '', proLabore: '', irpj: '', inss: '', contabilidade: '', outros: '', net: '1000' })
    let editing: IncomeSource | null = null
    await expect(saveSourceForm(failing, v, editing, '2026-10', s => { editing = s })).rejects.toThrow('falhou')
    expect(await saveSourceForm(db, v, editing, '2026-10', s => { editing = s })).toBe(0)
    expect((await loadOrcamento(db)).sources).toHaveLength(1)
  })
})

describe('tipos dos tickers da Negociação', () => {
  const p = { trades: [['HGLG11'], ['BOVA11'], ['ITSA4'], ['KNXX11'], ['HGLG11']].map(([ticker]) => ({ date: '2024-01-05', broker: 'CLEAR', side: 'C' as const, ticker, qty: 1, priceCents: 100 })), names: {}, dividends: [], events: [], ignored: 0, toReview: [] }
  const old = [{ id: 't', noteId: 'n', seq: 1, broker: 'CLEAR', tradeDate: '2023-01-02', settleDate: '2023-01-04', side: 'C' as const, assetType: 'ETF' as const, ticker: 'BOVA11', qty: 1, priceCents: 1, feesCents: 0, irrfCents: 0 }]
  it('pede confirmação só dos final 11 ainda sem operação, em ordem', () => {
    expect(typesToConfirm(p, old)).toEqual({ ask: [{ ticker: 'HGLG11', type: 'FII' }, { ticker: 'KNXX11', type: 'FII' }], inferred: [] })
  })
  it('deduz pelo nome do produto e pelos proventos; só pergunta o resto', () => {
    const trades = ['HGLG11', 'IVVB11', 'TAXX11', 'KNXX11', 'SAPR11', 'AUXX11'].map(ticker => ({ ...p.trades[0], ticker }))
    const names = { HGLG11: 'CSHG LOGÍSTICA FDO INV IMOB - FII', IVVB11: 'ISHARES S&P 500 FDO INV COTAS FDO INDICE', TAXX11: 'COMPANHIA TESTE DE ENERGIA S/A' }
    const dividends = [{ ticker: 'KNXX11', kind: 'Rendimento' as const }, { ticker: 'SAPR11', kind: 'JCP' as const }]
    expect(typesToConfirm({ ...p, trades, names }, [], dividends)).toEqual({
      ask: [{ ticker: 'AUXX11', type: 'ETF' }],
      inferred: [{ ticker: 'HGLG11', type: 'FII' }, { ticker: 'IVVB11', type: 'ETF' }, { ticker: 'KNXX11', type: 'FII' }, { ticker: 'SAPR11', type: 'Ação' }, { ticker: 'TAXX11', type: 'Ação' }],
    })
  })
  it('o tipo já usado nas operações vence o da tela', () => {
    expect(typeMap(old, [{ ticker: 'BOVA11', type: 'FII' }, { ticker: 'HGLG11', type: 'Ação' }])).toEqual(new Map([['BOVA11', 'ETF'], ['HGLG11', 'Ação']]))
  })
})

describe('b3Summary com operações', () => {
  it('conta operações, dias e o que já estava em nota', () => {
    expect(b3Summary(
      { notes: 3, notesSkipped: 1, trades: 12, tradesSkipped: 2, dividends: 0, dividendsSkipped: 0, replaced: 0, eventsSkipped: 0, applied: [] },
      { ignored: 0, toReview: [] },
    ).counts).toBe('12 operações em 3 dias · 1 dia já existia · 2 operações já estavam em notas · 0 proventos · 0 já existiam')
  })
})

it('backupPasswordError: 8+ caracteres e confirmação igual', () => {
  expect(backupPasswordError('curta', 'curta')).toBe('Use uma senha com pelo menos 8 caracteres.')
  expect(backupPasswordError('senha-boa-1', 'senha-boa-2')).toBe('As duas senhas não são iguais.')
  expect(backupPasswordError('senha-boa-1', 'senha-boa-1')).toBeNull()
})
