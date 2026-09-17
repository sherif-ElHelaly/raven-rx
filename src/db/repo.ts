// Business logic on top of the raw Dexie schema — VISION.md §2-§4.

import type { ParsedRow } from './seedImport'
import type { SarfDB } from './schema'
import type {
  Category,
  Form,
  Item,
  ItemStatus,
  Location,
  LocationType,
  Person,
  Plan,
  Presentation,
  Product,
  RegularMed,
  Request,
  StatusHistoryEntry,
} from './types'

export const OPEN_STATUSES: ItemStatus[] = ['searching', 'found', 'transferred']
export const CLOSED_STATUSES: ItemStatus[] = ['delivered', 'unavailable', 'cancelled']

// Dexie types an auto-increment `add()` as resolving to the (optional) key
// property's type, i.e. `number | undefined` since our entities declare
// `id?: number` for the pre-insert state. At runtime it's always a number.
async function addEntity(promise: Promise<number | undefined>): Promise<number> {
  return (await promise)!
}

export function feeForPlan(plan: Plan): number {
  return plan === 'monthly' ? 5 : 10
}

export function nextDueDate(createdAt: number, plan: Plan): number {
  const d = new Date(createdAt)
  d.setMonth(d.getMonth() + (plan === 'monthly' ? 1 : 2))
  return d.getTime()
}

// ---------------------------------------------------------------------------
// Ingredients / Products / Presentations (drug DB)
// ---------------------------------------------------------------------------

export async function upsertIngredientByName(
  db: SarfDB,
  nameEn: string,
  nameAr?: string,
): Promise<number> {
  const trimmed = nameEn.trim()
  const existing = await db.ingredients
    .filter((i) => i.nameEn.toLowerCase() === trimmed.toLowerCase())
    .first()
  if (existing) return existing.id!
  return addEntity(db.ingredients.add({ nameEn: trimmed, nameAr }))
}

export async function setProductIngredients(
  db: SarfDB,
  productId: number,
  ingredientNames: string[],
): Promise<void> {
  const ingredientIds = await Promise.all(
    ingredientNames
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => upsertIngredientByName(db, n)),
  )

  await db.transaction('rw', db.productIngredients, async () => {
    await db.productIngredients.where('productId').equals(productId).delete()
    await Promise.all(
      ingredientIds.map((ingredientId) =>
        db.productIngredients.add({ productId, ingredientId }),
      ),
    )
  })
}

export async function createProduct(
  db: SarfDB,
  data: Omit<Product, 'id'>,
  ingredientNames: string[],
): Promise<number> {
  const productId = await addEntity(db.products.add(data))
  await setProductIngredients(db, productId, ingredientNames)
  return productId
}

export async function updateProduct(
  db: SarfDB,
  id: number,
  data: Partial<Omit<Product, 'id'>>,
  ingredientNames?: string[],
): Promise<void> {
  await db.products.update(id, data)
  if (ingredientNames) {
    await setProductIngredients(db, id, ingredientNames)
  }
}

export async function addPresentation(
  db: SarfDB,
  data: Omit<Presentation, 'id'>,
): Promise<number> {
  return addEntity(db.presentations.add(data))
}

export async function updatePresentation(
  db: SarfDB,
  id: number,
  data: Partial<Omit<Presentation, 'id'>>,
): Promise<void> {
  await db.presentations.update(id, data)
}

export async function getIngredientNamesForProduct(
  db: SarfDB,
  productId: number,
): Promise<string[]> {
  const links = await db.productIngredients.where('productId').equals(productId).toArray()
  const ingredients = await db.ingredients.bulkGet(links.map((l) => l.ingredientId))
  return ingredients.filter((i): i is NonNullable<typeof i> => !!i).map((i) => i.nameEn)
}

export interface CategoryCount {
  category: Category
  count: number
}

