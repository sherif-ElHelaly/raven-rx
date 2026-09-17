import { describe, expect, it } from 'vitest'
import { levenshteinBounded } from './levenshtein'

describe('levenshteinBounded', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinBounded('controloc', 'controloc', 2)).toBe(0)
  })

  it('counts a single substitution', () => {
    expect(levenshteinBounded('controloc', 'controluc', 2)).toBe(1)
  })

  it('counts a single insertion', () => {
    expect(levenshteinBounded('controloc', 'controlock', 2)).toBe(1)
  })

  it('returns maxDistance + 1 when the real distance exceeds the bound', () => {
    expect(levenshteinBounded('controloc', 'concor', 2)).toBe(3)
  })
})
