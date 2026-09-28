// Cleaning up meds created from scanned case sheets: delete one nobody uses,
// or — when a scan misread a name/strength — merge it into the right med so
// every case and regular-meds list follows. Every change returns a snapshot
// so it can be undone.

import type { SarfDB } from './schema'
import type { Item, Person, Presentation, Product, ProductIngredient, ProductLink } from './types'

export interface MedUsage {
  // Case lines prescribing it.
  itemIds: number[]
  // Cases where it appears at all (prescribed or taken as a بديل).
  caseCount: number
  // Case lines where it was taken as a بديل.
  substituteCount: number
  // People who have it in their regular meds.
  peopleCount: number
}

export async function presentationUsage(db: SarfDB, presentationIds: number[]): Promise<MedUsage> {
  const ids = new Set(presentationIds)
  const [items, people] = await Promise.all([db.items.toArray(), db.people.toArray()])
  const prescribed = items.filter((i) => ids.has(i.presentationId))
  const asSubstitute = items.filter((i) => i.substitutedWithId !== undefined && ids.has(i.substitutedWithId))
  return {
    itemIds: prescribed.map((i) => i.id!),
    caseCount: new Set([...prescribed, ...asSubstitute].map((i) => i.requestId)).size,
    substituteCount: asSubstitute.length,
    peopleCount: people.filter((p) => p.regularMeds?.some((m) => ids.has(m.presentationId))).length,
  }
}

export interface MedSnapshot {
  items: Item[]
  people: Person[]
  products: Product[]
  presentations: Presentation[]
  productIngredients: ProductIngredient[]
  productLinks: ProductLink[]
}

// Before-state of every row a delete/merge of these products/presentations
// can touch. Those operations only update or delete rows (never add), so
// putting these back restores everything.
async function snapshot(db: SarfDB, productIds: number[], presentationIds: number[]): Promise<MedSnapshot> {
  const presIds = new Set(presentationIds)
  const prodIds = new Set(productIds)
  const productPresentations = await db.presentations.where('productId').anyOf(productIds).toArray()
  for (const p of productPresentations) presIds.add(p.id!)
  const [items, people, products, presentations, productIngredients, productLinks] = await Promise.all([
    db.items.toArray(),
    db.people.toArray(),
    db.products.bulkGet([...prodIds]),
    db.presentations.bulkGet([...presIds]),
    db.productIngredients.where('productId').anyOf(productIds).toArray(),
    db.productLinks.toArray(),
  ])
  return {
    items: items.filter(
      (i) =>
        presIds.has(i.presentationId) || (i.substitutedWithId !== undefined && presIds.has(i.substitutedWithId)),
    ),
    people: people.filter((p) => p.regularMeds?.some((m) => presIds.has(m.presentationId))),
    products: products.filter((p): p is Product => !!p),
    presentations: presentations.filter((p): p is Presentation => !!p),
    productIngredients,
    productLinks: productLinks.filter((l) => prodIds.has(l.productA) || prodIds.has(l.productB)),
  }
}

const TABLES = (db: SarfDB) => [
  db.items,
  db.people,
  db.products,
  db.presentations,
  db.productIngredients,
  db.productLinks,
]

export async function restoreSnapshot(db: SarfDB, s: MedSnapshot): Promise<void> {
  await db.transaction('rw', TABLES(db), async () => {
    await db.items.bulkPut(s.items)
    await db.people.bulkPut(s.people)
    await db.products.bulkPut(s.products)
    await db.presentations.bulkPut(s.presentations)
    await db.productIngredients.bulkPut(s.productIngredients)
    await db.productLinks.bulkPut(s.productLinks)
  })
}

async function deleteProductRows(db: SarfDB, productId: number): Promise<void> {
  await db.productIngredients.where('productId').equals(productId).delete()
  await db.productLinks.where('productA').equals(productId).delete()
  await db.productLinks.where('productB').equals(productId).delete()
  await db.products.delete(productId)
}

// Deletes presentations (and the product itself when `productId` is given,
// with all its presentations). With `removeCaseLines`, case lines prescribing
// them are deleted too; a بديل pointing at them is cleared either way.
// Without it, deleting something a case still prescribes is refused.
export async function deleteMeds(
  db: SarfDB,
  target: { productId?: number; presentationIds: number[] },
  opts: { removeCaseLines: boolean },
): Promise<MedSnapshot> {
  const productIds = target.productId !== undefined ? [target.productId] : []
  const snap = await snapshot(db, productIds, target.presentationIds)
  const presIds = new Set(snap.presentations.map((p) => p.id!))
  if (target.productId === undefined) {
    for (const id of [...presIds]) if (!target.presentationIds.includes(id)) presIds.delete(id)
  }

  await db.transaction('rw', TABLES(db), async () => {
    for (const item of snap.items) {
      if (presIds.has(item.presentationId)) {
        if (!opts.removeCaseLines) throw new Error('Med is still used in cases')
        await db.items.delete(item.id!)
      } else if (item.substitutedWithId !== undefined && presIds.has(item.substitutedWithId)) {
        await db.items.update(item.id!, { substitutedWithId: undefined })
      }
    }
    for (const person of snap.people) {
      await db.people.update(person.id!, {
        regularMeds: person.regularMeds!.filter((m) => !presIds.has(m.presentationId)),
      })
    }
    await db.presentations.bulkDelete([...presIds])
    if (target.productId !== undefined) await deleteProductRows(db, target.productId)
  })
  return snap
}

