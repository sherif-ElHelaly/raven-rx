// Creates a case from a reviewed case-sheet scan. Meds the database doesn't
// know yet become placeholder products/presentations flagged `unregistered`,
// so the case is complete now and the details can be filled in later.

import { createRequest, findOrCreatePerson, updatePerson, addItem } from './repo'
import type { SarfDB } from './schema'
import type { Form, Plan, Presentation, Product } from './types'

export type ScanLine =
  | { kind: 'presentation'; presentationId: number; qty: number }
  | { kind: 'new-strength'; productId: number; strength: string; form: Form; qty: number }
  | { kind: 'new-drug'; nameAr: string; strength: string; form: Form; qty: number; sourceLine?: string }

export interface ScanDraft {
  cardNumber: string
  name?: string
  rank?: string
  plan: Plan
  lines: ScanLine[]
}

async function addUnregisteredPresentation(
  db: SarfDB,
  productId: number,
  strength: string,
  form: Form,
): Promise<number> {
  const trimmed = strength.trim() || undefined
  const existing = await db.presentations
    .where('productId')
    .equals(productId)
    .filter((p) => p.strength === trimmed && p.form === form)
    .first()
  if (existing) return existing.id!
  const data: Omit<Presentation, 'id'> = {
    productId,
    strength: trimmed,
    form,
    fridge: false,
    controlled: false,
    unregistered: true,
  }
  return (await db.presentations.add(data)) as number
}

async function addUnregisteredProduct(db: SarfDB, nameAr: string, sourceLine?: string): Promise<number> {
  const name = nameAr.trim()
  const existing = await db.products.where('nameAr').equals(name).first()
  if (existing) return existing.id!
  const data: Omit<Product, 'id'> = {
    // English name unknown until filled in; the Arabic name keeps lists readable.
    nameEn: name,
    nameAr: name,
    categories: [],
    verified: false,
    unregistered: true,
    notes: sourceLine ? `From case sheet: ${sourceLine}` : undefined,
  }
  return (await db.products.add(data)) as number
}

export async function createCaseFromScan(db: SarfDB, draft: ScanDraft): Promise<number> {
  return db.transaction('rw', [db.people, db.requests, db.items, db.products, db.presentations], async () => {
    const details = { name: draft.name?.trim() || undefined, rank: draft.rank?.trim() || undefined }
    const person = await findOrCreatePerson(db, draft.cardNumber.trim(), details)
    // The review screen shows a returning person's saved details, so what it submits wins.
    if (person.name !== details.name || person.rank !== details.rank) {
      await updatePerson(db, person.id!, details)
    }

    const requestId = await createRequest(db, person.id!, draft.plan)
    for (const line of draft.lines) {
      let presentationId: number
      if (line.kind === 'presentation') {
        presentationId = line.presentationId
      } else if (line.kind === 'new-strength') {
        presentationId = await addUnregisteredPresentation(db, line.productId, line.strength, line.form)
      } else {
        const productId = await addUnregisteredProduct(db, line.nameAr, line.sourceLine)
        presentationId = await addUnregisteredPresentation(db, productId, line.strength, line.form)
      }
      await addItem(db, requestId, presentationId, line.qty)
    }
    return requestId
  })
}

export interface UnregisteredEntry {
  product: Product
  // Unregistered strengths of this product (all of them for a new drug).
  presentations: Presentation[]
}

export async function unregisteredMeds(db: SarfDB): Promise<UnregisteredEntry[]> {
  const [products, presentations] = await Promise.all([
    db.products.filter((p) => !!p.unregistered).toArray(),
    db.presentations.filter((p) => !!p.unregistered).toArray(),
  ])
  const byProduct = new Map<number, UnregisteredEntry>()
  for (const p of products) byProduct.set(p.id!, { product: p, presentations: [] })
  const missing = [...new Set(presentations.map((p) => p.productId))].filter((id) => !byProduct.has(id))
  for (const p of await db.products.bulkGet(missing)) {
    if (p) byProduct.set(p.id!, { product: p, presentations: [] })
  }
  for (const pres of presentations) byProduct.get(pres.productId)?.presentations.push(pres)
  return [...byProduct.values()].sort((a, b) => a.product.nameAr.localeCompare(b.product.nameAr, 'ar'))
}