export async function categoryCounts(db: SarfDB): Promise<CategoryCount[]> {
  const products = await db.products.toArray()
  const counts = new Map<Category, number>()
  for (const p of products) {
    for (const c of p.categories) {
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
}

// ---------------------------------------------------------------------------
// Person / Request / Item
// ---------------------------------------------------------------------------

export async function findPersonByCard(
  db: SarfDB,
  cardNumber: string,
): Promise<Person | undefined> {
  return db.people.where('cardNumber').equals(cardNumber).first()
}

export async function findOrCreatePerson(
  db: SarfDB,
  cardNumber: string,
  extra?: Partial<Omit<Person, 'id' | 'cardNumber'>>,
): Promise<Person> {
  const existing = await findPersonByCard(db, cardNumber)
  if (existing) return existing
  const id = await addEntity(db.people.add({ cardNumber, ...extra }))
  return { id, cardNumber, ...extra }
}

export async function createRequest(
  db: SarfDB,
  personId: number,
  plan: Plan,
  notes?: string,
  createdAt: number = Date.now(),
): Promise<number> {
  const request: Omit<Request, 'id'> = {
    personId,
    createdAt,
    plan,
    feePerItem: feeForPlan(plan),
    registered: false,
    approved: false,
    paid: false,
    notes,
    nextDueDate: nextDueDate(createdAt, plan),
    feeRefunded: false,
  }
  return addEntity(db.requests.add(request))
}

// True if this person already has an OPEN item (searching/found/transferred)
// for the given product, across any of their requests. VISION §5.2:
// duplicate warning never blocks, it just informs.
export async function hasOpenDuplicate(
  db: SarfDB,
  personId: number,
  productId: number,
): Promise<boolean> {
  const requests = await db.requests.where('personId').equals(personId).toArray()
  const requestIds = new Set(requests.map((r) => r.id!))
  if (requestIds.size === 0) return false

  const items = await db.items
    .where('requestId')
    .anyOf([...requestIds])
    .toArray()

  const presentationIds = [...new Set(items.map((i) => i.presentationId))]
  const presentations = await db.presentations.bulkGet(presentationIds)
  const productIdByPresentationId = new Map(
    presentations
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => [p.id!, p.productId]),
  )

  return items.some(
    (item) =>
      OPEN_STATUSES.includes(item.status) &&
      productIdByPresentationId.get(item.presentationId) === productId,
  )
}

export async function addItem(
  db: SarfDB,
  requestId: number,
  presentationId: number,
  qty: number,
): Promise<number> {
  const item: Omit<Item, 'id'> = {
    requestId,
    presentationId,
    qty,
    status: 'searching',
    feeRefunded: false,
    statusHistory: [{ status: 'searching', at: Date.now() }],
  }
  return addEntity(db.items.add(item))
}

// Natural next state per VISION §4. `transferred` and `found` both lead
// onward to `delivered`; `searching` needs a location to become `found`,
// which the caller resolves before calling setItemStatus.
export function nextStatus(current: ItemStatus): ItemStatus | null {
  switch (current) {
    case 'searching':
      return 'found'
    case 'found':
      return 'delivered'
    case 'transferred':
      return 'found'
    default:
      return null
  }
}

export async function setItemStatus(
  db: SarfDB,
  itemId: number,
  status: ItemStatus,
  opts?: { locationId?: number; transferSlipRef?: string },
): Promise<void> {
  const item = await db.items.get(itemId)
  if (!item) throw new Error(`Item ${itemId} not found`)

  const entry: StatusHistoryEntry = {
    status,
    at: Date.now(),
    locationId: opts?.locationId,
  }

  const patch: Partial<Item> = {
    status,
    statusHistory: [...item.statusHistory, entry],
  }
  if (status === 'found') patch.foundAtLocationId = opts?.locationId
  if (status === 'transferred') {
    patch.transferToLocationId = opts?.locationId
    patch.transferSlipRef = opts?.transferSlipRef
  }
  if (status === 'delivered') patch.deliveredAt = entry.at

  await db.items.update(itemId, patch)
}

// ---------------------------------------------------------------------------
// Alternatives (بديل) — VISION §5.1. Combination products match the whole
// ingredient set, so Co-Tareg never shows as exact/close for Tareg.
// ---------------------------------------------------------------------------

export type AlternativeTier = 'exact' | 'close' | 'class'

export interface AlternativeItem {
  tier: AlternativeTier
  product: Product
  presentation: Presentation
}

async function ingredientSetsByProduct(db: SarfDB): Promise<Map<number, Set<number>>> {
  const links = await db.productIngredients.toArray()
  const map = new Map<number, Set<number>>()
  for (const l of links) {
    const set = map.get(l.productId) ?? new Set<number>()
    set.add(l.ingredientId)
    map.set(l.productId, set)
  }
  return map
}

function sameIngredientSet(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

export async function getAlternatives(
  db: SarfDB,
  presentationId: number,
): Promise<AlternativeItem[]> {
  const presentation = await db.presentations.get(presentationId)
  if (!presentation) return []
  const product = await db.products.get(presentation.productId)
  if (!product) return []

  const [sets, allProducts, allPresentations, allIngredients] = await Promise.all([
    ingredientSetsByProduct(db),
    db.products.toArray(),
    db.presentations.toArray(),
    db.ingredients.toArray(),
  ])
  const ingredientById = new Map(allIngredients.map((i) => [i.id!, i]))
  const presentationsByProductId = new Map<number, Presentation[]>()
  for (const p of allPresentations) {
    const list = presentationsByProductId.get(p.productId) ?? []
    list.push(p)
    presentationsByProductId.set(p.productId, list)
  }

  const sourceSet = sets.get(product.id!) ?? new Set<number>()
  const results: AlternativeItem[] = []
  const matchedProductIds = new Set<number>()

  if (sourceSet.size > 0) {
    for (const other of allProducts) {
      if (other.id === product.id) continue
      const otherSet = sets.get(other.id!) ?? new Set<number>()
      if (otherSet.size === 0 || !sameIngredientSet(sourceSet, otherSet)) continue
      matchedProductIds.add(other.id!)
      for (const pres of presentationsByProductId.get(other.id!) ?? []) {
        const tier: AlternativeTier =
          pres.strength === presentation.strength && pres.form === presentation.form
            ? 'exact'
            : 'close'
        results.push({ tier, product: other, presentation: pres })
      }
    }
  }

  // 🔴 same drug class only: therapeutic alternative, needs prescriber
  // approval. Only meaningful for single-ingredient products — a
  // combination's "class" isn't well-defined by one ingredient.
  if (sourceSet.size === 1) {
    const ingredientId = [...sourceSet][0]!
    const drugClass = ingredientById.get(ingredientId)?.drugClass
    if (drugClass) {
      for (const other of allProducts) {
        if (other.id === product.id || matchedProductIds.has(other.id!)) continue
        const otherSet = sets.get(other.id!) ?? new Set<number>()
        if (otherSet.size !== 1) continue
        const otherIngredientId = [...otherSet][0]!
        if (otherIngredientId === ingredientId) continue
        if (ingredientById.get(otherIngredientId)?.drugClass !== drugClass) continue
        for (const pres of presentationsByProductId.get(other.id!) ?? []) {
          results.push({ tier: 'class', product: other, presentation: pres })
        }
      }
    }
  }

  const tierOrder: Record<AlternativeTier, number> = { exact: 0, close: 1, class: 2 }
  results.sort(
    (a, b) => tierOrder[a.tier] - tierOrder[b.tier] || a.product.nameEn.localeCompare(b.product.nameEn),
  )
  return results
}

// ---------------------------------------------------------------------------
// "Last found where" — VISION §5.1, from delivered-item history.
// ---------------------------------------------------------------------------

export interface LastFoundInfo {
  locationId: number
  locationName: string
  lastAt: number
  count: number
}

export async function lastFoundWhere(db: SarfDB, productId: number): Promise<LastFoundInfo | null> {
  const presentations = await db.presentations.where('productId').equals(productId).toArray()
  const presentationIds = new Set(presentations.map((p) => p.id!))
  if (presentationIds.size === 0) return null

  const delivered = await db.items.where('status').equals('delivered').toArray()
  const relevant = delivered.filter(
    (i) => presentationIds.has(i.presentationId) && i.foundAtLocationId != null,
  )
  if (relevant.length === 0) return null

  let mostRecent: { locationId: number; at: number } | null = null
  for (const item of relevant) {
    const locationId = item.foundAtLocationId!
    const foundEntry = [...item.statusHistory]
      .reverse()
      .find((h) => h.status === 'found' && h.locationId === locationId)
    const at = foundEntry?.at ?? item.deliveredAt ?? 0
    if (!mostRecent || at > mostRecent.at) mostRecent = { locationId, at }
  }
  if (!mostRecent) return null

  const location = await db.locations.get(mostRecent.locationId)
  return {
    locationId: mostRecent.locationId,
    locationName: location?.name ?? 'Unknown location',
    lastAt: mostRecent.at,
    count: relevant.length,
  }
}

// ---------------------------------------------------------------------------
// Locations — VISION §5.4. Location sheets sort by most used.
// ---------------------------------------------------------------------------

export async function locationUsageCounts(db: SarfDB): Promise<Map<number, number>> {
  const items = await db.items.toArray()
  const counts = new Map<number, number>()
  for (const item of items) {
    if (item.foundAtLocationId != null) {
      counts.set(item.foundAtLocationId, (counts.get(item.foundAtLocationId) ?? 0) + 1)
    }
    if (item.transferToLocationId != null) {
      counts.set(item.transferToLocationId, (counts.get(item.transferToLocationId) ?? 0) + 1)
    }
  }
  return counts
}

export async function mostUsedLocations(db: SarfDB, type?: LocationType): Promise<Location[]> {
  const [locations, counts] = await Promise.all([db.locations.toArray(), locationUsageCounts(db)])
  const filtered = type ? locations.filter((l) => l.type === type) : locations
  return [...filtered].sort((a, b) => (counts.get(b.id!) ?? 0) - (counts.get(a.id!) ?? 0))
}

// ---------------------------------------------------------------------------
// Home dashboard — VISION §5.5.
// ---------------------------------------------------------------------------

export interface DueEntry {
  request: Request
  person: Person
}

// One entry per person (their nearest upcoming due date), for persons whose
// next due date falls within `withinDays`.
export async function dueSoon(db: SarfDB, withinDays = 5): Promise<DueEntry[]> {
  const now = Date.now()
  const horizon = now + withinDays * 24 * 60 * 60 * 1000
  const requests = await db.requests.toArray()
  const due = requests.filter((r) => r.nextDueDate >= now && r.nextDueDate <= horizon)

  const nearestByPerson = new Map<number, Request>()
  for (const r of due) {
    const existing = nearestByPerson.get(r.personId)
    if (!existing || r.nextDueDate < existing.nextDueDate) nearestByPerson.set(r.personId, r)
  }

  const personIds = [...nearestByPerson.keys()]
  const people = await db.people.bulkGet(personIds)
  const personById = new Map(people.filter((p): p is Person => !!p).map((p) => [p.id!, p]))

  return personIds
    .map((id) => ({ request: nearestByPerson.get(id)!, person: personById.get(id)! }))
    .filter((e): e is DueEntry => !!e.person)
    .sort((a, b) => a.request.nextDueDate - b.request.nextDueDate)
}

// ---------------------------------------------------------------------------
// Renew + regular meds — VISION §5.2.
// ---------------------------------------------------------------------------

export async function updatePerson(
  db: SarfDB,
  id: number,
  data: Partial<Omit<Person, 'id'>>,
): Promise<void> {
  await db.people.update(id, data)
}

export async function setRegularMeds(db: SarfDB, personId: number, meds: RegularMed[]): Promise<void> {
  await db.people.update(personId, { regularMeds: meds })
}

// Copies a person's regular medications into a freshly created request with
// the given plan. VISION §5.2: "One tap on a person or past request copies
// their regular medications into a new request with the same plan."
export async function createRenewalRequest(
  db: SarfDB,
  personId: number,
  plan: Plan,
): Promise<number> {
  const person = await db.people.get(personId)
  const requestId = await createRequest(db, personId, plan)
  for (const med of person?.regularMeds ?? []) {
    await addItem(db, requestId, med.presentationId, med.qty)
  }
  return requestId
}

// ---------------------------------------------------------------------------
// Shopping list per location — VISION §5.3.
// ---------------------------------------------------------------------------

export interface ShoppingLine {
  groupKey: string
  groupLabel: string
  locationId?: number
  presentationId: number
  productName: string
  presentationLabel: string
  qty: number
  itemIds: number[]
}

export async function shoppingList(db: SarfDB): Promise<ShoppingLine[]> {
  const items = await db.items.where('status').anyOf(['searching', 'transferred']).toArray()
  if (items.length === 0) return []

  const presentationIds = [...new Set(items.map((i) => i.presentationId))]
  const presentations = await db.presentations.bulkGet(presentationIds)
  const presentationById = new Map(
    presentations.filter((p): p is Presentation => !!p).map((p) => [p.id!, p]),
  )
  const productIds = [...new Set([...presentationById.values()].map((p) => p.productId))]
  const products = await db.products.bulkGet(productIds)
  const productById = new Map(products.filter((p): p is Product => !!p).map((p) => [p.id!, p]))
  // Searching meds are listed under the pharmacy they were last found at, so
  // the list matches where you'll actually go; unknown ones stay generic.
  const known = await knownLocationsByProduct(db)
  const targetLocation = (item: Item): number | undefined => {
    if (item.status === 'transferred') return item.transferToLocationId
    const productId = presentationById.get(item.presentationId)?.productId
    return productId !== undefined ? known.get(productId)?.foundAt : undefined
  }
  const locationIds = [
    ...new Set(items.map(targetLocation).filter((id): id is number => id != null)),
  ]
  const locations = await db.locations.bulkGet(locationIds)
  const locationById = new Map(locations.filter((l): l is Location => !!l).map((l) => [l.id!, l]))

  const lineByKey = new Map<string, ShoppingLine>()
  for (const item of items) {
    const locationId = targetLocation(item)
    const groupKey = locationId != null ? `loc-${locationId}` : 'hospital'
    const groupLabel =
      locationId != null
        ? (locationById.get(locationId)?.name ?? 'Unknown location')
        : 'Hospital pharmacies'
    const key = `${groupKey}:${item.presentationId}`
    const pres = presentationById.get(item.presentationId)
    const prod = pres ? productById.get(pres.productId) : undefined

    const existing = lineByKey.get(key)
    if (existing) {
      existing.qty += item.qty
      existing.itemIds.push(item.id!)
    } else {
      lineByKey.set(key, {
        groupKey,
        groupLabel,
        locationId,
        presentationId: item.presentationId,
        productName: prod?.nameEn ?? 'Unknown',
        presentationLabel: [pres?.strength, pres?.form].filter(Boolean).join(' '),
        qty: item.qty,
        itemIds: [item.id!],
      })
    }
  }

  return [...lineByKey.values()].sort(
    (a, b) => a.groupLabel.localeCompare(b.groupLabel) || a.productName.localeCompare(b.productName),
  )
}

// ---------------------------------------------------------------------------
// Remembered pharmacies: where each drug was last found / transferred to.
// Learned from status history, so registering it once is enough.
// ---------------------------------------------------------------------------

export interface KnownLocations {
  foundAt?: number
  transferTo?: number
}

export async function knownLocationsByProduct(db: SarfDB): Promise<Map<number, KnownLocations>> {
  const [items, presentations] = await Promise.all([
    db.items.toArray(),
    db.presentations.toArray(),
  ])
  const productByPresentation = new Map(presentations.map((p) => [p.id!, p.productId]))
  const latest = new Map<number, { found?: [number, number]; transfer?: [number, number] }>()

  for (const item of items) {
    const productId = productByPresentation.get(item.presentationId)
    if (productId === undefined) continue
    const entry = latest.get(productId) ?? {}
    for (const h of item.statusHistory) {
      if (h.locationId == null) continue
      if (h.status === 'found' && (!entry.found || h.at >= entry.found[1])) {
        entry.found = [h.locationId, h.at]
      }
      if (h.status === 'transferred' && (!entry.transfer || h.at >= entry.transfer[1])) {
        entry.transfer = [h.locationId, h.at]
      }
    }
    latest.set(productId, entry)
  }

  const result = new Map<number, KnownLocations>()
  for (const [productId, e] of latest) {
    if (e.found || e.transfer) {
      result.set(productId, { foundAt: e.found?.[0], transferTo: e.transfer?.[0] })
    }
  }
  return result
}

export async function markLineFound(db: SarfDB, itemIds: number[], locationId: number): Promise<void> {
  for (const itemId of itemIds) {
    await setItemStatus(db, itemId, 'found', { locationId })
  }
}

// ---------------------------------------------------------------------------
// CSV import with preview diff — VISION §5.7, seed/SEED_FORMAT.md.
// ---------------------------------------------------------------------------

export type ImportRowKind = 'new-product' | 'new-presentation' | 'existing'

export interface ImportDiffEntry {
  brandEn: string
  strength: string
  form: Form
  kind: ImportRowKind
}

export interface ImportDiff {
  entries: ImportDiffEntry[]
  newProducts: number
  newPresentations: number
  existing: number
}

function presentationKey(productId: number, strength: string, form: string): string {
  return `${productId}:${strength}:${form}`
}

// Matches rows by product name + presentation (strength, form) — never by
// row order — so re-importing the seed or a partial export is idempotent.
export async function diffSeedImport(db: SarfDB, rows: ParsedRow[]): Promise<ImportDiff> {
  const [products, presentations] = await Promise.all([
    db.products.toArray(),
    db.presentations.toArray(),
  ])
  const productIdByName = new Map(products.map((p) => [p.nameEn.toLowerCase(), p.id!]))
  const presentationKeys = new Set(
    presentations.map((p) => presentationKey(p.productId, p.strength ?? '', p.form)),
  )

  const entries: ImportDiffEntry[] = rows.map((row) => {
    const productId = productIdByName.get(row.brandEn.toLowerCase())
    let kind: ImportRowKind
    if (productId === undefined) {
      kind = 'new-product'
    } else if (!presentationKeys.has(presentationKey(productId, row.strength, row.form))) {
      kind = 'new-presentation'
    } else {
      kind = 'existing'
    }
    return { brandEn: row.brandEn, strength: row.strength, form: row.form, kind }
  })

  return {
    entries,
    newProducts: entries.filter((e) => e.kind === 'new-product').length,
    newPresentations: entries.filter((e) => e.kind === 'new-presentation').length,
    existing: entries.filter((e) => e.kind === 'existing').length,
  }
}

// Applies only rows that are new (product or presentation) — existing data
// is left untouched, since the user may have hand-edited it since import.
export async function applySeedImport(
  db: SarfDB,
  rows: ParsedRow[],
): Promise<{ productsAdded: number; presentationsAdded: number }> {
  const products = await db.products.toArray()
  const productIdByName = new Map(products.map((p) => [p.nameEn.toLowerCase(), p.id!]))
  let productsAdded = 0
  let presentationsAdded = 0

  await db.transaction(
    'rw',
    [db.products, db.presentations, db.ingredients, db.productIngredients],
    async () => {
      for (const row of rows) {
        let productId = productIdByName.get(row.brandEn.toLowerCase())
        if (productId === undefined) {
          productId = await createProduct(
            db,
            {
              nameEn: row.brandEn,
              nameAr: row.brandAr,
              manufacturer: row.manufacturer,
              categories: row.categories,
              verified: row.confidence === 'high',
              notes: row.useEn,
            },
            row.ingredients,
          )
          productIdByName.set(row.brandEn.toLowerCase(), productId)
          productsAdded++
        }

        const existingPresentations = await db.presentations
          .where('productId')
          .equals(productId)
          .toArray()
        const already = existingPresentations.some(
          (p) => (p.strength ?? '') === row.strength && p.form === row.form,
        )
        if (!already) {
          await addPresentation(db, {
            productId,
            strength: row.strength || undefined,
            form: row.form,
            packSize: row.packSize,
            fridge: row.fridge,
            controlled: row.controlled,
          })
          presentationsAdded++
        }
      }
    },
  )

  return { productsAdded, presentationsAdded }
}

export type { Form }
