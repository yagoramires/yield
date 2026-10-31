import { formatWait, gateStep, pinEntered, pinKey, pinTitle, startPin, unlockMessage } from './pin'

test('teclado do PIN: só dígitos, até 4, apagar volta um', () => {
  expect(pinKey('', '1')).toBe('1')
  expect(pinKey('123', '4')).toBe('1234')
  expect(pinKey('1234', '5')).toBe('1234')
  expect(pinKey('12', 'a')).toBe('12')
  expect(pinKey('12', 'Backspace')).toBe('1')
  expect(pinKey('', 'Backspace')).toBe('')
})

test('contagem regressiva', () => {
  expect([0, 5, 47, 60, 299, 3600].map(formatWait)).toEqual(['0:00', '0:05', '0:47', '1:00', '4:59', '60:00'])
})

test('mensagem do PIN errado', () => {
  expect(unlockMessage({ kind: 'wrong', remaining: 3 })).toBe('PIN errado. Mais 3 tentativas antes da espera.')
  expect(unlockMessage({ kind: 'wrong', remaining: 1 })).toBe('PIN errado. Mais 1 tentativa antes da espera.')
  expect(unlockMessage({ kind: 'ok' })).toBeNull()
  expect(unlockMessage({ kind: 'locked', until: 1 })).toBeNull()
})

describe('pinEntered', () => {
  it('ligar: escolhe, repete e roda com o PIN novo', () => {
    let s = startPin('set')
    expect(pinTitle(s)).toBe('Escolha um PIN de 4 dígitos')
    const a = pinEntered(s, '1234')
    if (!('next' in a)) throw new Error('esperava o próximo passo')
    s = a.next
    expect(pinTitle(s)).toBe('Repita o PIN')
    expect(pinEntered(s, '1234')).toEqual({ run: { current: '', next: '1234' } })
  })
  it('PINs diferentes voltam ao primeiro passo e esquecem o primeiro PIN', () => {
    const s = { ...startPin('change'), stage: 'repeat' as const, current: '0000', first: '1234' }
    expect(pinEntered(s, '4321')).toEqual({ next: { ...s, stage: 'new', first: '' }, message: 'Os PINs não são iguais. Comece de novo.' })
  })
  it('trocar guarda o PIN atual até o fim', () => {
    const a = pinEntered(startPin('change'), '0000')
    if (!('next' in a)) throw new Error('esperava o próximo passo')
    expect(pinTitle(a.next)).toBe('Escolha o PIN novo')
    const b = pinEntered(a.next, '1111')
    if (!('next' in b)) throw new Error('esperava o próximo passo')
    expect(pinEntered(b.next, '1111')).toEqual({ run: { current: '0000', next: '1111' } })
  })
  it('tirar roda logo com o PIN atual', () => {
    expect(pinEntered(startPin('remove'), '0000')).toEqual({ run: { current: '0000', next: '' } })
  })
})

describe('gateStep', () => {
  const never = () => { throw new Error('não devia perguntar ao Rust') }
  it('2+ perfis sem escolha nesta sessão: tela de escolha', async () => {
    expect(await gateStep(2, null, 'a', true, never)).toBe('pick')
    expect(await gateStep(2, 'b', 'a', false, never)).toBe('pick')
  })
  it('perfil com PIN só abre se o Rust já tem as chaves dele', async () => {
    expect(await gateStep(2, 'a', 'a', true, async () => false)).toBe('pin')
    expect(await gateStep(1, null, 'a', true, async () => true)).toBe('open')
  })
  it('sem PIN abre direto, sem perguntar ao Rust', async () => {
    expect(await gateStep(1, null, 'a', false, never)).toBe('open')
  })
})
