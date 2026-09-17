import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../db/schema'
import { buildSearchIndex, type SearchEntry } from './searchIndex'

export function useSearchIndex() {
  const data = useLiveQuery(async () => {
    const [products, ingredients, links] = await Promise.all([
      db.products.toArray(),
      db.ingredients.toArray(),
      db.productIngredients.toArray(),
    ])
    return { products, ingredients, links }
  }, [])

  return useMemo(() => {
    if (!data) return null

    const ingredientNameById = new Map(data.ingredients.map((i) => [i.id!, i.nameEn]))
    const ingredientNamesByProductId = new Map<number, string[]>()
    for (const link of data.links) {
      const name = ingredientNameById.get(link.ingredientId)
      if (!name) continue
      const list = ingredientNamesByProductId.get(link.productId) ?? []
      list.push(name)
      ingredientNamesByProductId.set(link.productId, list)
    }

    const entries: SearchEntry[] = data.products.map((p) => ({
      productId: p.id!,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      aliases: p.aliases ?? [],
      ingredientNames: ingredientNamesByProductId.get(p.id!) ?? [],
    }))

    return buildSearchIndex(entries)
  }, [data])
}
