// Matches a brand name read off a case sheet to a product in the database.

import type { Presentation, Product } from '../db/types'
import { levenshteinBounded } from '../search/levenshtein'
import { normalizeText } from '../search/normalize'
import { toLatinDigits } from './parseCase'

// "كو-تارج" and "كوتارج", "ايليكويس" and "اليكويس" should all collapse
// together: drop spaces/hyphens and the long vowel ي that OCR and typists add
// or drop freely.
export function matchKey(name: string): string {
  return normalizeText(name).replace(/[\s\-ـ]/g, '')
}

function looseKey(name: string): string {
  return matchKey(name).replace(/ي/g, '')
}

export function matchProduct(name: string, products: Product[]): Product | undefined {
  const found = matchName(name, products)
  if (found) return found
  // A table border beside the name often reads as a leading ا/أ ("أسينيمت").
  return /^[اأإ]/.test(name) ? matchName(name.slice(1), products) : undefined
}

function matchName(name: string, products: Product[]): Product | undefined {
  const key = matchKey(name)
  if (key.length < 3) return undefined
  const loose = looseKey(name)

  let best: { product: Product; dist: number } | undefined
  for (const p of products) {
    for (const candidate of [p.nameAr, ...(p.aliases ?? [])]) {
      if (!candidate) continue
      const k = matchKey(candidate)
      if (k === key) return p
      // One OCR slip is fine; two edits turn فاستاريل into Fastel and بلنديل
      // into Randil — a wrong drug is worse than an unregistered one.
      const maxDist = key.length >= 9 ? 2 : 1
      const d = Math.min(
        levenshteinBounded(key, k, maxDist),
        looseKey(candidate) === loose ? 0.5 : maxDist + 1,
      )
      if (d <= maxDist && (!best || d < best.dist)) best = { product: p, dist: d }
    }
  }
  return best?.product
}

function strengthNumbers(strength: string | undefined): string[] {
  return toLatinDigits(strength ?? '').match(/[0-9]+(?:\.[0-9]+)?/g) ?? []
}

// OCR often reverses Arabic-Indic digit runs ("١٠" → "٠١"), so try both.
export function matchPresentation(
  strength: string | undefined,
  modifier: string | undefined,
  presentations: Presentation[],
): Presentation | undefined {
  const read = strength?.split('/')[0] ?? ''
  const guesses = new Set(
    [read, [...read].reverse().join('')]
      .map((g) => g.replace(/^0+(?=\d)/, ''))
      .filter((g) => g && Number(g) > 0),
  )
  const hits = presentations.filter((p) => {
    const first = strengthNumbers(p.strength)[0]
    return first !== undefined && guesses.has(first)
  })
  if (hits.length === 0) return undefined
  // Prefer the extended-release form when the sheet says MR/XR.
  if (modifier) return hits.find((p) => p.form.startsWith('extended')) ?? hits[0]
  return hits.find((p) => !p.form.startsWith('extended') && p.form !== 'injection') ?? hits[0]
}

// A readable strength for a presentation created from a scan.
export function strengthLabel(strength: string | undefined, modifier: string | undefined): string {
  const s = strength ? `${strength} mg` : ''
  return [s, modifier].filter(Boolean).join(' ')
}
