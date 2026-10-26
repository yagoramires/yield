import { describe, expect, it } from 'vitest'
import type { NoteDraft } from '../../import/clearPdf'
import { buildEvent, buildNote, draftToSave, formFromNote, noteNet, parseMoney, parsePosInt, emptyForm } from './build'

const base = () => ({ ...emptyForm(), number: '8812', broker: 'clear', tradeDate: '2026-10-14', settleDate: '2026-10-16', items: [{ side: 'C' as const, assetType: 'Ação' as const, ticker: ' itsa4 ', qty: '200', price: '10,80' }] })

describe('validação de campos', () => {
  it('quantidade: só inteiro positivo', () => {
    expect(parsePosInt('200', 'Qtd')).toBe(200)
    for (const t of ['0', '1,5', '1.5', '-3', 'abc', '']) expect(() => parsePosInt(t, 'Qtd')).toThrow(/Qtd/)
  })
  it('dinheiro: rejeita texto e ponto decimal, aceita milhar', () => {
    expect(parseMoney('1.234,56', 'Preço')).toBe(123456)
    expect(parseMoney('10', 'Preço')).toBe(1000)
    expect(parseMoney('', 'Taxa', false)).toBe(0)
    for (const t of ['abc', '29.05', '1,234', '-1']) expect(() => parseMoney(t, 'Preço')).toThrow(/Preço/)
    expect(() => parseMoney('0', 'Preço')).toThrow(/maior que zero/)
  })
})

describe('buildNote', () => {
  it('nota manual: normaliza, rateia e monta sourceKey', () => {
    const f = base(); f.fees.operacionalCents = '1,00'
    const { note, trades } = buildNote(f, 'manual')
    expect(note).toMatchObject({ number: '8812', broker: 'CLEAR', source: 'manual', sourceKey: 'manual:CLEAR:8812:2026-10-14', label: null })
    expect(trades).toEqual([{ seq: 1, side: 'C', assetType: 'Ação', ticker: 'ITSA4', qty: 200, priceCents: 1080, feesCents: 100, irrfCents: 0 }])
  })
  it('erros em pt-BR: sem itens, qtd fracionada, IRRF sem venda, data', () => {
    expect(() => buildNote({ ...base(), items: [] }, 'manual')).toThrow(/ao menos um item/)
    const frac = base(); frac.items[0].qty = '1,5'
    expect(() => buildNote(frac, 'manual')).toThrow(/Qtd/)
    const irrf = base(); irrf.fees.irrfCents = '1,00'
    expect(() => buildNote(irrf, 'manual')).toThrow(/IRRF/)
    expect(() => buildNote({ ...base(), tradeDate: '2026-02-31' }, 'manual')).toThrow(/Pregão/)
    expect(() => buildNote({ ...base(), number: '' }, 'manual')).toThrow(/Nº/)
  })
  it('sem nota: número gerado, label = motivo, sem taxas, uma compra', () => {
    const f = { ...base(), number: '', label: 'IPO ACME3' }; f.fees.operacionalCents = '5,00'
    const { note, trades } = buildNote(f, 'sem_nota')
    expect(note.number).toMatch(/^sem-nota-[0-9a-f]{8}$/)
    expect(note).toMatchObject({ source: 'sem_nota', sourceKey: null, label: 'IPO ACME3', settleDate: '2026-10-14' })
    expect(trades[0]).toMatchObject({ side: 'C', feesCents: 0, irrfCents: 0 })
    expect(() => buildNote({ ...f, label: ' ' }, 'sem_nota')).toThrow(/motivo/)
  })
  it('edição mantém origem e número de nota não manual', () => {
    const { note } = buildNote({ ...base(), number: '', label: 'IPO' }, 'sem_nota', { number: 'sem-nota-abcd1234', source: 'sem_nota', sourceKey: null })
    expect(note.number).toBe('sem-nota-abcd1234')
  })
  it('formFromNote soma as taxas em Outros e IRRF em IRRF', () => {
    const f = formFromNote(
      { id: 'n', number: '1', broker: 'CLEAR', tradeDate: '2026-01-02', settleDate: '2026-01-04', source: 'manual', sourceKey: null, label: null },
      [{ id: 't', noteId: 'n', seq: 1, broker: 'CLEAR', tradeDate: '', settleDate: '', side: 'V', assetType: 'FII', ticker: 'HGLG11', qty: 3, priceCents: 15000, feesCents: 120, irrfCents: 5 }])
    expect(f.fees).toMatchObject({ outrosCents: '1,20', irrfCents: '0,05', operacionalCents: '' })
    expect(f.items[0]).toEqual({ side: 'V', assetType: 'FII', ticker: 'HGLG11', qty: '3', price: '150,00' })
  })
})

