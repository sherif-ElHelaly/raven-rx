import { beforeEach, describe, expect, it } from 'vitest'
import { exportBackup, importBackup } from './backup'
import { describeItems, markAllFound, saveCaseAsRegularMeds } from './cases'
import { deleteMeds, mergePresentation, mergeProduct, presentationUsage, restoreSnapshot } from './medEdit'
import {
  addItem,
  addPresentation,
  createProduct,
  createRequest,
  findOrCreatePerson,
  getAlternatives,
  knownLocationsByProduct,
  lastFoundWhere,
  linkedProductIds,
  linkProducts,
  removeItem,
  setItemQty,
  setItemStatus,
  setRegularMeds,
  shoppingList,
  substituteItem,
  undoSubstitute,
  unlinkProducts,
} from './repo'
import { SarfDB } from './schema'

let db: SarfDB
let dbCounter = 0

beforeEach(() => {
  db = new SarfDB(`sarf-alt-test-${dbCounter++}`)
})

async function med(nameEn: string, strength = '80 mg', extra: { nameAr?: string; unregistered?: boolean } = {}) {
  const productId = await createProduct(
    db,
    { nameEn, nameAr: extra.nameAr ?? nameEn, categories: [], verified: false, unregistered: extra.unregistered },
    [],
  )
  const presentationId = await addPresentation(db, {
    productId,
    strength,
    form: 'tablet',
    fridge: false,
    controlled: false,
  })
  return { productId, presentationId }
}

async function newCase() {
  const person = await findOrCreatePerson(db, '111')
  const requestId = await createRequest(db, person.id!, 'monthly')
  return { personId: person.id!, requestId }
}

describe('بديل links', () => {
  it('links both ways, ignores duplicates and self-links, and unlinks', async () => {
    const a = await med('Tareg')
    const b = await med('تارج سكان', '80 mg', { unregistered: true })
    expect(await linkProducts(db, a.productId, b.productId)).not.toBeNull()
    expect(await linkProducts(db, b.productId, a.productId)).toBeNull()
    expect(await linkProducts(db, a.productId, a.productId)).toBeNull()
    expect(await linkedProductIds(db, b.productId)).toEqual([a.productId])
    await unlinkProducts(db, b.productId, a.productId)
    expect(await linkedProductIds(db, a.productId)).toEqual([])
  })

  it('shows linked products as alternatives even without ingredients', async () => {
    const a = await med('Tareg')
    const b = await med('Valzek')
    expect(await getAlternatives(db, a.presentationId)).toEqual([])
    await linkProducts(db, a.productId, b.productId)
    const alts = await getAlternatives(db, a.presentationId)
    expect(alts.map((x) => [x.product.nameEn, x.tier])).toEqual([['Valzek', 'linked']])
  })

  it('does not duplicate a linked product already matched by ingredients', async () => {
    const tareg = await createProduct(db, { nameEn: 'Tareg', nameAr: 't', categories: [], verified: true }, ['valsartan'])
    const valzek = await createProduct(db, { nameEn: 'Valzek', nameAr: 'v', categories: [], verified: true }, ['valsartan'])
    const pres = await addPresentation(db, { productId: tareg, strength: '80 mg', form: 'tablet', fridge: false, controlled: false })
    await addPresentation(db, { productId: valzek, strength: '80 mg', form: 'tablet', fridge: false, controlled: false })
    await linkProducts(db, tareg, valzek)
    const alts = await getAlternatives(db, pres)
    expect(alts.map((x) => x.tier)).toEqual(['exact'])
  })
})

