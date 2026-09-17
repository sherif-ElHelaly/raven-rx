import { beforeEach, describe, expect, it } from 'vitest'
import { addPresentation, createProduct, createRequest, findOrCreatePerson } from './repo'
import { exportEntityCsvs } from './entityCsv'
import { SarfDB } from './schema'

let db: SarfDB
let dbCounter = 0

beforeEach(() => {
  db = new SarfDB(`sarf-entitycsv-test-${dbCounter++}`)
})

describe('exportEntityCsvs', () => {
  it('produces one CSV per table with a header row', async () => {
    const csvs = await exportEntityCsvs(db)
    expect(csvs['products.csv']).toBe(
      'id,nameEn,nameAr,aliases,manufacturer,categories,verified,notes\r\n',
    )
  })

  it('semicolon-joins array fields and escapes commas', async () => {
    await createProduct(
      db,
      {
        nameEn: 'Co-Tareg, 80/12.5',
        nameAr: 'كو-تارج',
        categories: ['cardiac', 'anticoagulant'],
        verified: true,
      },
      ['valsartan'],
    )
    const csvs = await exportEntityCsvs(db)
    const lines = csvs['products.csv'].trim().split('\r\n')
    expect(lines[1]).toContain('"Co-Tareg, 80/12.5"')
    expect(lines[1]).toContain('cardiac;anticoagulant')
  })

  it('includes persons/requests/items rows', async () => {
    const person = await findOrCreatePerson(db, '777', { name: 'Someone' })
    const productId = await createProduct(
      db,
      { nameEn: 'Tareg', nameAr: 'تارج', categories: ['cardiac'], verified: true },
      ['valsartan'],
    )
    await addPresentation(db, {
      productId,
      strength: '80 mg',
      form: 'tablet',
      fridge: false,
      controlled: false,
    })
    await createRequest(db, person.id!, 'monthly')

    const csvs = await exportEntityCsvs(db)
    expect(csvs['persons.csv']).toContain('777')
    expect(csvs['requests.csv'].split('\r\n')).toHaveLength(3) // header + 1 row + trailing empty
  })
})
