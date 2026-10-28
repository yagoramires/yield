import { describe, expect, it } from 'vitest'
import type { Account, Txn } from '../db/gastosRepo'
import { ownerMention, pairTransfers, validCompanyNames, validOwnerNames } from './transferencias'

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
  it('acha o nome na descrição sem acento nem caixa e separa você da sua empresa', () => {
    const me = ['Ana Teste Souza']
    expect(ownerMention('Transferência enviada pelo Pix - ANA TESTE SOUZA', me)).toBe('pessoa')
    expect(ownerMention('Pix recebido de Ana Teste Souza', me)).toBe('pessoa')
    // sem a empresa configurada, nenhum sufixo vira empresa
    expect(ownerMention('Transferência Recebida|ANA TESTE SOUZA DESENVOLVIMENTO DE SOFTWARE', me)).toBe('pessoa')
    expect(ownerMention('PIX RECEBIDO ANA TESTE SOUZA LTDA', me)).toBe('pessoa')
    expect(ownerMention('PIX RECEBIDO JOÃO SILVA', ['Ana Teste Souza', 'João Silva'])).toBe('pessoa')
    expect(ownerMention('PIX ENVIADO ANA', me)).toBeNull()
    // o nome do banco depois de um separador não faz o titular virar empresa
    expect(ownerMention('Transferência recebida pelo Pix - ANA TESTE SOUZA - •••.123.456-•• - BCO EXEMPLO S.A. (0237)', me)).toBe('pessoa')
    expect(ownerMention('PIX RECEBIDO - REM  Ana Teste Souza  03/03 - DOCTO: 123 PAGAMENTOS DIGITAL', me)).toBe('pessoa')
    expect(ownerMention('qualquer coisa', [])).toBeNull()
  })
  it('a empresa é a que você configurou, pelo nome ou pelo CNPJ', () => {
    const me = ['Ana Teste Souza'], pj = ['Ana Teste Odontologia', '11.222.333/0001-81']
    expect(ownerMention('PIX RECEBIDO ANA TESTE ODONTOLOGIA LTDA', me, pj)).toBe('empresa')
    expect(ownerMention('Pix recebido de Ana Teste Odontologia', [], pj)).toBe('empresa')
    expect(ownerMention('TED RECEBIDA 11222333000181 CLINICA SORRISO', me, pj)).toBe('empresa')
    expect(ownerMention('PIX RECEBIDO 11.222.333/0001-81', me, pj)).toBe('empresa')
    expect(ownerMention('PIX RECEBIDO ANA TESTE SOUZA', me, pj)).toBe('pessoa')
    // nome parecido não basta: precisa das palavras inteiras
    expect(ownerMention('PIX RECEBIDO ANA TESTE ODONTOLOGICA', [], ['Ana Teste Odonto'])).toBeNull()
    expect(ownerMention('PIX RECEBIDO BANCO LARANJA', me, pj)).toBeNull()
  })
  it('validCompanyNames aceita nome com duas palavras ou CNPJ de 14 dígitos', () => {
    expect(validCompanyNames('Ana Teste Odontologia, 11.222.333/0001-81')).toEqual({ names: ['Ana Teste Odontologia', '11.222.333/0001-81'] })
    expect(validCompanyNames('')).toEqual({ names: [] })
    expect(validCompanyNames('Odonto')).toEqual({ error: 'Use o nome com pelo menos duas palavras ou o CNPJ completo ("Odonto" pegaria Pix de outras empresas).' })
    expect(validCompanyNames('11.222.333')).toEqual({ error: 'Use o nome com pelo menos duas palavras ou o CNPJ completo ("11.222.333" pegaria Pix de outras empresas).' })
  })
  it('validOwnerNames separa por vírgula e exige nome e sobrenome', () => {
    expect(validOwnerNames('Ana Teste,  ANA T S ')).toEqual({ names: ['Ana Teste', 'ANA T S'] })
    expect(validOwnerNames('')).toEqual({ names: [] })
    expect(validOwnerNames('Ana')).toEqual({ error: 'Use nome e sobrenome em cada variação ("Ana" é curto demais e pegaria Pix de outras pessoas).' })
  })
})
