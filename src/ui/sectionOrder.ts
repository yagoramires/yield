/** Ordem guardada primeiro (o que não existe mais sai, repetido vale uma vez); o que é novo entra no fim, na ordem de fábrica. */
export const orderIds = (ids: string[], saved: string[]): string[] =>
  [...saved.filter((s, i) => ids.includes(s) && saved.indexOf(s) === i), ...ids.filter(i => !saved.includes(i))]

/** Tira `id` de onde está e põe na posição que `target` ocupava. */
export function moveId(order: string[], id: string, target: string): string[] {
  const to = order.indexOf(target)
  if (to < 0 || !order.includes(id) || id === target) return order
  const rest = order.filter(x => x !== id)
  rest.splice(to, 0, id)
  return rest
}
