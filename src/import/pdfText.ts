export class PdfPasswordError extends Error {}

// App (Vite/webview): build normal + worker. Node/Vitest: build legacy, sem worker.
async function loadPdfjs() {
  if (typeof document === 'undefined') return import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc ||= (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  return pdfjs
}

const ROW_TOLERANCE = 2.5 // pt: itens da mesma linha visual podem ter baseline com jitter

export function buildLines(items: { s: string; x: number; y: number }[]): string {
  const sorted = [...items].sort((a, b) => b.y - a.y) // pdf.js: y cresce para cima
  const rows: { y: number; cells: typeof items }[] = []
  for (const it of sorted) {
    const row = rows[rows.length - 1]
    if (row && row.y - it.y <= ROW_TOLERANCE) row.cells.push(it)
    else rows.push({ y: it.y, cells: [it] })
  }
  return rows.map(r => r.cells.sort((a, b) => a.x - b.x).map(c => c.s).join(' ')).join('\n')
}

export async function extractPdfText(data: Uint8Array, password?: string): Promise<string[]> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data: data.slice(), password })
  let doc
  try {
    doc = await task.promise
  } catch (e) {
    if (e instanceof pdfjs.PasswordException) throw new PdfPasswordError(e.message)
    throw e
  }
  const pages: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const { items } = await (await doc.getPage(n)).getTextContent()
    pages.push(buildLines(items.flatMap(it => ('str' in it && it.str.trim() ? [{ s: it.str.trim(), x: it.transform[4], y: it.transform[5] }] : []))))
  }
  await task.destroy()
  return pages
}
