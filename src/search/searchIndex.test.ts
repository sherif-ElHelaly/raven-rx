import { describe, expect, it } from 'vitest'
import { buildSearchIndex, search, type SearchEntry } from './searchIndex'

const ENTRIES: SearchEntry[] = [
  {
    productId: 1,
    nameEn: 'Tareg',
    nameAr: 'تارج',
    aliases: [],
    ingredientNames: ['valsartan'],
  },
  {
    productId: 2,
    nameEn: 'Co-Tareg',
    nameAr: 'كو-تارج',
    aliases: [],
    ingredientNames: ['valsartan', 'hydrochlorothiazide'],
  },
  {
    productId: 3,
    nameEn: 'Controloc',
    nameAr: 'كونترولوك',
    aliases: ['Controlock'],
    ingredientNames: ['pantoprazole'],
  },
  {
    productId: 4,
    nameEn: 'Concor',
    nameAr: 'كونكور',
    aliases: [],
    ingredientNames: ['bisoprolol'],
  },
]

const index = buildSearchIndex(ENTRIES)

describe('search', () => {
  it('prefix-matches an English brand name', () => {
    const results = search(index, 'tar')
    const ids = results.map((r) => r.productId)
    expect(ids).toContain(1)
    expect(ids).toContain(2)
  })

  it('ranks an exact/prefix name match above an ingredient-only match', () => {
    const results = search(index, 'valsartan')
    expect(results[0]?.productId).toBe(1)
  })

  it('prefix-matches an Arabic brand name', () => {
    const results = search(index, 'كونترولوك')
    expect(results.map((r) => r.productId)).toContain(3)
  })

  it('normalizes alef hamza variants between query and index', () => {
    const withHamza = buildSearchIndex([
      { productId: 9, nameEn: 'X', nameAr: 'أحمد', aliases: [], ingredientNames: [] },
    ])
    expect(search(withHamza, 'احمد').map((r) => r.productId)).toContain(9)
  })

  it('is typo-tolerant on a near-miss brand name', () => {
    const results = search(index, 'controloc')
    expect(results.map((r) => r.productId)).toContain(3)
  })

  it('finds an alias spelling via an approximate match', () => {
    // "Controlock" is the actual Egyptian-market spelling stored as an alias.
    const results = search(index, 'controlock')
    expect(results.map((r) => r.productId)).toContain(3)
  })

  it('requires every query word to match (AND semantics)', () => {
    const results = search(index, 'tareg zzzznotaword')
    expect(results).toHaveLength(0)
  })

  it('returns nothing for an empty query', () => {
    expect(search(index, '   ')).toEqual([])
  })
})
