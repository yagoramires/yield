export function centerSquare(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.min(w, h)
  return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), side }
}

const UNREADABLE = 'Não foi possível ler essa imagem.'

// A foto vai para o perfis.json como data URL: recorta o centro e reduz para o arquivo não crescer.
export async function cropAvatar(file: File, size = 256): Promise<string> {
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) } catch { throw new Error(UNREADABLE) }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(UNREADABLE)
    const { sx, sy, side } = centerSquare(bitmap.width, bitmap.height)
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally { bitmap.close() }
}
