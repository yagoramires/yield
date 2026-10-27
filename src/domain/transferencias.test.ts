import { describe, expect, it } from 'vitest'
import type { Account, Txn } from '../db/gastosRepo'
import { mentionsOwner, pairTransfers, validOwnerNames } from './transferencias'

const acc = (id: string, kind: Account['kind'] = 'conta'): Account => ({ id, source: 'pluggy', externalId: id, institution: id, name: id, kind, number: null, itemId: null, lastSyncAt: null })
const accounts = [acc('nu'), acc('itau'), acc('inter'), acc('cartao', 'cartao')]
let seq = 0
const t = (accountId: string, date: string, amountCents: number, o: Partial<Txn> = {}): Txn =>
  ({ id: `t${++seq}`, accountId, date, description: 'PIX', amountCents, pending: false, installment: null, operationType: null, fingerprint: `fp${seq}`, sourceKey: `s${seq}`, ...o })

describe('pairTransfers', () => {
  it('saída numa conta e entrada do mesmo valor noutra, até 3 dias, viram par', () => {
    const out = t('nu', '2026-10-01', -50000), inn = t('itau', '2026-10-03', 50000)
    const p = pairTransfers([out, inn], accounts, {})
    expect(p.get(out.id)).toEqual({ otherAccountId: 'itau', outgoing: true })
    expect(p.get(inn.id)).toEqual({ otherAccountId: 'nu', outgoing: false })
  })
  it('não casa: mesma conta, valor diferente, mais de 3 dias, cartão, já ajustado à mão', () => {
    const txns = [
      t('nu', '2026-10-01', -100), t('nu', '2026-10-01', 100),
      t('nu', '2026-10-01', -200), t('itau', '2026-10-01', 201),
      t('nu', '2026-10-01', -300), t('itau', '2026-10-05', 300),
      t('nu', '2026-10-01', -400), t('cartao', '2026-10-01', 400),
      t('nu', '2026-10-01', -500, { fingerprint: 'manual' }), t('itau', '2026-10-01', 500),
    ]
    expect(pairTransfers(txns, accounts, { manual: 'alimentacao' }).size).toBe(0)
  })
  it('com mais de um candidato fica o mais próximo na data, e cada lançamento entra em um par só', () => {
    const out1 = t('nu', '2026-10-05', -1000), out2 = t('nu', '2026-10-06', -1000)
    const far = t('itau', '2026-10-02', 1000), near = t('inter', '2026-10-05', 1000)
    const p = pairTransfers([far, near, out1, out2], accounts, {})
    expect(p.get(out1.id)?.otherAccountId).toBe('inter')
    expect(p.get(out2.id)).toBeUndefined() // far fica a 4 dias de out2
    expect(p.has(far.id)).toBe(false)
  })
  it('fatura e aplicação nunca entram em par', () => {
    const txns = [t('nu', '2026-10-01', -700, { operationType: 'PAGAMENTO_FATURA' }), t('itau', '2026-10-01', 700, { operationType: 'RESGATE_APLIC_FINANCEIRA' })]
    expect(pairTransfers(txns, accounts, {}).size).toBe(0)
  })
})

describe('nome do titular', () => {
  it('acha o nome na descrição sem acento nem caixa', () => {
    expect(mentionsOwner('Transferência enviada pelo Pix - YAGO RAMIRES DE SOUZA', ['Yago Ramires'])).toBe(true)
    expect(mentionsOwner('PIX RECEBIDO JOÃO SILVA', ['Yago Ramires', 'João Silva'])).toBe(true)
    expect(mentionsOwner('PIX ENVIADO YAGO', ['Yago Ramires'])).toBe(false)
    expect(mentionsOwner('qualquer coisa', [])).toBe(false)
  })
  it('validOwnerNames separa por vírgula e exige nome e sobrenome', () => {
    expect(validOwnerNames('Yago Ramires,  YAGO R M ')).toEqual({ names: ['Yago Ramires', 'YAGO R M'] })
    expect(validOwnerNames('')).toEqual({ names: [] })
    expect(validOwnerNames('Yago')).toEqual({ error: 'Use nome e sobrenome em cada variação ("Yago" é curto demais e pegaria Pix de outras pessoas).' })
  })
})
