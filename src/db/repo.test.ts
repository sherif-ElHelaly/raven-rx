import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SarfDB } from './schema'
import {
  addItem,
  addPresentation,
  applySeedImport,
  createProduct,
  createRenewalRequest,
  createRequest,
  diffSeedImport,
  dueSoon,
  feeForPlan,
  findOrCreatePerson,
  getAlternatives,
  getIngredientNamesForProduct,
  hasOpenDuplicate,
  lastFoundWhere,
  markLineFound,
  mostUsedLocations,
  moneyOwed,
  nextDueDate,
  nextStatus,
  openItemsSummary,
  requestIsComplete,
  setFeeRefunded,
  setItemStatus,
  setProductIngredients,
  setRegularMeds,
  shoppingList,
  staleItems,
  upsertIngredientByName,
} from './repo'
import { parseSeedCsv } from './seedImport'

let db: SarfDB
let dbCounter = 0

beforeEach(() => {
  db = new SarfDB(`sarf-test-${dbCounter++}`)
})

describe('feeForPlan / nextDueDate', () => {
  it('charges 5 EGP monthly and 10 EGP bimonthly', () => {
    expect(feeForPlan('monthly')).toBe(5)
    expect(feeForPlan('bimonthly')).toBe(10)
  })

  it('advances one month for monthly, two for bimonthly', () => {
    const start = new Date('2026-01-15').getTime()
    expect(new Date(nextDueDate(start, 'monthly')).getUTCMonth()).toBe(1) // Feb
    expect(new Date(nextDueDate(start, 'bimonthly')).getUTCMonth()).toBe(2) // Mar
  })
})

describe('createProduct / setProductIngredients', () => {
  it('creates ingredients on demand and links them to the product', async () => {
    const productId = await createProduct(
      db,
      {
        nameEn: 'Co-Tareg',
        nameAr: 'كو-تارج',
        categories: ['cardiac'],
        verified: true,
      },
      ['valsartan', 'hydrochlorothiazide'],
    )
    const names = await getIngredientNamesForProduct(db, productId)
    expect(names.sort()).toEqual(['hydrochlorothiazide', 'valsartan'])
    expect(await db.ingredients.count()).toBe(2)
  })

  it('reuses an existing ingredient instead of duplicating it', async () => {
    const p1 = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      ['valsartan'],
    )
    const p2 = await createProduct(
      db,
      { nameEn: 'Co-Tareg', nameAr: 'كو-تارج', categories: ['cardiac'], verified: true },
      ['valsartan', 'hydrochlorothiazide'],
    )
    expect(await db.ingredients.count()).toBe(2)
    expect((await getIngredientNamesForProduct(db, p1))[0]).toBe('valsartan')
    expect(await getIngredientNamesForProduct(db, p2)).toContain('valsartan')
  })

  it('replaces the ingredient set when called again on the same product', async () => {
    const productId = await createProduct(
      db,
      { nameEn: 'X', nameAr: 'س', categories: ['cardiac'], verified: false },
      ['valsartan'],
    )
    await setProductIngredients(db, productId, ['pantoprazole'])
    expect(await getIngredientNamesForProduct(db, productId)).toEqual(['pantoprazole'])
  })
})

describe('findOrCreatePerson', () => {
  it('creates a person once and reuses them on the same card number', async () => {
    const first = await findOrCreatePerson(db, '12345')
    const second = await findOrCreatePerson(db, '12345', { name: 'ignored' })
    expect(first.id).toBe(second.id)
    expect(await db.people.count()).toBe(1)
  })
})

