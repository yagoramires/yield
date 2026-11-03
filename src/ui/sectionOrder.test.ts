import { insertBefore, moveId, orderIds, SPLIT } from './sectionOrder'

test('a ordem guardada vale; novo entra no fim; sumido, repetido e estranho saem', () => {
  expect(orderIds(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c'])
  expect(orderIds(['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'a', 'b'])
  expect(orderIds(['a', 'b'], ['x', 'b', 'b', 'a'])).toEqual(['b', 'a'])
})

test('mover para a posição do alvo, para cima ou para baixo', () => {
  expect(moveId(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a'])
  expect(moveId(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  expect(moveId(['a', 'b', 'c'], 'b', 'b')).toEqual(['a', 'b', 'c'])
  expect(moveId(['a', 'b', 'c'], 'x', 'a')).toEqual(['a', 'b', 'c'])
})

test('duas colunas: antes do alvo, no fim da esquerda (SPLIT) ou no fim da direita (null)', () => {
  const o = ['a', 'b', SPLIT, 'c', 'd']
  expect(insertBefore(o, 'a', 'd')).toEqual(['b', SPLIT, 'c', 'a', 'd'])
  expect(insertBefore(o, 'd', SPLIT)).toEqual(['a', 'b', 'd', SPLIT, 'c'])
  expect(insertBefore(o, 'a', null)).toEqual(['b', SPLIT, 'c', 'd', 'a'])
  expect(insertBefore(o, 'b', 'b')).toEqual(o)
  expect(insertBefore(o, 'x', 'a')).toEqual(o)
})