async function repointPresentation(db: SarfDB, snap: MedSnapshot, fromId: number, toId: number): Promise<void> {
  for (const item of snap.items) {
    const current = await db.items.get(item.id!)
    if (!current) continue
    const presentationId = current.presentationId === fromId ? toId : current.presentationId
    let substitutedWithId = current.substitutedWithId === fromId ? toId : current.substitutedWithId
    if (substitutedWithId === presentationId) substitutedWithId = undefined
    await db.items.update(item.id!, { presentationId, substitutedWithId })
  }
  for (const person of snap.people) {
    const current = await db.people.get(person.id!)
    if (!current?.regularMeds) continue
    const merged = new Map<number, number>()
    for (const m of current.regularMeds) {
      const id = m.presentationId === fromId ? toId : m.presentationId
      merged.set(id, Math.max(merged.get(id) ?? 0, m.qty))
    }
    await db.people.update(person.id!, {
      regularMeds: [...merged].map(([presentationId, qty]) => ({ presentationId, qty })),
    })
  }
  await db.presentations.delete(fromId)
}

// A misread strength: every case line and regular med using `fromId` moves to
// `toId`, then `fromId` is deleted.
export async function mergePresentation(db: SarfDB, fromId: number, toId: number): Promise<MedSnapshot> {
  if (fromId === toId) throw new Error('Cannot merge a presentation into itself')
  const [from, to] = await db.presentations.bulkGet([fromId, toId])
  if (!from || !to) throw new Error('Presentation not found')
  const snap = await snapshot(db, [], [fromId, toId])
  await db.transaction('rw', TABLES(db), async () => {
    await repointPresentation(db, snap, fromId, toId)
  })
  return snap
}

// A misread drug: `fromProductId` is folded into `toProductId`. Its strengths
// join the target (or map onto the target's matching strength), its بديل
// links carry over, and its names become aliases of the target so the next
// scan of the same sheet matches directly.
export async function mergeProduct(
  db: SarfDB,
  fromProductId: number,
  toProductId: number,
): Promise<MedSnapshot> {
  if (fromProductId === toProductId) throw new Error('Cannot merge a med into itself')
  const [from, to] = await db.products.bulkGet([fromProductId, toProductId])
  if (!from || !to) throw new Error('Medication not found')
  const snap = await snapshot(db, [fromProductId, toProductId], [])

  await db.transaction('rw', TABLES(db), async () => {
    const targetPresentations = snap.presentations.filter((p) => p.productId === toProductId)
    for (const pres of snap.presentations.filter((p) => p.productId === fromProductId)) {
      const match = targetPresentations.find(
        (t) => (t.strength ?? '') === (pres.strength ?? '') && t.form === pres.form,
      )
      if (match) await repointPresentation(db, snap, pres.id!, match.id!)
      else await db.presentations.update(pres.id!, { productId: toProductId })
    }

    // Carry بديل links over to the target, dropping self-links and duplicates.
    const targetPartners = new Set(
      snap.productLinks
        .filter((l) => l.productA === toProductId || l.productB === toProductId)
        .map((l) => (l.productA === toProductId ? l.productB : l.productA)),
    )
    for (const link of snap.productLinks) {
      if (link.productA !== fromProductId && link.productB !== fromProductId) continue
      const partner = link.productA === fromProductId ? link.productB : link.productA
      if (partner === toProductId || targetPartners.has(partner)) {
        await db.productLinks.delete(link.id!)
        continue
      }
      targetPartners.add(partner)
      const [productA, productB] = partner < toProductId ? [partner, toProductId] : [toProductId, partner]
      await db.productLinks.update(link.id!, { productA, productB })
    }

    const known = new Set([to.nameEn, to.nameAr, ...(to.aliases ?? [])].map((n) => n.trim()))
    const aliases = [...(to.aliases ?? [])]
    for (const name of [from.nameAr, from.nameEn, ...(from.aliases ?? [])]) {
      const trimmed = name.trim()
      if (trimmed && !known.has(trimmed)) {
        aliases.push(trimmed)
        known.add(trimmed)
      }
    }
    await db.products.update(toProductId, { aliases })

    await db.productIngredients.where('productId').equals(fromProductId).delete()
    await db.products.delete(fromProductId)
  })
  return snap
}
