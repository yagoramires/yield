import { expect, test } from 'vitest'
import { allocateFees, type NoteItemInput } from './fees'

const items: NoteItemInput[] = [
  { side: 'C', assetType: 'Ação', ticker: 'ITSA4', qty: 100, priceCents: 1000 }, // bruto 100000
  { side: 'C', assetType: 'FII', ticker: 'HGLG11', qty: 10, priceCents: 16000 }, // bruto 160000
  { side: 'V', assetType: 'FII', ticker: 'MXRF11', qty: 100, priceCents: 1000 }, // bruto 100000
]
const zero = { liquidacaoCents: 0, registroCents: 0, emolumentosCents: 0, operacionalCents: 0, issCents: 0, outrosCents: 0, irrfCents: 0 }

test('rateia por bruto, operacional igual, ISS sobre operacional e IRRF só nas vendas', () => {
  const r = allocateFees(items, { ...zero, liquidacaoCents: 90, operacionalCents: 300, issCents: 15, irrfCents: 5 })
  expect(r.map(x => x.feesCents)).toEqual([130, 145, 130])
  expect(r.map(x => x.irrfCents)).toEqual([0, 0, 5])
})
test('resto do arredondamento vai para a última linha', () => {
  const r = allocateFees(items, { ...zero, operacionalCents: 100, issCents: 10 })
  expect(r.map(x => x.feesCents)).toEqual([33 + 3, 33 + 3, 34 + 4])
})
test('IRRF entre duas vendas', () => {
  const sells: NoteItemInput[] = [
    { side: 'V', assetType: 'Ação', ticker: 'A', qty: 100, priceCents: 1000 },
    { side: 'V', assetType: 'Ação', ticker: 'B', qty: 100, priceCents: 2000 },
  ]
  expect(allocateFees(sells, { ...zero, irrfCents: 3 }).map(x => x.irrfCents)).toEqual([1, 2])
})
test('IRRF vai para a última venda mesmo com compra depois dela', () => {
  const mixed: NoteItemInput[] = [items[2], items[0]]
  expect(allocateFees(mixed, { ...zero, irrfCents: 5 }).map(x => x.irrfCents)).toEqual([5, 0])
})
test('nota sem vendas e com IRRF lança erro', () => {
  expect(() => allocateFees(items.slice(0, 2), { ...zero, irrfCents: 1 })).toThrow('IRRF sem venda na nota')
})
test('bruto total zero com taxa proporcional lança erro; sem taxa não', () => {
  const free: NoteItemInput[] = [{ side: 'C', assetType: 'Ação', ticker: 'A', qty: 0, priceCents: 0 }]
  expect(() => allocateFees(free, { ...zero, liquidacaoCents: 1 })).toThrow()
  expect(allocateFees(free, zero).map(x => x.feesCents)).toEqual([0])
})
test('soma exata com valores grandes (sem perda de precisão)', () => {
  const big: NoteItemInput[] = [
    { side: 'C', assetType: 'Ação', ticker: 'A', qty: 1_000_000, priceCents: 999_999 },
    { side: 'C', assetType: 'Ação', ticker: 'B', qty: 1_000_001, priceCents: 777_777 },
    { side: 'C', assetType: 'Ação', ticker: 'C', qty: 3, priceCents: 1 },
  ]
  const r = allocateFees(big, { ...zero, liquidacaoCents: 123_456_789 })
  expect(r.reduce((s, x) => s + x.feesCents, 0)).toBe(123_456_789)
})