describe('substituteItem', () => {
  it('records the بديل, learns a link, and undo reverts both', async () => {
    const a = await med('Tareg')
    const b = await med('Valzek')
    const { requestId } = await newCase()
    const itemId = await addItem(db, requestId, a.presentationId, 2)

    const result = await substituteItem(db, itemId, b.presentationId)
    expect((await db.items.get(itemId))!.substitutedWithId).toBe(b.presentationId)
    expect(result.createdLinkId).not.toBeNull()
    expect(await linkedProductIds(db, a.productId)).toEqual([b.productId])

    const display = (await describeItems(db, [(await db.items.get(itemId))!])).get(itemId)!
    expect(display.label).toBe('Valzek 80 mg tablet')
    expect(display.substituteFor).toBe('Tareg 80 mg tablet')
    expect(display.productId).toBe(b.productId)

    await undoSubstitute(db, itemId, result)
    expect((await db.items.get(itemId))!.substitutedWithId).toBeUndefined()
    expect(await linkedProductIds(db, a.productId)).toEqual([])
  })

  it('keeps an existing link on undo and needs no link for another strength', async () => {
    const a = await med('Tareg')
    const b = await med('Valzek')
    const a160 = await addPresentation(db, { productId: a.productId, strength: '160 mg', form: 'tablet', fridge: false, controlled: false })
    await linkProducts(db, a.productId, b.productId)
    const { requestId } = await newCase()
    const itemId = await addItem(db, requestId, a.presentationId, 1)

    const r1 = await substituteItem(db, itemId, b.presentationId)
    expect(r1.createdLinkId).toBeNull()
    await undoSubstitute(db, itemId, r1)
    expect(await linkedProductIds(db, a.productId)).toEqual([b.productId])

    const r2 = await substituteItem(db, itemId, a160)
    expect(r2.createdLinkId).toBeNull()
    await substituteItem(db, itemId, null)
    expect((await db.items.get(itemId))!.substitutedWithId).toBeUndefined()
  })

  it('files where the بديل was found under the بديل, not the prescribed med', async () => {
    const a = await med('Tareg')
    const b = await med('Valzek')
    const loc = await db.locations.add({ name: 'El Ezaby', type: 'civilian_pharmacy', needsTransferSlip: false })
    const { requestId } = await newCase()
    const itemId = await addItem(db, requestId, a.presentationId, 1)
    await substituteItem(db, itemId, b.presentationId)
    await setItemStatus(db, itemId, 'found', { locationId: loc as number })
    await setItemStatus(db, itemId, 'delivered', { locationId: loc as number })

    const known = await knownLocationsByProduct(db)
    expect(known.get(b.productId)?.foundAt).toBe(loc)
    expect(known.has(a.productId)).toBe(false)
    expect((await lastFoundWhere(db, b.productId))?.locationName).toBe('El Ezaby')
    expect(await lastFoundWhere(db, a.productId)).toBeNull()
  })

  it('lists a searching بديل on the shopping list under its own name', async () => {
    const a = await med('Tareg')
    const b = await med('Valzek')
    const { requestId } = await newCase()
    const itemId = await addItem(db, requestId, a.presentationId, 3)
    await substituteItem(db, itemId, b.presentationId)
    const lines = await shoppingList(db)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ productName: 'Valzek', substituteFor: 'Tareg', qty: 3 })
  })

  it('marks a بديل found at the بديل’s remembered pharmacy', async () => {
    const a = await med('Tareg')
    const b = await med('Valzek')
    const loc = (await db.locations.add({ name: 'Seif', type: 'civilian_pharmacy', needsTransferSlip: false })) as number
    const earlier = await newCase()
    const old = await addItem(db, earlier.requestId, b.presentationId, 1)
    await setItemStatus(db, old, 'found', { locationId: loc })

    const { requestId } = await createRequest(db, earlier.personId, 'monthly').then((id) => ({ requestId: id }))
    const itemId = await addItem(db, requestId, a.presentationId, 1)
    await substituteItem(db, itemId, b.presentationId)
    expect(await markAllFound(db, requestId)).toEqual([])
    expect((await db.items.get(itemId))!.foundAtLocationId).toBe(loc)
  })
})

describe('editing a case', () => {
  it('changes qty (min 1) and removes a line', async () => {
    const a = await med('Tareg')
    const { requestId } = await newCase()
    const itemId = await addItem(db, requestId, a.presentationId, 2)
    await setItemQty(db, itemId, 0)
    expect((await db.items.get(itemId))!.qty).toBe(1)
    const removed = await removeItem(db, itemId)
    expect(removed?.id).toBe(itemId)
    expect(await db.items.count()).toBe(0)
  })

  it('saves a case’s prescribed meds as regular meds, skipping cancelled', async () => {
    const a = await med('Tareg')
    const b = await med('Valzek')
    const c = await med('Concor', '5 mg')
    const { requestId, personId } = await newCase()
    await setRegularMeds(db, personId, [{ presentationId: c.presentationId, qty: 1 }])
    const i1 = await addItem(db, requestId, a.presentationId, 2)
    await substituteItem(db, i1, b.presentationId)
    const i2 = await addItem(db, requestId, c.presentationId, 1)
    await setItemStatus(db, i2, 'cancelled')

    const previous = await saveCaseAsRegularMeds(db, requestId)
    expect(previous).toEqual([{ presentationId: c.presentationId, qty: 1 }])
    expect((await db.people.get(personId))!.regularMeds).toEqual([{ presentationId: a.presentationId, qty: 2 }])
  })
})

