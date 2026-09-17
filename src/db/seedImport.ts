// Imports the flat seed/import CSV (seed/SEED_FORMAT.md) into the
// Product / Presentation / Ingredient / ProductIngredient shape from
// VISION.md §3. One CSV row = one presentation; rows sharing brand_en
// collapse into a single product.

import type { SarfDB } from './schema'
import { parseCsvRecords } from './csv'
import type { Category, Confidence, Form } from './types'

export interface ParsedRow {
  brandEn: string
  brandAr: string
  ingredients: string[]
  strength: string
  form: Form
  packSize?: string
  manufacturer?: string
  categories: Category[]
  drugClass?: string
  useEn?: string
  fridge: boolean
  controlled: boolean
  confidence: Confidence
  source?: string
}

const splitMulti = (value: string): string[] =>
  value
    .split(';')
    .map((v) => v.trim())
    .filter(Boolean)

export function parseSeedCsv(text: string): ParsedRow[] {
  return parseCsvRecords(text).map((r) => ({
    brandEn: r.brand_en.trim(),
    brandAr: r.brand_ar.trim(),
    ingredients: splitMulti(r.ingredients),
    strength: r.strength.trim(),
    form: r.form.trim() as Form,
    packSize: r.pack_size.trim() || undefined,
    manufacturer: r.manufacturer.trim() || undefined,
    categories: splitMulti(r.categories) as Category[],
    drugClass: r.drug_class.trim() || undefined,
    useEn: r.use_en.trim() || undefined,
    fridge: r.fridge.trim().toLowerCase() === 'yes',
    controlled: r.controlled.trim().toLowerCase() === 'yes',
    confidence: (r.confidence.trim() || 'medium') as Confidence,
    source: r.source.trim() || undefined,
  }))
}

export interface ImportPlan {
  products: {
    nameEn: string
    nameAr: string
    manufacturer?: string
    categories: Category[]
    verified: boolean
    notes?: string
  }[]
  presentations: {
    productIndex: number
    strength?: string
    form: Form
    packSize?: string
    fridge: boolean
    controlled: boolean
  }[]
  ingredients: { nameEn: string }[]
  productIngredients: { productIndex: number; ingredientIndex: number }[]
}

// Pure transform: CSV rows -> insertable plan. Kept free of Dexie so it's
// trivial to unit test.
export function buildImportPlan(rows: ParsedRow[]): ImportPlan {
  const productIndexByName = new Map<string, number>()
  const ingredientIndexByName = new Map<string, number>()
  const productIngredientKeys = new Set<string>()

  const plan: ImportPlan = {
    products: [],
    presentations: [],
    ingredients: [],
    productIngredients: [],
  }

  for (const row of rows) {
    let productIndex = productIndexByName.get(row.brandEn)
    if (productIndex === undefined) {
      productIndex = plan.products.length
      plan.products.push({
        nameEn: row.brandEn,
        nameAr: row.brandAr,
        manufacturer: row.manufacturer,
        categories: row.categories,
        verified: row.confidence === 'high',
        notes: row.useEn,
      })
      productIndexByName.set(row.brandEn, productIndex)
    }

    plan.presentations.push({
      productIndex,
      strength: row.strength || undefined,
      form: row.form,
      packSize: row.packSize,
      fridge: row.fridge,
      controlled: row.controlled,
    })

    for (const ingredientName of row.ingredients) {
      let ingredientIndex = ingredientIndexByName.get(ingredientName)
      if (ingredientIndex === undefined) {
        ingredientIndex = plan.ingredients.length
        plan.ingredients.push({ nameEn: ingredientName })
        ingredientIndexByName.set(ingredientName, ingredientIndex)
      }
      const key = `${productIndex}:${ingredientIndex}`
      if (!productIngredientKeys.has(key)) {
        productIngredientKeys.add(key)
        plan.productIngredients.push({ productIndex, ingredientIndex })
      }
    }
  }

  return plan
}

export async function importSeedIntoDb(db: SarfDB, csvText: string): Promise<{
  products: number
  presentations: number
  ingredients: number
}> {
  const rows = parseSeedCsv(csvText)
  const plan = buildImportPlan(rows)

  await db.transaction(
    'rw',
    db.products,
    db.presentations,
    db.ingredients,
    db.productIngredients,
    async () => {
      const productIds = await Promise.all(
        plan.products.map((p) => db.products.add(p)),
      )
      const ingredientIds = await Promise.all(
        plan.ingredients.map((i) => db.ingredients.add(i)),
      )

      await Promise.all(
        plan.presentations.map((p) =>
          db.presentations.add({
            productId: productIds[p.productIndex]!,
            strength: p.strength,
            form: p.form,
            packSize: p.packSize,
            fridge: p.fridge,
            controlled: p.controlled,
          }),
        ),
      )

      await Promise.all(
        plan.productIngredients.map((pi) =>
          db.productIngredients.add({
            productId: productIds[pi.productIndex]!,
            ingredientId: ingredientIds[pi.ingredientIndex]!,
          }),
        ),
      )
    },
  )

  return {
    products: plan.products.length,
    presentations: plan.presentations.length,
    ingredients: plan.ingredients.length,
  }
}

// Fetches the shipped seed file and imports it, but only if the products
// table is still empty (so re-opening the app never duplicates the seed).
//
// Concurrent callers (e.g. React StrictMode's double effect-invocation in
// dev) share one in-flight promise instead of both racing past the
// products.count() === 0 check and double-importing.
let seedingPromise: Promise<void> | null = null

export function ensureSeeded(db: SarfDB): Promise<void> {
  if (!seedingPromise) {
    seedingPromise = (async () => {
      const count = await db.products.count()
      if (count > 0) return

      const res = await fetch(`${import.meta.env.BASE_URL}seed/medications.csv`)
      if (!res.ok) {
        throw new Error(`Failed to fetch seed CSV: ${res.status}`)
      }
      const text = await res.text()
      await importSeedIntoDb(db, text)
    })().finally(() => {
      seedingPromise = null
    })
  }
  return seedingPromise
}
