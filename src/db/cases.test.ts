import { beforeEach, describe, expect, it } from 'vitest'
import {
  closeCase,
  deleteCase,
  handOverCase,
  homeTotals,
  isStaleCase,
  knownLocationFor,
  loadCases,
  markAllFound,
  moneyOwed,
  restoreCase,
  setCaseFeeRefunded,
} from './cases'
import {
  addItem,
  addPresentation,
  createProduct,
  createRequest,
  findOrCreatePerson,
  setItemStatus,
  shoppingList,
} from './repo'
import { SarfDB } from './schema'
import type { Plan } from './types'

let db: SarfDB
let dbCounter = 0

beforeEach(() => {
  db = new SarfDB(`sarf-cases-test-${dbCounter++}`)
})

async function drug(name: string): Promise<number> {
  const productId = await createProduct(
    db,
    { nameEn: name, nameAr: name, categories: ['cardiac'], verified: true },
    [name.toLowerCase()],
  )
  return addPresentation(db, { productId, strength: '10 mg', form: 'tablet', fridge: false, controlled: false })
}

async function location(name: string): Promise<number> {
  return (await db.locations.add({ name, type: 'hospital_pharmacy', needsTransferSlip: false }))!
}

async function newCase(card: string, plan: Plan, meds: number, createdAt = Date.now()) {
  const person = await findOrCreatePerson(db, card)
  const requestId = await createRequest(db, person.id!, plan, undefined, createdAt)
  const itemIds: number[] = []
  for (let n = 0; n < meds; n++) itemIds.push(await addItem(db, requestId, await drug(`Drug${card}-${n}`), 1))
  return { requestId, itemIds }
}

async function caseById(requestId: number) {
  return (await loadCases(db)).find((c) => c.request.id === requestId)!
}

describe('money owed per case', () => {
  it('owes fee × every med from creation: 6 meds on bimonthly = 60 EGP, one row', async () => {
    const { requestId } = await newCase('111', 'bimonthly', 6)
    const c = await caseById(requestId)
    expect(c.owed).toBe(60)
    expect(c.totalFee).toBe(60)
    expect(await moneyOwed(db)).toBe(60)
  })

  it('still owes the full fee when some meds turn out unavailable', async () => {
    const { requestId, itemIds } = await newCase('222', 'monthly', 6)
    await setItemStatus(db, itemIds[0]!, 'unavailable')
    await setItemStatus(db, itemIds[1]!, 'cancelled')
    expect((await caseById(requestId)).owed).toBe(30)
  })

  it('clears the whole amount with one refund, and sums across cases', async () => {
    const a = await newCase('333', 'bimonthly', 6)
    const b = await newCase('444', 'monthly', 2)
    expect(await moneyOwed(db)).toBe(70)
    await setCaseFeeRefunded(db, a.requestId, true)
    const totals = homeTotals(await loadCases(db))
    expect(totals.owedTotal).toBe(10)
    expect(totals.owedCases).toBe(1)
    expect((await caseById(b.requestId)).owed).toBe(10)
  })
})

describe('finished cases', () => {
  it('finishes only when every med is closed AND the fee is collected', async () => {
    const { requestId, itemIds } = await newCase('555', 'monthly', 2)
    await setItemStatus(db, itemIds[0]!, 'delivered')
    await setItemStatus(db, itemIds[1]!, 'unavailable')
    expect((await caseById(requestId)).finished).toBe(false) // fee not collected

    await setCaseFeeRefunded(db, requestId, true)
    expect((await caseById(requestId)).finished).toBe(true)
  })

  it('a partial handover with the fee collected keeps the case active until the rest closes', async () => {
    const { requestId, itemIds } = await newCase('666', 'monthly', 3)
    await setItemStatus(db, itemIds[0]!, 'found')
    await handOverCase(db, requestId, [itemIds[0]!], { collectFee: true })
    let c = await caseById(requestId)
    expect(c.counts.delivered).toBe(1)
    expect(c.owed).toBe(0)
    expect(c.finished).toBe(false)

    await handOverCase(db, requestId, [itemIds[1]!, itemIds[2]!], { collectFee: false })
    c = await caseById(requestId)
    expect(c.finished).toBe(true)
  })

  it('close case marks leftovers unavailable and can record the fee', async () => {
    const { requestId, itemIds } = await newCase('777', 'bimonthly', 3)
    await setItemStatus(db, itemIds[0]!, 'delivered')
    await closeCase(db, requestId, { feeCollected: true })
    const c = await caseById(requestId)
    expect(c.counts).toMatchObject({ delivered: 1, unavailable: 2, searching: 0 })
    expect(c.finished).toBe(true)
    expect(c.request.closedAt).toBeTypeOf('number')
  })

  it('close case without collecting keeps it owed and active', async () => {
    const { requestId } = await newCase('888', 'monthly', 2)
    await closeCase(db, requestId, { feeCollected: false })
    const c = await caseById(requestId)
    expect(c.openCount).toBe(0)
    expect(c.owed).toBe(10)
    expect(c.finished).toBe(false)
  })

  it('an empty case is never finished', async () => {
    const { requestId } = await newCase('999', 'monthly', 0)
    expect((await caseById(requestId)).finished).toBe(false)
  })
})

