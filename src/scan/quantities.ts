// Reads the الكمية (quantity) column of a case sheet. Tesseract's Arabic model
// barely knows the Arabic-Indic digits ٠–٩, so this matches each printed digit
// against reference shapes instead.

import { adaptiveThreshold, blobH, blobW, connectedBlobs, mergeBlobs, type Blob2D, type Gray } from './binarize'
import { DIGIT_TEMPLATES } from './digitTemplates'

const G = 16

function blur(grid: Float32Array): Float32Array {
  const out = new Float32Array(G * G)
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      let s = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx
          const Y = y + dy
          if (X >= 0 && Y >= 0 && X < G && Y < G) s += grid[Y * G + X]! * (dx || dy ? 0.5 : 1)
        }
      }
      out[y * G + x] = s
    }
  }
  return out
}

// Fits a blob into a 16×16 grid, keeping its aspect ratio, centred.
function normalize(b: Blob2D, imgW: number): Float32Array {
  const grid = new Float32Array(G * G)
  const w = blobW(b)
  const h = blobH(b)
  const s = (G - 2) / Math.max(w, h)
  const ox = (G - w * s) / 2
  const oy = (G - h * s) / 2
  for (const p of b.pts) {
    const x = (p % imgW) - b.x0
    const y = Math.floor(p / imgW) - b.y0
    grid[Math.min(G - 1, Math.floor(oy + (y + 0.5) * s)) * G + Math.min(G - 1, Math.floor(ox + (x + 0.5) * s))] = 1
  }
  return blur(grid)
}

function correlation(a: Float32Array, b: Float32Array): number {
  let ma = 0
  let mb = 0
  for (let i = 0; i < a.length; i++) {
    ma += a[i]!
    mb += b[i]!
  }
  ma /= a.length
  mb /= b.length
  let s = 0
  let sa = 0
  let sb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]! - ma
    const y = b[i]! - mb
    s += x * y
    sa += x * x
    sb += y * y
  }
  return s / Math.sqrt(sa * sb + 1e-9)
}

const TEMPLATES = DIGIT_TEMPLATES.map(([digit, bits]) => ({
  digit,
  grid: blur(Float32Array.from(bits, (c) => (c === '1' ? 1 : 0))),
}))

function classify(b: Blob2D, imgW: number, tallest: number): { digit: number; score: number } {
  // ٠ is a small dot/diamond sitting low: size says more than shape at this scale.
  if (blobH(b) < tallest * 0.55 && blobW(b) <= blobH(b) * 1.6) return { digit: 0, score: 1 }
  const grid = normalize(b, imgW)
  let best = { digit: -1, score: -2 }
  for (const t of TEMPLATES) {
    const score = correlation(grid, t.grid)
    if (score > best.score) best = { digit: t.digit, score }
  }
  return best
}

export interface ColumnReading {
  // Vertical centre in the column image.
  y: number
  digits: string
  score: number
}

// One pass over the column: blobs → text rows → digits (read left to right).
// Erases table rules: pixel columns inked over much of the strip (cell borders)
// and pixel rows inked across most of its width. Otherwise a border sliver at
// the crop edge can outweigh the digits.
function eraseRules(ink: Uint8Array, w: number, h: number): void {
  for (let x = 0; x < w; x++) {
    let n = 0
    for (let y = 0; y < h; y++) n += ink[y * w + x]!
    if (n > h * 0.3) for (let y = 0; y < h; y++) ink[y * w + x] = 0
  }
  for (let y = 0; y < h; y++) {
    let n = 0
    for (let x = 0; x < w; x++) n += ink[y * w + x]!
    if (n > w * 0.6) ink.fill(0, y * w, y * w + w)
  }
}

