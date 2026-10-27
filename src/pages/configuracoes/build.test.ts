import { describe, expect, it, vi } from 'vitest'
import type { Dividend } from '../../domain/types'
import { b3Summary, planilhaReplacedByB3, planilhaSummary, refreshLine, restoreBackup } from './build'

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

describe('planilhaSummary', () => {
  it('contagens e avisos (conflitos de tipo primeiro)', () => {
    expect(planilhaSummary(
      { notes: 214, notesSkipped: 3, dividends: 412, dividendsSkipped: 0, manualAssets: 1 },
      { typeConflicts: ['HGLG11 aparece como FII e ETF; usei FII'], ignored: ['Notas, linha 9: sem data'] },
    )).toEqual({
      counts: '214 notas · 3 já existiam · 412 proventos · 0 pulados · 1 ativo manual',
      warnings: ['HGLG11 aparece como FII e ETF; usei FII', 'Notas, linha 9: sem data'],
    })
  })
})

describe('b3Summary', () => {
  it('contagens, eventos aplicados e o que revisar', () => {
    expect(b3Summary(
      {
        dividends: 38, dividendsSkipped: 5, replaced: 12, eventsSkipped: 1,
        applied: [
          { kind: 'bonificacao', ticker: 'ITSA4', date: '2024-04-20', qtyDelta: 160, unitCostCents: null, sourceKey: 'a' },
          { kind: 'grupamento', ticker: 'MGLU3', date: '2024-05-02', qtyDelta: -1000, sourceKey: 'b' },
          { kind: 'desdobramento', ticker: 'BBAS3', date: '2024-05-02', qtyDelta: 0.5, sourceKey: 'c' },
        ],
      },
      { ignored: 7, toReview: [{ date: '2024-06-10', movimentacao: 'Amortização', produto: 'HGLG11 - CSHG LOGISTICA FII' }] },
    )).toEqual({
      counts: '38 proventos · 12 substituíram os da planilha · 5 já existiam · 1 evento já existia · 7 movimentações ignoradas (negociações entram pelas notas)',
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
