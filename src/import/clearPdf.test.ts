import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseClearNote } from './clearPdf'
import { buildLines, extractPdfText, PdfPasswordError } from './pdfText'

const fixture = readFileSync('tests/fixtures/clear-nota-sintetica.txt', 'utf8')

describe('parseClearNote', () => {
  it('lê cabeçalho, itens e taxas da nota sintética', () => {
    const drafts = parseClearNote([fixture])
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ number: '123456', broker: 'CLEAR', tradeDate: '2024-01-05', settleDate: '2024-01-09' })
    expect(drafts[0].items).toEqual([
      { side: 'C', spec: 'ITAUSA PN N1', ticker: null, assetType: null, qty: 100, priceCents: 1050 },
      { side: 'C', spec: 'FII CSHG LOG HGLG11 CI', ticker: 'HGLG11', assetType: 'FII', qty: 2, priceCents: 16000 },
    ])
    expect(drafts[0].fees).toMatchObject({ liquidacaoCents: 37, emolumentosCents: 7, irrfCents: 0 })
  })

  it('separa várias notas e junta folhas da mesma nota', () => {
    const second = fixture.replace('123456 1', '777 1').replace('05/01/2024', '06/01/2024').replace('1-BOVESPA C VISTA ITAUSA', '1-BOVESPA V VISTA ITAUSA')
    const folha2 = 'Nr. nota Folha Data pregão\n123456 2 05/01/2024\n1-BOVESPA V VISTA FII XPTO XPLG11 CI 3 100,00 300,00 C'
    const drafts = parseClearNote([fixture, folha2, second])
    expect(drafts.map(d => d.number)).toEqual(['123456', '777'])
    expect(drafts[0].items).toHaveLength(3)
    expect(drafts[0].items[2]).toMatchObject({ side: 'V', ticker: 'XPLG11', qty: 3 })
    expect(drafts[1].items[0].side).toBe('V')
  })

  it('falha em linha de negócio que não reconhece', () => {
    expect(() => parseClearNote([fixture.replace('100 10,50', 'cem')])).toThrow(/negócio/i)
  })
})

// PDF mínimo escrito à mão (sem tabela xref válida: pdf.js a reconstrói), duas linhas de texto em y diferentes.
const tinyPdf = (extra = '') => new TextEncoder().encode(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 100>>stream
BT /F1 12 Tf 10 200 Td (Linha A) Tj 100 0 Td (B) Tj ET BT /F1 12 Tf 10 100 Td (Linha C) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF${extra}`)

describe('buildLines', () => {
  it('junta itens com jitter de baseline na mesma linha e separa linhas distintas', () => {
    const items = [{ s: 'B', x: 50, y: 4.6 }, { s: 'A', x: 10, y: 4.4 }, { s: 'C', x: 10, y: -8 }]
    expect(buildLines(items)).toBe('A B\nC')
  })
})

describe('extractPdfText', () => {
  it('reconstrói linhas pela posição y', async () => {
    expect(await extractPdfText(tinyPdf())).toEqual(['Linha A B\nLinha C'])
  })

  it('rejeita bytes que não são PDF', async () => {
    await expect(extractPdfText(new Uint8Array([1, 2, 3]))).rejects.not.toBeInstanceOf(PdfPasswordError)
  })
})
