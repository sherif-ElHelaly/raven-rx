// Combining two OCR reads of the same page. Tesseract is chaotic on marginal
// photos: a slightly different scale flips which lines come out readable, so
// the second read fills in med rows the first one garbled.

import { levenshteinBounded } from '../search/levenshtein'
import { matchKey } from './matchMed'
import { parseCase } from './parseCase'

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrWord {
  text: string
  bbox: Box
}

export interface OcrLine {
  text: string
  bbox: Box
  words: OcrWord[]
}

const centerY = (b: Box) => (b.y0 + b.y1) / 2

function sameName(a: string, b: string): boolean {
  const ka = matchKey(a).replace(/^[اأإ]/, '')
  const kb = matchKey(b).replace(/^[اأإ]/, '')
  const max = Math.min(ka.length, kb.length) >= 6 ? 2 : 1
  return levenshteinBounded(ka, kb, max) <= max
}

// Page lines from the first read, plus med rows (and the patient line, if the
// first read lost it) that only the second read found, slotted in by position.
export function mergePasses(first: OcrLine[], second: OcrLine[], lineHeight: number): OcrLine[] {
  const medOf = (l: OcrLine) => parseCase(l.text).meds[0]
  const firstMeds = first.flatMap((l) => {
    const m = medOf(l)
    return m ? [{ name: m.name, y: centerY(l.bbox) }] : []
  })
  const hasPatient = first.some((l) => parseCase(l.text).name)

  const extra = second.filter((l) => {
    const m = medOf(l)
    if (!m) return !hasPatient && !!parseCase(l.text).name
    const y = centerY(l.bbox)
    // Same row (the first read has a med there) or same drug elsewhere: already covered.
    return !firstMeds.some((f) => Math.abs(f.y - y) < lineHeight * 0.6 || sameName(f.name, m.name))
  })

  return [...first, ...extra].sort((a, b) => a.bbox.y0 - b.bbox.y0)
}
