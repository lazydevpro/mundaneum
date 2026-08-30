/**
 * Heavy parsers stay out of the main bundle: SheetJS and mammoth load as
 * dynamic chunks the first time such a file is actually dropped.
 */

export interface ParsedSheet {
  preview: string[][] // ≤ 6 rows × 6 cols for the card face
  textSample: string // header + sample rows — feeds clustering/search
  rows: string[][] // full (capped) grid for the viewer
}

const CAP_ROWS = 500
const CAP_COLS = 40

export function parseCsvText(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length && rows.length < CAP_ROWS; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.some((c) => c !== '')) rows.push(row.slice(0, CAP_COLS))
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c !== '')) rows.push(row.slice(0, CAP_COLS))
  return rows
}

function fromRows(rows: string[][]): ParsedSheet {
  const preview = rows.slice(0, 6).map((r) => r.slice(0, 6).map((c) => String(c ?? '')))
  const textSample = rows
    .slice(0, 12)
    .map((r) => r.slice(0, 12).join(' | '))
    .join('\n')
    .slice(0, 1500)
  return { preview, textSample, rows }
}

export async function parseSheet(blob: Blob, filename: string): Promise<ParsedSheet> {
  if (/\.(csv|tsv)$/i.test(filename)) {
    let text = await blob.text()
    if (/\.tsv$/i.test(filename)) text = text.replace(/\t/g, ',')
    return fromRows(parseCsvText(text))
  }
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][]
  return fromRows(aoa.slice(0, CAP_ROWS).map((r) => r.slice(0, CAP_COLS).map((c) => String(c ?? ''))))
}

export interface ParsedDoc {
  excerpt: string // first ~1500 chars — the card body + clustering signal
  html: string // sanitized-enough HTML for the sandboxed viewer
}

export async function parseDoc(blob: Blob): Promise<ParsedDoc> {
  const mammoth = await import('mammoth/mammoth.browser')
  const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() })
  const doc = new DOMParser().parseFromString(result.value, 'text/html')
  const excerpt = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 1500)
  return { excerpt, html: result.value }
}