describe('legacy cases (per-med refunds, no case fee field)', () => {
  it('counts as collected when fully settled the old way', async () => {
    const { requestId, itemIds } = await newCase('1010', 'monthly', 2)
    await db.requests.update(requestId, { feeRefunded: undefined })
    await setItemStatus(db, itemIds[0]!, 'delivered')
    await setItemStatus(db, itemIds[1]!, 'unavailable')
    await db.items.update(itemIds[0]!, { feeRefunded: true })
    const c = await caseById(requestId)
    expect(c.owed).toBe(0)
    expect(c.finished).toBe(true)
  })

  it('owes the full case while anything is unsettled', async () => {
    const { requestId, itemIds } = await newCase('1111', 'monthly', 2)
    await db.requests.update(requestId, { feeRefunded: undefined })
    await setItemStatus(db, itemIds[0]!, 'delivered')
    await db.items.update(itemIds[0]!, { feeRefunded: true })
    expect((await caseById(requestId)).owed).toBe(10)
  })
})

describe('stale cases', () => {
  it('is stale when active with open meds and older than 3 days', async () => {
    const old = Date.now() - 4 * 24 * 60 * 60 * 1000
    const a = await newCase('1212', 'monthly', 2, old)
    const b = await newCase('1313', 'monthly', 2)
    expect(isStaleCase(await caseById(a.requestId))).toBe(true)
    expect(isStaleCase(await caseById(b.requestId))).toBe(false)
    expect(homeTotals(await loadCases(db)).staleCases).toBe(1)
  })
})

describe('remembered pharmacies', () => {
  it('remembers where a drug was last found, across cases', async () => {
    const pharmacyA = await location('Pharmacy A')
    const pharmacyB = await location('Pharmacy B')
    const person = await findOrCreatePerson(db, '1414')
    const presentationId = await drug('Concor')
    const r1 = await createRequest(db, person.id!, 'monthly')
    const i1 = await addItem(db, r1, presentationId, 1)

    expect(await knownLocationFor(db, presentationId, 'found')).toBeUndefined()
    await setItemStatus(db, i1, 'found', { locationId: pharmacyA })
    expect(await knownLocationFor(db, presentationId, 'found')).toBe(pharmacyA)

    // The latest find wins.
    const r2 = await createRequest(db, person.id!, 'monthly')
    const i2 = await addItem(db, r2, presentationId, 1)
    await setItemStatus(db, i2, 'found', { locationId: pharmacyB })
    expect(await knownLocationFor(db, presentationId, 'found')).toBe(pharmacyB)
  })

  it('mark all found uses remembered pharmacies and reports the unknown meds', async () => {
    const pharmacyA = await location('Pharmacy A')
    const storage = await location('Storage')
    const person = await findOrCreatePerson(db, '1515')
    const known = await drug('Known')
    const transferred = await drug('Transferred')
    const unknown = await drug('Unknown')

    const past = await createRequest(db, person.id!, 'monthly')
    await setItemStatus(db, await addItem(db, past, known, 1), 'found', { locationId: pharmacyA })

    const requestId = await createRequest(db, person.id!, 'monthly')
    const knownItem = await addItem(db, requestId, known, 1)
    const transferredItem = await addItem(db, requestId, transferred, 1)
    const unknownItem = await addItem(db, requestId, unknown, 1)
    await setItemStatus(db, transferredItem, 'transferred', { locationId: storage })

    expect(await markAllFound(db, requestId)).toEqual([unknownItem])
    expect((await db.items.get(knownItem))).toMatchObject({ status: 'found', foundAtLocationId: pharmacyA })
    expect((await db.items.get(transferredItem))).toMatchObject({ status: 'found', foundAtLocationId: storage })
    expect((await db.items.get(unknownItem))!.status).toBe('searching')
  })

  it('lists searching meds under the pharmacy they were last found at', async () => {
    const pharmacyA = await location('Pharmacy A')
    const person = await findOrCreatePerson(db, '1616')
    const known = await drug('Known')
    const fresh = await drug('Fresh')
    const past = await createRequest(db, person.id!, 'monthly')
    await setItemStatus(db, await addItem(db, past, known, 1), 'found', { locationId: pharmacyA })

    const requestId = await createRequest(db, person.id!, 'monthly')
    await addItem(db, requestId, known, 2)
    await addItem(db, requestId, fresh, 1)

    const lines = await shoppingList(db)
    expect(lines.find((l) => l.productName === 'Known')).toMatchObject({
      groupLabel: 'Pharmacy A',
      locationId: pharmacyA,
      qty: 2,
    })
    expect(lines.find((l) => l.productName === 'Fresh')).toMatchObject({
      groupLabel: 'Hospital pharmacies',
      locationId: undefined,
    })
  })
})

describe('deleting cases', () => {
  it('removes the case and its meds but keeps the person, and can be undone', async () => {
    const keep = await newCase('1717', 'monthly', 1)
    const { requestId, itemIds } = await newCase('1818', 'bimonthly', 3)
    await setItemStatus(db, itemIds[0]!, 'delivered')

    const deleted = await deleteCase(db, requestId)
    expect(deleted?.items).toHaveLength(3)
    expect(await db.requests.get(requestId)).toBeUndefined()
    expect(await db.items.where('requestId').equals(requestId).count()).toBe(0)
    expect(await db.people.where('cardNumber').equals('1818').count()).toBe(1)
    expect(await db.items.where('requestId').equals(keep.requestId).count()).toBe(1)
    expect(await moneyOwed(db)).toBe(5)

    await restoreCase(db, deleted!)
    const c = await caseById(requestId)
    expect(c.items).toHaveLength(3)
    expect(c.counts.delivered).toBe(1)
    expect(await moneyOwed(db)).toBe(35)
  })

  it('returns null for a case that does not exist', async () => {
    expect(await deleteCase(db, 999)).toBeNull()
  })
})
