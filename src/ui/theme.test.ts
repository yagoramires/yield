import { expect, test } from 'vitest'
import { effectiveTheme } from './theme'

test('tema: "sistema" segue o macOS/Windows; claro e escuro ignoram', () => {
  expect(effectiveTheme('system', true)).toBe('light')
  expect(effectiveTheme('system', false)).toBe('dark')
  expect(effectiveTheme('light', false)).toBe('light')
  expect(effectiveTheme('dark', true)).toBe('dark')
})
