import { levenshteinBounded } from './levenshtein'
import { normalizeText, tokenize } from './normalize'

export interface SearchEntry {
  productId: number
  nameEn: string
  nameAr: string
  aliases: string[]
  ingredientNames: string[]
}

interface IndexedWord {
  word: string
  weight: number
}

interface IndexedEntry {
  productId: number
  words: IndexedWord[]
}

export interface SearchIndex {
  entries: IndexedEntry[]
}

// Field weights: brand name matches should outrank an incidental ingredient
// or alias match.
const NAME_WEIGHT = 3
const ALIAS_WEIGHT = 2
const INGREDIENT_WEIGHT = 1

export function buildSearchIndex(entries: SearchEntry[]): SearchIndex {
  return {
    entries: entries.map((e) => {
      const words: IndexedWord[] = []
      for (const w of tokenize(e.nameEn)) words.push({ word: w, weight: NAME_WEIGHT })
      for (const w of tokenize(e.nameAr)) words.push({ word: w, weight: NAME_WEIGHT })
      for (const alias of e.aliases) {
        for (const w of tokenize(alias)) words.push({ word: w, weight: ALIAS_WEIGHT })
      }
      for (const ing of e.ingredientNames) {
        for (const w of tokenize(ing)) words.push({ word: w, weight: INGREDIENT_WEIGHT })
      }
      return { productId: e.productId, words }
    }),
  }
}

function wordScore(queryWord: string, indexedWord: IndexedWord): number {
  const { word, weight } = indexedWord
  if (word === queryWord) return weight * 4
  if (word.startsWith(queryWord)) return weight * 3
  if (word.includes(queryWord)) return weight * 2
  // Typo tolerance: only for query words long enough that a stray edit
  // won't collide with an unrelated short word.
  if (queryWord.length >= 4) {
    const maxDist = queryWord.length <= 5 ? 1 : 2
    if (levenshteinBounded(queryWord, word, maxDist) <= maxDist) return weight
  }
  return 0
}

export interface SearchResult {
  productId: number
  score: number
}

// AND semantics across query words (each must match something), scores sum.
export function search(index: SearchIndex, query: string, limit = 50): SearchResult[] {
  const queryWords = tokenize(query)
  if (queryWords.length === 0) return []

  const results: SearchResult[] = []

  for (const entry of index.entries) {
    let total = 0
    let matchedAll = true

    for (const qw of queryWords) {
      let best = 0
      for (const iw of entry.words) {
        const s = wordScore(qw, iw)
        if (s > best) best = s
      }
      if (best === 0) {
        matchedAll = false
        break
      }
      total += best
    }

    if (matchedAll) {
      results.push({ productId: entry.productId, score: total })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

export { normalizeText }