describe('draftToSave', () => {
  const draft: NoteDraft = {
    number: '99', broker: 'CLEAR', tradeDate: '2026-10-14', settleDate: null,
    items: [{ side: 'C', spec: 'ITAUSA PN', ticker: null, assetType: null, qty: 10, priceCents: 1000 }],
    fees: { liquidacaoCents: 0, registroCents: 0, emolumentosCents: 0, operacionalCents: 0, issCents: 0, outrosCents: 0, irrfCents: 0 },
  }
  it('usa ticker/tipo resolvidos e sourceKey pdf', () => {
    const { note, trades } = draftToSave(draft, [{ ticker: 'itsa4', assetType: 'Ação' }])
    expect(note).toMatchObject({ source: 'pdf', sourceKey: 'pdf:CLEAR:99', settleDate: '2026-10-14' })
    expect(trades[0]).toMatchObject({ ticker: 'ITSA4', assetType: 'Ação', qty: 10 })
  })
  it('exige ticker e tipo', () => {
    expect(() => draftToSave(draft, [{ ticker: '', assetType: 'Ação' }])).toThrow(/ticker/)
    expect(() => draftToSave(draft, [{ ticker: 'ITSA4', assetType: '' }])).toThrow(/tipo/)
  })
})

describe('buildEvent', () => {
  it('grupamento guarda delta negativo; bonificação aceita custo vazio', () => {
    expect(buildEvent({ kind: 'grupamento', ticker: 'abev3', date: '2026-01-01', qty: '40', newTicker: '', unitCost: '' })).toEqual({ kind: 'grupamento', ticker: 'ABEV3', date: '2026-01-01', qtyDelta: -40 })
    expect(buildEvent({ kind: 'bonificacao', ticker: 'ITSA4', date: '2026-01-01', qty: '5', newTicker: '', unitCost: '' })).toMatchObject({ unitCostCents: null })
    expect(buildEvent({ kind: 'bonificacao', ticker: 'ITSA4', date: '2026-01-01', qty: '5', newTicker: '', unitCost: '2,50' })).toMatchObject({ unitCostCents: 250 })
    expect(buildEvent({ kind: 'mudanca_ticker', ticker: 'a', date: '2026-01-01', qty: '', newTicker: 'b', unitCost: '' })).toEqual({ kind: 'mudanca_ticker', ticker: 'A', newTicker: 'B', date: '2026-01-01' })
    expect(() => buildEvent({ kind: 'desdobramento', ticker: 'X', date: '2026-01-01', qty: '0', newTicker: '', unitCost: '' })).toThrow(/Qtd/)
  })
})

describe('noteNet', () => {
  it('venda − compra − taxas − IRRF', () => {
    const t = (side: 'C' | 'V', qty: number, priceCents: number, feesCents: number, irrfCents: number) => ({ side, qty, priceCents, feesCents, irrfCents })
    expect(noteNet([t('C', 10, 1000, 5, 0), t('V', 1, 5000, 2, 1)])).toBe(5000 - 10000 - 5 - 2 - 1)
  })
})