describe('hasOpenDuplicate', () => {
  it('flags an open item for the same product on the same card', async () => {
    const person = await findOrCreatePerson(db, '111')
    const productId = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      ['valsartan'],
    )
    const presentationId = await addPresentation(db, {
      productId,
      strength: '80 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    const requestId = await createRequest(db, person.id!, 'monthly')
    await addItem(db, requestId, presentationId, 1)

    expect(await hasOpenDuplicate(db, person.id!, productId)).toBe(true)
  })

  it('does not flag a closed (delivered) item', async () => {
    const person = await findOrCreatePerson(db, '222')
    const productId = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      ['valsartan'],
    )
    const presentationId = await addPresentation(db, {
      productId,
      strength: '80 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    const requestId = await createRequest(db, person.id!, 'monthly')
    const itemId = await addItem(db, requestId, presentationId, 1)
    await setItemStatus(db, itemId, 'delivered')

    expect(await hasOpenDuplicate(db, person.id!, productId)).toBe(false)
  })

  it('never flags across different people', async () => {
    const personA = await findOrCreatePerson(db, 'A')
    const personB = await findOrCreatePerson(db, 'B')
    const productId = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      ['valsartan'],
    )
    const presentationId = await addPresentation(db, {
      productId,
      strength: '80 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    const requestId = await createRequest(db, personA.id!, 'monthly')
    await addItem(db, requestId, presentationId, 1)

    expect(await hasOpenDuplicate(db, personB.id!, productId)).toBe(false)
  })
})

describe('nextStatus', () => {
  it('walks searching -> found -> delivered', () => {
    expect(nextStatus('searching')).toBe('found')
    expect(nextStatus('found')).toBe('delivered')
  })

  it('walks transferred -> found', () => {
    expect(nextStatus('transferred')).toBe('found')
  })

  it('has no natural next state once delivered/unavailable/cancelled', () => {
    expect(nextStatus('delivered')).toBeNull()
    expect(nextStatus('unavailable')).toBeNull()
    expect(nextStatus('cancelled')).toBeNull()
  })
})

describe('setItemStatus', () => {
  it('appends to statusHistory and stamps deliveredAt on delivery', async () => {
    const person = await findOrCreatePerson(db, '333')
    const productId = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      ['valsartan'],
    )
    const presentationId = await addPresentation(db, {
      productId,
      strength: '80 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    const requestId = await createRequest(db, person.id!, 'monthly')
    const itemId = await addItem(db, requestId, presentationId, 1)

    await setItemStatus(db, itemId, 'found', { locationId: 7 })
    let item = await db.items.get(itemId)
    expect(item!.foundAtLocationId).toBe(7)
    expect(item!.statusHistory).toHaveLength(2)

    await setItemStatus(db, itemId, 'delivered')
    item = await db.items.get(itemId)
    expect(item!.status).toBe('delivered')
    expect(item!.deliveredAt).toBeDefined()
    expect(item!.statusHistory).toHaveLength(3)
  })
})

describe('requestIsComplete', () => {
  it('is false while any item is still open', async () => {
    const person = await findOrCreatePerson(db, '444')
    const productId = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      ['valsartan'],
    )
    const presentationId = await addPresentation(db, {
      productId,
      strength: '80 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    const requestId = await createRequest(db, person.id!, 'monthly')
    const itemId = await addItem(db, requestId, presentationId, 1)
    expect(await requestIsComplete(db, requestId)).toBe(false)

    await setItemStatus(db, itemId, 'found')
    await setItemStatus(db, itemId, 'delivered')
    // delivered but fee not yet refunded
    expect(await requestIsComplete(db, requestId)).toBe(false)

    await setFeeRefunded(db, itemId, true)
    expect(await requestIsComplete(db, requestId)).toBe(true)
  })

  it('allows partial delivery: cancelled items do not need a refund', async () => {
    const person = await findOrCreatePerson(db, '555')
    const productId = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      ['valsartan'],
    )
    const presentationId = await addPresentation(db, {
      productId,
      strength: '80 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    const requestId = await createRequest(db, person.id!, 'monthly')
    const item1 = await addItem(db, requestId, presentationId, 1)
    const item2 = await addItem(db, requestId, presentationId, 1)

    await setItemStatus(db, item1, 'found')
    await setItemStatus(db, item1, 'delivered')
    await setFeeRefunded(db, item1, true)
    await setItemStatus(db, item2, 'unavailable')

    expect(await requestIsComplete(db, requestId)).toBe(true)
  })
})

describe('moneyOwed', () => {
  it('sums fees for delivered-but-not-refunded items only', async () => {
    const person = await findOrCreatePerson(db, '666')
    const productId = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      ['valsartan'],
    )
    const presentationId = await addPresentation(db, {
      productId,
      strength: '80 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    const requestId = await createRequest(db, person.id!, 'bimonthly') // 10 EGP/item
    const item1 = await addItem(db, requestId, presentationId, 1)
    const item2 = await addItem(db, requestId, presentationId, 1)

    await setItemStatus(db, item1, 'found')
    await setItemStatus(db, item1, 'delivered')
    await setItemStatus(db, item2, 'found')
    await setItemStatus(db, item2, 'delivered')
    await setFeeRefunded(db, item2, true)

    expect(await moneyOwed(db)).toBe(10) // only item1 still owed
  })
})

describe('getAlternatives', () => {
  it('tiers same-ingredient-set presentations exact vs close, and never matches a combination', async () => {
    const valsartan = 'valsartan'
    const tareg80 = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      [valsartan],
    )
    const presTareg80 = await addPresentation(db, {
      productId: tareg80,
      strength: '80 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })

    // Same ingredient, same strength/form -> exact.
    const generic = await createProduct(
      db,
      { nameEn: 'Valzek', nameAr: 'فالزيك', categories: ['cardiac'], verified: true },
      [valsartan],
    )
    await addPresentation(db, {
      productId: generic,
      strength: '80 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })

    // Same ingredient, different strength -> close.
    await addPresentation(db, {
      productId: generic,
      strength: '160 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })

    // Combination product sharing valsartan but not the whole set -> excluded.
    const coTareg = await createProduct(
      db,
      { nameEn: 'Co-Tareg', nameAr: 'كو-تارج', categories: ['cardiac'], verified: true },
      [valsartan, 'hydrochlorothiazide'],
    )
    await addPresentation(db, {
      productId: coTareg,
      strength: '80/12.5 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })

    const alternatives = await getAlternatives(db, presTareg80)
    const byProduct = new Map(alternatives.map((a) => [a.product.nameEn, a.tier]))

    expect(alternatives.some((a) => a.product.nameEn === 'Co-Tareg')).toBe(false)
    expect(alternatives.filter((a) => a.product.nameEn === 'Valzek')).toHaveLength(2)
    expect(
      alternatives.find((a) => a.product.nameEn === 'Valzek' && a.presentation.strength === '80 mg')
        ?.tier,
    ).toBe('exact')
    expect(
      alternatives.find((a) => a.product.nameEn === 'Valzek' && a.presentation.strength === '160 mg')
        ?.tier,
    ).toBe('close')
    expect(byProduct.has('Co-Tareg')).toBe(false)
  })

  it('offers a same-class therapeutic alternative only for single-ingredient products', async () => {
    const valsartanId = await upsertIngredientByName(db, 'valsartan')
    await db.ingredients.update(valsartanId, { drugClass: 'ARB' })
    const losartanId = await upsertIngredientByName(db, 'losartan')
    await db.ingredients.update(losartanId, { drugClass: 'ARB' })

    const tareg = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      ['valsartan'],
    )
    const presTareg = await addPresentation(db, {
      productId: tareg,
      strength: '80 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    const losardex = await createProduct(
      db,
      { nameEn: 'Losardex', nameAr: 'لوسارديكس', categories: ['cardiac'], verified: true },
      ['losartan'],
    )
    await addPresentation(db, {
      productId: losardex,
      strength: '50 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })

    const alternatives = await getAlternatives(db, presTareg)
    expect(alternatives.find((a) => a.product.nameEn === 'Losardex')?.tier).toBe('class')
  })
})

describe('lastFoundWhere', () => {
  it('reports the most recently used location and total delivered count', async () => {
    const person = await findOrCreatePerson(db, '777')
    const productId = await createProduct(
      db,
      { nameEn: 'Controloc', nameAr: 'كونترولوك', categories: ['gastric'], verified: true },
      ['pantoprazole'],
    )
    const presentationId = await addPresentation(db, {
      productId,
      strength: '40 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    const pharmacyA = await db.locations.add({
      name: 'Pharmacy A',
      type: 'hospital_pharmacy',
      needsTransferSlip: false,
    })
    const pharmacyB = await db.locations.add({
      name: 'Pharmacy B',
      type: 'hospital_pharmacy',
      needsTransferSlip: false,
    })

    const requestId = await createRequest(db, person.id!, 'monthly')
    const item1 = await addItem(db, requestId, presentationId, 1)
    await setItemStatus(db, item1, 'found', { locationId: pharmacyA })
    await setItemStatus(db, item1, 'delivered')

    const item2 = await addItem(db, requestId, presentationId, 1)
    await setItemStatus(db, item2, 'found', { locationId: pharmacyB })
    await setItemStatus(db, item2, 'delivered')

    const info = await lastFoundWhere(db, productId)
    expect(info?.locationName).toBe('Pharmacy B')
    expect(info?.count).toBe(2)
  })

  it('returns null when the product has never been delivered', async () => {
    const productId = await createProduct(
      db,
      { nameEn: 'Never Found', nameAr: 'غير موجود', categories: ['gastric'], verified: true },
      ['x'],
    )
    expect(await lastFoundWhere(db, productId)).toBeNull()
  })
})

describe('mostUsedLocations', () => {
  it('sorts locations by how often they are used, most first', async () => {
    const person = await findOrCreatePerson(db, '888')
    const productId = await createProduct(
      db,
      { nameEn: 'X', nameAr: 'س', categories: ['gastric'], verified: true },
      ['x'],
    )
    const presentationId = await addPresentation(db, {
      productId,
      strength: '1 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    const rare = await db.locations.add({
      name: 'Rarely Used',
      type: 'storage',
      needsTransferSlip: false,
    })
    const popular = await db.locations.add({
      name: 'Popular',
      type: 'storage',
      needsTransferSlip: false,
    })

    const requestId = await createRequest(db, person.id!, 'monthly')
    const item1 = await addItem(db, requestId, presentationId, 1)
    await setItemStatus(db, item1, 'found', { locationId: popular })
    const item2 = await addItem(db, requestId, presentationId, 1)
    await setItemStatus(db, item2, 'found', { locationId: popular })
    const item3 = await addItem(db, requestId, presentationId, 1)
    await setItemStatus(db, item3, 'found', { locationId: rare })

    const sorted = await mostUsedLocations(db)
    expect(sorted.map((l) => l.name)).toEqual(['Popular', 'Rarely Used'])
  })
})

describe('openItemsSummary', () => {
  it('counts items by open status only', async () => {
    const person = await findOrCreatePerson(db, '901')
    const productId = await createProduct(
      db,
      { nameEn: 'X', nameAr: 'س', categories: ['gastric'], verified: true },
      ['x'],
    )
    const presentationId = await addPresentation(db, {
      productId,
      strength: '1 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    const requestId = await createRequest(db, person.id!, 'monthly')
    const item1 = await addItem(db, requestId, presentationId, 1)
    const item2 = await addItem(db, requestId, presentationId, 1)
    const item3 = await addItem(db, requestId, presentationId, 1)
    await setItemStatus(db, item2, 'found')
    await setItemStatus(db, item3, 'found')
    await setItemStatus(db, item3, 'delivered')
    void item1

    expect(await openItemsSummary(db)).toEqual({ searching: 1, found: 1, transferred: 0 })
  })
})

describe('dueSoon', () => {
  it('lists persons whose nearest request falls within the window', async () => {
    const now = Date.now()
    const person = await findOrCreatePerson(db, '902')
    await db.requests.add({
      personId: person.id!,
      createdAt: now,
      plan: 'monthly',
      feePerItem: 5,
      registered: true,
      approved: true,
      paid: true,
      nextDueDate: now + 2 * 24 * 60 * 60 * 1000, // due in 2 days
    })
    const farPerson = await findOrCreatePerson(db, '903')
    await db.requests.add({
      personId: farPerson.id!,
      createdAt: now,
      plan: 'monthly',
      feePerItem: 5,
      registered: true,
      approved: true,
      paid: true,
      nextDueDate: now + 30 * 24 * 60 * 60 * 1000, // far in the future
    })

    const due = await dueSoon(db, 5)
    expect(due).toHaveLength(1)
    expect(due[0]!.person.cardNumber).toBe('902')
  })

  it('keeps only the nearest due request per person', async () => {
    const now = Date.now()
    const person = await findOrCreatePerson(db, '904')
    await db.requests.add({
      personId: person.id!,
      createdAt: now,
      plan: 'monthly',
      feePerItem: 5,
      registered: true,
      approved: true,
      paid: true,
      nextDueDate: now + 4 * 24 * 60 * 60 * 1000,
    })
    await db.requests.add({
      personId: person.id!,
      createdAt: now,
      plan: 'monthly',
      feePerItem: 5,
      registered: true,
      approved: true,
      paid: true,
      nextDueDate: now + 1 * 24 * 60 * 60 * 1000,
    })

    const due = await dueSoon(db, 5)
    expect(due).toHaveLength(1)
    expect(due[0]!.request.nextDueDate).toBe(now + 1 * 24 * 60 * 60 * 1000)
  })
})

describe('staleItems', () => {
  afterEach(() => vi.useRealTimers())

  it('flags open items created more than N days ago', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const person = await findOrCreatePerson(db, '905')
    const productId = await createProduct(
      db,
      { nameEn: 'X', nameAr: 'س', categories: ['gastric'], verified: true },
      ['x'],
    )
    const presentationId = await addPresentation(db, {
      productId,
      strength: '1 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    const requestId = await createRequest(db, person.id!, 'monthly')
    const oldItem = await addItem(db, requestId, presentationId, 1)

    vi.setSystemTime(new Date('2026-01-03T00:00:00Z')) // 2 days later
    const freshItem = await addItem(db, requestId, presentationId, 1)

    vi.setSystemTime(new Date('2026-01-05T00:00:00Z')) // oldItem is now 4 days old

    const stale = await staleItems(db, 3)
    expect(stale.map((i) => i.id)).toEqual([oldItem])
    void freshItem
  })
})

describe('createRenewalRequest / setRegularMeds', () => {
  it('copies regular meds into a new request with the given plan', async () => {
    const person = await findOrCreatePerson(db, '906')
    const productId = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      ['valsartan'],
    )
    const presentationId = await addPresentation(db, {
      productId,
      strength: '80 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    await setRegularMeds(db, person.id!, [{ presentationId, qty: 2 }])

    const requestId = await createRenewalRequest(db, person.id!, 'bimonthly')
    const items = await db.items.where('requestId').equals(requestId).toArray()
    expect(items).toHaveLength(1)
    expect(items[0]!.qty).toBe(2)
    expect(items[0]!.presentationId).toBe(presentationId)

    const request = await db.requests.get(requestId)
    expect(request!.plan).toBe('bimonthly')
  })
})

describe('shoppingList / markLineFound', () => {
  it('groups searching items under "Hospital pharmacies" and transferred items under their destination', async () => {
    const person = await findOrCreatePerson(db, '907')
    const productId = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      ['valsartan'],
    )
    const presentationId = await addPresentation(db, {
      productId,
      strength: '80 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    const civilianPharmacy = (await db.locations.add({
      name: 'El-Ezaby',
      type: 'civilian_pharmacy',
      needsTransferSlip: true,
    }))!

    const requestId = await createRequest(db, person.id!, 'monthly')
    const searchingA = await addItem(db, requestId, presentationId, 2)
    const searchingB = await addItem(db, requestId, presentationId, 1)
    const transferred = await addItem(db, requestId, presentationId, 3)
    await setItemStatus(db, transferred, 'transferred', { locationId: civilianPharmacy })

    const lines = await shoppingList(db)
    const hospitalLine = lines.find((l) => l.groupLabel === 'Hospital pharmacies')
    const transferLine = lines.find((l) => l.groupLabel === 'El-Ezaby')

    expect(hospitalLine?.qty).toBe(3) // 2 + 1, summed
    expect(hospitalLine?.itemIds.sort()).toEqual([searchingA, searchingB].sort())
    expect(transferLine?.qty).toBe(3)
    expect(transferLine?.locationId).toBe(civilianPharmacy)

    await markLineFound(db, hospitalLine!.itemIds, civilianPharmacy)
    const updated = await db.items.bulkGet([searchingA, searchingB])
    expect(updated.every((i) => i!.status === 'found' && i!.foundAtLocationId === civilianPharmacy)).toBe(
      true,
    )
  })
})

describe('diffSeedImport / applySeedImport', () => {
  const csv = [
    'brand_en,brand_ar,ingredients,strength,form,pack_size,manufacturer,categories,drug_class,use_en,fridge,controlled,confidence,source',
    'Tareg,تارج,valsartan,80 mg,film-coated tablet,28 tablets,Novartis,cardiac,ARB,blood pressure,no,no,high,',
    'Tareg,تارج,valsartan,160 mg,film-coated tablet,28 tablets,Novartis,cardiac,ARB,blood pressure,no,no,high,',
  ].join('\n')

  it('classifies rows as new-product, new-presentation or existing, then applies only the new ones', async () => {
    const productId = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      ['valsartan'],
    )
    await addPresentation(db, {
      productId,
      strength: '80 mg',
      form: 'film-coated tablet',
      fridge: false,
      controlled: false,
    })

    const rows = parseSeedCsv(csv)
    const diff = await diffSeedImport(db, rows)
    expect(diff.existing).toBe(1)
    expect(diff.newPresentations).toBe(1)
    expect(diff.newProducts).toBe(0)

    const result = await applySeedImport(db, rows)
    expect(result.productsAdded).toBe(0)
    expect(result.presentationsAdded).toBe(1)

    const presentations = await db.presentations.where('productId').equals(productId).toArray()
    expect(presentations).toHaveLength(2)
  })

  it('adds a brand-new product and its presentation', async () => {
    const rows = parseSeedCsv(csv)
    const result = await applySeedImport(db, rows)
    expect(result.productsAdded).toBe(1)
    expect(result.presentationsAdded).toBe(2)
    expect(await db.products.count()).toBe(1)
  })
})
