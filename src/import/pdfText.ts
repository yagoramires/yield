export class PdfPasswordError extends Error {}

// App (Vite/webview): build normal + worker. Node/Vitest: build legacy, sem worker.
async function loadPdfjs() {
  if (typeof document === 'undefined') return import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc ||= (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  return pdfjs
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
    const rows = new Map<number, { x: number; s: string }[]>()
    for (const it of items) {
      if (!('str' in it) || !it.str.trim()) continue
      const y = Math.round(it.transform[5] / 3) // tolera ~3pt de variação de baseline na mesma linha
      rows.set(y, [...(rows.get(y) ?? []), { x: it.transform[4], s: it.str.trim() }])
    }
    pages.push([...rows].sort((a, b) => b[0] - a[0])
      .map(([, r]) => r.sort((a, b) => a.x - b.x).map(c => c.s).join(' ')).join('\n'))
  }
  await task.destroy()
  return pages
}
