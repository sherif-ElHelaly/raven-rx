// Minimal RFC 4180 CSV parser: handles quoted fields, escaped quotes ("")
// and quoted newlines. Good enough for the seed/import format in
// seed/SEED_FORMAT.md — no external dependency needed for this small a job.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  // Normalize line endings and strip a leading BOM.
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')

  while (i < src.length) {
    const ch = src[i]

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += ch
    i += 1
  }

  // Flush the last field/row (files may or may not end with a newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text)
  if (rows.length === 0) return []
  const [header, ...rest] = rows
  return rest.map((r) => {
    const record: Record<string, string> = {}
    header.forEach((key, idx) => {
      record[key] = r[idx] ?? ''
    })
    return record
  })
}

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// Serializes a flat list of objects into an RFC 4180 CSV string. `columns`
// fixes the header order; missing/undefined values become empty fields.
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.join(',')]
  for (const row of rows) {
    lines.push(
      columns
        .map((col) => {
          const v = row[col]
          if (v === undefined || v === null) return ''
          return escapeCsvField(String(v))
        })
        .join(','),
    )
  }
  return lines.join('\r\n') + '\r\n'
}
