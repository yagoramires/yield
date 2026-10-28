import { describe, expect, it } from 'vitest'
import type { Category, Txn } from '../db/gastosRepo'
import { detectSubscriptions } from './assinaturas'

const txn = (o: Partial<Txn>): Txn => ({ id: 't', accountId: 'c1', date: '2026-07-05', description: 'NETFLIX', amountCents: -3990, pending: false, installment: null, operationType: null, fingerprint: 'fp', sourceKey: 's', ...o })
const semCat = () => null
const netflix = [txn({ date: '2026-07-05' }), txn({ date: '2026-08-05' }), txn({ date: '2026-09-05' })]

describe('detectSubscriptions', () => {
  it('três cobranças mensais viram assinatura com próxima data', () => {
    const [s] = detectSubscriptions(netflix, semCat, [], '2026-09-20')
    expect(s).toMatchObject({ merchantKey: 'c1|netflix', name: 'NETFLIX', period: 'mensal', amountCents: 3990, monthlyCents: 3990, yearlyCents: 47880, lastDate: '2026-09-05', nextDate: '2026-10-05', active: true, charges: 3 })
  })
  it('cobrança do mês ainda pendente no cartão: já cobrou, a próxima vai para o mês seguinte', () => {
    const t = [...netflix, txn({ date: '2026-10-05', pending: true }), txn({ date: '2026-10-02', amountCents: -8790, pending: true })]
    const [s] = detectSubscriptions(t, semCat, [], '2026-10-20')
    expect(s).toMatchObject({ lastDate: '2026-10-05', nextDate: '2026-11-05', charges: 3, amountCents: 3990 })
  })
  it('compra pendente parecida longe da data esperada não conta como a cobrança do mês', () => {
    const [s] = detectSubscriptions([...netflix, txn({ date: '2026-09-12', pending: true })], semCat, [], '2026-09-20')
    expect(s).toMatchObject({ lastDate: '2026-09-05', nextDate: '2026-10-05' })
  })
  it('aumento de até 15% continua assinatura e usa a última cobrança', () => {
    const t = [netflix[0], netflix[1], txn({ date: '2026-09-05', amountCents: -4490 })]
    expect(detectSubscriptions(t, semCat, [], '2026-09-20')[0].amountCents).toBe(4490)
  })
  it('parcelas nunca viram assinatura', () => {
    const t = netflix.map((n, i) => ({ ...n, installment: `${i + 1}/3` }))
    expect(detectSubscriptions(t, semCat, [], '2026-09-20')).toEqual([])
  })
  it('compras no mercado com valores diferentes não viram', () => {
    const t = [txn({ description: 'MERCADO', date: '2026-07-05', amountCents: -8000 }), txn({ description: 'MERCADO', date: '2026-08-04', amountCents: -23000 }), txn({ description: 'MERCADO', date: '2026-09-06', amountCents: -12000 })]
    expect(detectSubscriptions(t, semCat, [], '2026-09-20')).toEqual([])
  })
  it('próxima cobrança mensal limita ao último dia do mês', () => {
    const t = [txn({ date: '2025-11-30' }), txn({ date: '2025-12-31' }), txn({ date: '2026-01-31' })]
    expect(detectSubscriptions(t, semCat, [], '2026-02-01')[0].nextDate).toBe('2026-02-28')
  })
  it('anual: duas cobranças com ~1 ano', () => {
    const t = [txn({ description: 'SEGURO', date: '2025-03-10', amountCents: -120000 }), txn({ description: 'SEGURO', date: '2026-03-12', amountCents: -120000 })]
    expect(detectSubscriptions(t, semCat, [], '2026-06-01')[0]).toMatchObject({ period: 'anual', monthlyCents: 10000, yearlyCents: 120000, nextDate: '2027-03-12', active: true })
  })
  it('última cobrança há 60 dias fica inativa', () => {
    expect(detectSubscriptions(netflix, semCat, [], '2026-11-04')[0].active).toBe(false)
  })
  it('dispensada não aparece', () => {
    expect(detectSubscriptions(netflix, semCat, ['c1|netflix'], '2026-09-20')).toEqual([])
  })
  it('ignora receitas, pendentes e categorias que não contam como gasto', () => {
    const naoGasto: Category = { id: 'x', name: 'x', countsAsSpending: false, builtin: true, icon: null, color: null }
    expect(detectSubscriptions(netflix, () => naoGasto, [], '2026-09-20')).toEqual([])
    expect(detectSubscriptions(netflix.map(n => ({ ...n, pending: true })), semCat, [], '2026-09-20')).toEqual([])
    expect(detectSubscriptions(netflix.map(n => ({ ...n, amountCents: 3990 })), semCat, [], '2026-09-20')).toEqual([])
  })
  it('contas diferentes não se misturam e ordena por monthlyCents desc', () => {
    const outra = [txn({ description: 'SPOTIFY', date: '2026-07-01', amountCents: -2000 }), txn({ description: 'SPOTIFY', date: '2026-07-31', amountCents: -2000 }), txn({ description: 'SPOTIFY', date: '2026-08-30', amountCents: -2000 })]
    expect(detectSubscriptions([...outra, ...netflix], semCat, [], '2026-09-01').map(s => s.name)).toEqual(['NETFLIX', 'SPOTIFY'])
    expect(detectSubscriptions([...netflix.slice(0, 2), txn({ accountId: 'c2', date: '2026-09-05' })], semCat, [], '2026-09-20')).toEqual([])
  })
})

describe('previousAmountCents', () => {
  it('guarda o valor anterior quando a última cobrança subiu', () => {
    const subs = detectSubscriptions([...netflix.slice(0, 2), txn({ date: '2026-09-05', amountCents: -4490 })], semCat, [], '2026-09-20')
    expect(subs[0].previousAmountCents).toBe(3990)
  })
  it('é null quando o valor é estável', () => {
    expect(detectSubscriptions(netflix, semCat, [], '2026-09-20')[0].previousAmountCents).toBeNull()
  })
})
