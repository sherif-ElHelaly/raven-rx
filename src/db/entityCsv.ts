// Plain per-table CSV export — VISION.md §5.7: "one file each for products,
// presentations, ingredients, persons, requests and items. Readable
// anywhere, no photos." (Distinct from the flat seed/import format in
// seed/SEED_FORMAT.md, which is a Phase 3 CSV-import concern.)

import { toCsv } from './csv'
import type { SarfDB } from './schema'

const arr = (v: unknown) => (Array.isArray(v) ? v.join(';') : '')

export interface EntityCsvExport {
  'products.csv': string
  'presentations.csv': string
  'ingredients.csv': string
  'persons.csv': string
  'requests.csv': string
  'items.csv': string
}

export async function exportEntityCsvs(db: SarfDB): Promise<EntityCsvExport> {
  const [people, requests, items, products, presentations, ingredients] = await Promise.all([
    db.people.toArray(),
    db.requests.toArray(),
    db.items.toArray(),
    db.products.toArray(),
    db.presentations.toArray(),
    db.ingredients.toArray(),
  ])

  return {
    'products.csv': toCsv(
      products.map((p) => ({
        id: p.id,
        nameEn: p.nameEn,
        nameAr: p.nameAr,
        aliases: arr(p.aliases),
        manufacturer: p.manufacturer,
        categories: arr(p.categories),
        verified: p.verified,
        notes: p.notes,
      })),
      ['id', 'nameEn', 'nameAr', 'aliases', 'manufacturer', 'categories', 'verified', 'notes'],
    ),
    'presentations.csv': toCsv(
      presentations.map((p) => ({
        id: p.id,
        productId: p.productId,
        strength: p.strength,
        form: p.form,
        packSize: p.packSize,
        fridge: p.fridge,
        controlled: p.controlled,
      })),
      ['id', 'productId', 'strength', 'form', 'packSize', 'fridge', 'controlled'],
    ),
    'ingredients.csv': toCsv(
      ingredients.map((i) => ({ id: i.id, nameEn: i.nameEn, nameAr: i.nameAr, drugClass: i.drugClass })),
      ['id', 'nameEn', 'nameAr', 'drugClass'],
    ),
    'persons.csv': toCsv(
      people.map((p) => ({
        id: p.id,
        cardNumber: p.cardNumber,
        name: p.name,
        rank: p.rank,
        unit: p.unit,
        phone: p.phone,
        notes: p.notes,
      })),
      ['id', 'cardNumber', 'name', 'rank', 'unit', 'phone', 'notes'],
    ),
    'requests.csv': toCsv(
      requests.map((r) => ({
        id: r.id,
        personId: r.personId,
        createdAt: new Date(r.createdAt).toISOString(),
        plan: r.plan,
        feePerItem: r.feePerItem,
        registered: r.registered,
        approved: r.approved,
        paid: r.paid,
        nextDueDate: new Date(r.nextDueDate).toISOString(),
        notes: r.notes,
      })),
      [
        'id',
        'personId',
        'createdAt',
        'plan',
        'feePerItem',
        'registered',
        'approved',
        'paid',
        'nextDueDate',
        'notes',
      ],
    ),
    'items.csv': toCsv(
      items.map((i) => ({
        id: i.id,
        requestId: i.requestId,
        presentationId: i.presentationId,
        qty: i.qty,
        substitutedWithId: i.substitutedWithId,
        status: i.status,
        foundAtLocationId: i.foundAtLocationId,
        transferToLocationId: i.transferToLocationId,
        transferSlipRef: i.transferSlipRef,
        deliveredAt: i.deliveredAt ? new Date(i.deliveredAt).toISOString() : '',
        feeRefunded: i.feeRefunded,
        feeRefundedAt: i.feeRefundedAt ? new Date(i.feeRefundedAt).toISOString() : '',
      })),
      [
        'id',
        'requestId',
        'presentationId',
        'qty',
        'substitutedWithId',
        'status',
        'foundAtLocationId',
        'transferToLocationId',
        'transferSlipRef',
        'deliveredAt',
        'feeRefunded',
        'feeRefundedAt',
      ],
    ),
  }
}
