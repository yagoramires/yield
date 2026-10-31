import { centerSquare } from './avatar'

test('recorte quadrado central', () => {
  expect(centerSquare(400, 300)).toEqual({ sx: 50, sy: 0, side: 300 })
  expect(centerSquare(300, 400)).toEqual({ sx: 0, sy: 50, side: 300 })
  expect(centerSquare(256, 256)).toEqual({ sx: 0, sy: 0, side: 256 })
})
