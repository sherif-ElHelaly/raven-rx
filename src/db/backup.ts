// Full JSON backup/restore — VISION.md §5.7. Restore replaces everything.

import type { SarfDB } from './schema'
import type {
  Ingredient,
  Item,
  Location,
  Person,
  Presentation,
  Product,
  ProductIngredient,
  Request,
} from './types'

const BACKUP_VERSION = 1

type SerializedPhoto = { dataBase64: string; mimeType: string }
type WithSerializedPhoto<T> = Omit<T, 'photo'> & { photo?: SerializedPhoto }

export interface BackupData {
  version: number
  exportedAt: number
  people: Person[]
  requests: Request[]
  items: Item[]
  products: WithSerializedPhoto<Product>[]
  presentations: WithSerializedPhoto<Presentation>[]
  ingredients: Ingredient[]
  productIngredients: ProductIngredient[]
  locations: Location[]
}

// btoa/atob (not Buffer, which doesn't exist in the browser bundle) so this
// runs identically in the app and in Node-based tests.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function blobToSerialized(blob: Blob): Promise<SerializedPhoto> {
  const buf = await blob.arrayBuffer()
  return {
    dataBase64: bytesToBase64(new Uint8Array(buf)),
    mimeType: blob.type || 'image/jpeg',
  }
}

function serializedToBlob(s: SerializedPhoto): Blob {
  return new Blob([base64ToBytes(s.dataBase64) as BlobPart], { type: s.mimeType })
}

async function serializePhoto<T extends { photo?: Blob }>(
  entity: T,
): Promise<WithSerializedPhoto<T>> {
  const { photo, ...rest } = entity
  return { ...rest, photo: photo ? await blobToSerialized(photo) : undefined } as WithSerializedPhoto<T>
}

function deserializePhoto<T extends { photo?: SerializedPhoto }>(
  entity: T,
): T extends { photo?: SerializedPhoto } ? Omit<T, 'photo'> & { photo?: Blob } : never {
  const { photo, ...rest } = entity
  return { ...rest, photo: photo ? serializedToBlob(photo) : undefined } as never
}

export async function exportBackup(db: SarfDB): Promise<BackupData> {
  const [people, requests, items, products, presentations, ingredients, productIngredients, locations] =
    await Promise.all([
      db.people.toArray(),
      db.requests.toArray(),
      db.items.toArray(),
      db.products.toArray(),
      db.presentations.toArray(),
      db.ingredients.toArray(),
      db.productIngredients.toArray(),
      db.locations.toArray(),
    ])

  return {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    people,
    requests,
    items,
    products: await Promise.all(products.map(serializePhoto)),
    presentations: await Promise.all(presentations.map(serializePhoto)),
    ingredients,
    productIngredients,
    locations,
  }
}

export async function importBackup(db: SarfDB, data: BackupData): Promise<void> {
  if (data.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${data.version}`)
  }

  await db.transaction(
    'rw',
    [
      db.people,
      db.requests,
      db.items,
      db.products,
      db.presentations,
      db.ingredients,
      db.productIngredients,
      db.locations,
    ],
    async () => {
      await Promise.all([
        db.people.clear(),
        db.requests.clear(),
        db.items.clear(),
        db.products.clear(),
        db.presentations.clear(),
        db.ingredients.clear(),
        db.productIngredients.clear(),
        db.locations.clear(),
      ])

      await Promise.all([
        db.people.bulkPut(data.people),
        db.requests.bulkPut(data.requests),
        db.items.bulkPut(data.items),
        db.products.bulkPut(data.products.map(deserializePhoto)),
        db.presentations.bulkPut(data.presentations.map(deserializePhoto)),
        db.ingredients.bulkPut(data.ingredients),
        db.productIngredients.bulkPut(data.productIngredients),
        db.locations.bulkPut(data.locations),
      ])
    },
  )
}
