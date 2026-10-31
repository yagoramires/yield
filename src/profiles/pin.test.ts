import { formatWait, pinKey, unlockMessage } from './pin'

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