export function readColumnOnce(col: Gray, r: number, k: number): ColumnReading[] {
  const ink = adaptiveThreshold(col, r, k)
  eraseRules(ink, col.w, col.h)
  const blobs = connectedBlobs(ink, col.w, col.h).filter(
    (b) =>
      blobW(b) < col.w * 0.5 && // table rules
      b.pts.length >= 3 && // specks
      !(blobH(b) > 4 * blobW(b) && blobH(b) > r * 4), // column borders
  )

  blobs.sort((a, b) => a.y0 - b.y0)
  const rows: { y0: number; y1: number; items: Blob2D[] }[] = []
  for (const b of blobs) {
    const row = rows.find((rw) => b.y0 <= rw.y1 + 1 && b.y1 >= rw.y0 - 1)
    if (row) {
      row.items.push(b)
      row.y0 = Math.min(row.y0, b.y0)
      row.y1 = Math.max(row.y1, b.y1)
    } else {
      rows.push({ y0: b.y0, y1: b.y1, items: [b] })
    }
  }

  const out: ColumnReading[] = []
  for (const row of rows) {
    // Pieces overlapping horizontally are one digit (a faint ٦ breaks into hook + stem).
    row.items.sort((a, b) => a.x0 - b.x0)
    const glyphs: Blob2D[] = []
    for (const b of row.items) {
      const last = glyphs[glyphs.length - 1]
      if (last && b.x0 <= last.x1) glyphs[glyphs.length - 1] = mergeBlobs(last, b)
      else glyphs.push(b)
    }
    const tallest = Math.max(...glyphs.map(blobH))
    if (tallest < 5) continue
    let kept = glyphs.filter((g) => blobH(g) >= tallest * 0.25)
    // Keep the run of glyphs around the biggest one; isolated marks are noise.
    const big = kept.reduce((a, b) => (b.pts.length > a.pts.length ? b : a))
    let i0 = kept.indexOf(big)
    let i1 = i0
    while (i0 > 0 && kept[i0]!.x0 - kept[i0 - 1]!.x1 <= tallest * 1.5) i0--
    while (i1 < kept.length - 1 && kept[i1 + 1]!.x0 - kept[i1]!.x1 <= tallest * 1.5) i1++
    kept = kept.slice(i0, i1 + 1)

    let digits = ''
    let score = 1
    for (const g of kept) {
      const c = classify(g, col.w, tallest)
      digits += c.digit
      score = Math.min(score, c.score)
    }
    out.push({ y: (row.y0 + row.y1) / 2, digits, score })
  }
  return out
}

// Horizontal span of the quantity cells, from the الكمية header word. Keep it
// tight: the neighbouring column's text (عيادة القلب) just left of the cell
// border otherwise out-weighs the digits.
export function quantityColumnSpan(headerX0: number, headerX1: number): [number, number] {
  const w = headerX1 - headerX0
  return [headerX0 - w * 0.1, headerX1 + w * 0.2]
}

const PLAUSIBLE = /^[1-9][0-9]*0$/

// Reads the column with several threshold settings and lets them vote, then
// assigns a quantity to each med line (by vertical position; lineCenters are
// in column coordinates). A cell that no setting reads plausibly stays undefined.
export function readQuantities(col: Gray, lineHeight: number, lineCenters: number[]): (number | undefined)[] {
  const passes: ColumnReading[][] = []
  for (const rf of [0.24, 0.32, 0.4]) {
    for (const k of [0.75, 0.8, 0.85]) passes.push(readColumnOnce(col, Math.max(3, Math.round(lineHeight * rf)), k))
  }

  // The page curls, so a cell can sit up to ~half a line off its text line.
  const tolerance = lineHeight * 0.8
  return lineCenters.map((center, i) => {
    // Never reach past the midpoint to a neighbouring line.
    const lo = Math.max(center - tolerance, i > 0 ? (lineCenters[i - 1]! + center) / 2 : -Infinity)
    const hi = Math.min(center + tolerance, i < lineCenters.length - 1 ? (lineCenters[i + 1]! + center) / 2 : Infinity)
    const votes = new Map<string, { n: number; score: number }>()
    for (const pass of passes) {
      const hit = pass
        .filter((c) => c.y >= lo && c.y <= hi && PLAUSIBLE.test(c.digits) && Number(c.digits) <= 1000)
        .sort((a, b) => Math.abs(a.y - center) - Math.abs(b.y - center))[0]
      if (!hit) continue
      const v = votes.get(hit.digits) ?? { n: 0, score: 0 }
      v.n++
      v.score += hit.score
      votes.set(hit.digits, v)
    }
    const best = [...votes.entries()].sort((a, b) => b[1].score - a[1].score)[0]
    if (!best) return undefined
    const [digits, { n, score }] = best
    // Of the 9 passes: a clear majority, or at least 3 confident agreeing reads.
    return n >= 5 || (n >= 3 && score / n >= 0.85) ? Number(digits) : undefined
  })
}
