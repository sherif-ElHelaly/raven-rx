import { beforeEach, describe, expect, it } from 'vitest'
import { exportBackup, importBackup } from './backup'
import { SarfDB } from './schema'
import { addItem, addPresentation, createProduct, createRequest, findOrCreatePerson, setItemStatus } from './repo'

let db: SarfDB
let dbCounter = 0

beforeEach(() => {
  db = new SarfDB(`sarf-backup-test-${dbCounter++}`)
})

describe('backup round-trip', () => {
  it('restores an empty database losslessly', async () => {
    const backup = await exportBackup(db)
    await importBackup(db, backup)
    expect(await db.products.count()).toBe(0)
    expect(await db.people.count()).toBe(0)
  })

  it('restores people/products/requests/items exactly, including a photo blob', async () => {
    const person = await findOrCreatePerson(db, '9988', { name: 'Test Person' })
    const productId = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      ['valsartan'],
    )
    const photoBytes = new Uint8Array([1, 2, 3, 4, 5])
    const presentationId = await addPresentation(db, {
      productId,
      strength: '80 mg',
      form: 'tablet',
      fridge: false,
      controlled: true,
      photo: new Blob([photoBytes], { type: 'image/jpeg' }),
    })
    const requestId = await createRequest(db, person.id!, 'bimonthly', 'urgent')
    const itemId = await addItem(db, requestId, presentationId, 2)
    await setItemStatus(db, itemId, 'found', { locationId: 1 })

    const backup = await exportBackup(db)

    // Restoring into a fresh, empty database (the real restore flow) should
    // reproduce every field, including ids and the photo bytes.
    const restoredDb = new SarfDB(`sarf-backup-restored-${dbCounter++}`)
    await importBackup(restoredDb, backup)

    const restoredPerson = await restoredDb.people.get(person.id!)
    expect(restoredPerson?.cardNumber).toBe('9988')
    expect(restoredPerson?.name).toBe('Test Person')

    const restoredRequest = await restoredDb.requests.get(requestId)
    expect(restoredRequest?.plan).toBe('bimonthly')
    expect(restoredRequest?.feePerItem).toBe(10)
    expect(restoredRequest?.notes).toBe('urgent')

    const restoredItem = await restoredDb.items.get(itemId)
    expect(restoredItem?.status).toBe('found')
    expect(restoredItem?.foundAtLocationId).toBe(1)
    expect(restoredItem?.statusHistory).toHaveLength(2)

    const restoredPresentation = await restoredDb.presentations.get(presentationId)
    expect(restoredPresentation?.controlled).toBe(true)
    expect(restoredPresentation?.photo).toBeInstanceOf(Blob)
    const restoredBytes = new Uint8Array(await restoredPresentation!.photo!.arrayBuffer())
    expect([...restoredBytes]).toEqual([1, 2, 3, 4, 5])

    const restoredProduct = await restoredDb.products.get(productId)
    expect(restoredProduct?.nameEn).toBe('Tareg')
  })

  it('replaces existing data rather than merging with it', async () => {
    await findOrCreatePerson(db, 'stale-card')
    const backup = await exportBackup(new SarfDB(`sarf-backup-empty-${dbCounter++}`))
    await importBackup(db, backup)
    expect(await db.people.count()).toBe(0)
  })
})