describe('cleaning up unregistered meds', () => {
  it('merges a misread drug into the right one everywhere, and undo restores it', async () => {
    const wrong = await med('تارح', '80 mg', { nameAr: 'تارح', unregistered: true })
    const wrong40 = await addPresentation(db, { productId: wrong.productId, strength: '40 mg', form: 'tablet', fridge: false, controlled: false, unregistered: true })
    const right = await med('Tareg', '80 mg', { nameAr: 'تارج' })
    const other = await med('Valzek')
    await linkProducts(db, wrong.productId, other.productId)
    const { requestId, personId } = await newCase()
    const itemId = await addItem(db, requestId, wrong.presentationId, 1)
    const item40 = await addItem(db, requestId, wrong40, 1)
    await setRegularMeds(db, personId, [{ presentationId: wrong.presentationId, qty: 1 }])

    const snap = await mergeProduct(db, wrong.productId, right.productId)

    expect(await db.products.get(wrong.productId)).toBeUndefined()
    expect((await db.items.get(itemId))!.presentationId).toBe(right.presentationId)
    // The 40 mg strength the target lacked moves over, still flagged to check.
    expect((await db.presentations.get(wrong40))!.productId).toBe(right.productId)
    expect((await db.items.get(item40))!.presentationId).toBe(wrong40)
    expect((await db.people.get(personId))!.regularMeds).toEqual([{ presentationId: right.presentationId, qty: 1 }])
    expect((await db.products.get(right.productId))!.aliases).toEqual(['تارح'])
    expect(await linkedProductIds(db, right.productId)).toEqual([other.productId])

    await restoreSnapshot(db, snap)
    expect((await db.products.get(wrong.productId))!.nameAr).toBe('تارح')
    expect((await db.items.get(itemId))!.presentationId).toBe(wrong.presentationId)
    expect((await db.presentations.get(wrong40))!.productId).toBe(wrong.productId)
    expect((await db.products.get(right.productId))!.aliases).toBeUndefined()
    expect(await linkedProductIds(db, wrong.productId)).toEqual([other.productId])
  })

  it('merges a misread strength and clears a بديل that becomes the prescribed med', async () => {
    const a = await med('Tareg', '80 mg')
    const wrong = await addPresentation(db, { productId: a.productId, strength: '8 mg', form: 'tablet', fridge: false, controlled: false, unregistered: true })
    const { requestId } = await newCase()
    const i1 = await addItem(db, requestId, wrong, 1)
    const i2 = await addItem(db, requestId, a.presentationId, 1)
    await substituteItem(db, i2, wrong)

    await mergePresentation(db, wrong, a.presentationId)
    expect(await db.presentations.get(wrong)).toBeUndefined()
    expect((await db.items.get(i1))!.presentationId).toBe(a.presentationId)
    expect((await db.items.get(i2))!.substitutedWithId).toBeUndefined()
  })

  it('deletes an unused med, refuses a used one unless its case lines go too', async () => {
    const junk = await med('ضضض', '', { unregistered: true })
    const { requestId } = await newCase()
    const itemId = await addItem(db, requestId, junk.presentationId, 1)

    const usage = await presentationUsage(db, [junk.presentationId])
    expect(usage).toMatchObject({ itemIds: [itemId], caseCount: 1, substituteCount: 0 })
    await expect(
      deleteMeds(db, { productId: junk.productId, presentationIds: [] }, { removeCaseLines: false }),
    ).rejects.toThrow()
    expect(await db.products.get(junk.productId)).toBeDefined()

    const snap = await deleteMeds(db, { productId: junk.productId, presentationIds: [] }, { removeCaseLines: true })
    expect(await db.products.get(junk.productId)).toBeUndefined()
    expect(await db.presentations.get(junk.presentationId)).toBeUndefined()
    expect(await db.items.get(itemId)).toBeUndefined()

    await restoreSnapshot(db, snap)
    expect(await db.items.get(itemId)).toBeDefined()
    expect(await db.products.get(junk.productId)).toBeDefined()
  })
})

describe('backup', () => {
  it('round-trips بديل links and accepts older backups without them', async () => {
    const a = await med('Tareg')
    const b = await med('Valzek')
    await linkProducts(db, a.productId, b.productId)
    const data = await exportBackup(db)
    expect(data.productLinks).toHaveLength(1)

    const restored = new SarfDB(`sarf-alt-test-${dbCounter++}`)
    await importBackup(restored, data)
    expect(await restored.productLinks.count()).toBe(1)

    const { productLinks: _drop, ...old } = data
    await importBackup(restored, old)
    expect(await restored.productLinks.count()).toBe(0)
  })
})
