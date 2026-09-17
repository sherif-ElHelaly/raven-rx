// Case-level view of the tracker. A "case" is one Request with all of its meds
// (Items): money, progress and finished-ness are decided per case, never per med.

import { CLOSED_STATUSES, knownLocationsByProduct, OPEN_STATUSES, setItemStatus } from './repo'
import type { SarfDB } from './schema'
import type { Item, ItemStatus, Person, Request } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

// Cases created before the per-case refund existed tracked refunds per item.
// Treat such a case as collected only if it was fully settled the old way.
export function caseFeeRefunded(request: Request, items: Item[]): boolean {
  if (request.feeRefunded !== undefined) return request.feeRefunded
  const delivered = items.filter((i) => i.status === 'delivered')
  return (
    delivered.length > 0 &&
    items.every((i) => CLOSED_STATUSES.includes(i.status)) &&
    delivered.every((i) => i.feeRefunded)
  )
}

// The fee is paid upfront for every med registered, so the whole case is owed
// from the moment it exists until it is collected back.
export function caseTotalFee(request: Request, items: Item[]): number {
  return request.feePerItem * items.length
}

export function isCaseFinished(request: Request, items: Item[]): boolean {
  return (
    items.length > 0 &&
    items.every((i) => CLOSED_STATUSES.includes(i.status)) &&
    caseFeeRefunded(request, items)
  )
}

export type StatusCounts = Record<ItemStatus, number>

export function statusCounts(items: Item[]): StatusCounts {
  const counts: StatusCounts = {
    searching: 0,
    found: 0,
    transferred: 0,
    delivered: 0,
    unavailable: 0,
    cancelled: 0,
  }
  for (const i of items) counts[i.status]++
  return counts
}

function lastActivityAt(request: Request, items: Item[]): number {
  let at = Math.max(request.createdAt, request.feeRefundedAt ?? 0, request.closedAt ?? 0)
  for (const i of items) {
    const last = i.statusHistory[i.statusHistory.length - 1]
    if (last && last.at > at) at = last.at
  }
  return at
}

export interface CaseSummary {
  request: Request
  person: Person | undefined
  items: Item[]
  counts: StatusCounts
  openCount: number
  totalFee: number
  owed: number
  feeRefunded: boolean
  finished: boolean
  lastActivityAt: number
}

export function summarizeCase(
  request: Request,
  person: Person | undefined,
  items: Item[],
): CaseSummary {
  const counts = statusCounts(items)
  const feeRefunded = caseFeeRefunded(request, items)
  const totalFee = caseTotalFee(request, items)
  return {
    request,
    person,
    items,
    counts,
    openCount: counts.searching + counts.found + counts.transferred,
    totalFee,
    owed: feeRefunded ? 0 : totalFee,
    feeRefunded,
    finished: isCaseFinished(request, items),
    lastActivityAt: lastActivityAt(request, items),
  }
}

// Every case, newest first.
export async function loadCases(db: SarfDB): Promise<CaseSummary[]> {
  const [requests, people, items] = await Promise.all([
    db.requests.toArray(),
    db.people.toArray(),
    db.items.toArray(),
  ])
  const personById = new Map(people.map((p) => [p.id!, p]))
  const itemsByRequest = new Map<number, Item[]>()
  for (const item of items) {
    const list = itemsByRequest.get(item.requestId) ?? []
    list.push(item)
    itemsByRequest.set(item.requestId, list)
  }
  return requests
    .map((r) => summarizeCase(r, personById.get(r.personId), itemsByRequest.get(r.id!) ?? []))
    .sort((a, b) => b.request.createdAt - a.request.createdAt)
}

export function isStaleCase(c: CaseSummary, olderThanDays = 3, now = Date.now()): boolean {
  return !c.finished && c.openCount > 0 && c.request.createdAt <= now - olderThanDays * DAY_MS
}

export interface HomeTotals {
  owedTotal: number
  owedCases: number
  activeCases: number
  openMeds: Pick<StatusCounts, 'searching' | 'found' | 'transferred'>
  staleCases: number
}

export function homeTotals(cases: CaseSummary[], now = Date.now()): HomeTotals {
  const totals: HomeTotals = {
    owedTotal: 0,
    owedCases: 0,
    activeCases: 0,
    openMeds: { searching: 0, found: 0, transferred: 0 },
    staleCases: 0,
  }
  for (const c of cases) {
    if (c.owed > 0) {
      totals.owedTotal += c.owed
      totals.owedCases++
    }
    if (!c.finished) totals.activeCases++
    totals.openMeds.searching += c.counts.searching
    totals.openMeds.found += c.counts.found
    totals.openMeds.transferred += c.counts.transferred
    if (isStaleCase(c, 3, now)) totals.staleCases++
  }
  return totals
}

export async function moneyOwed(db: SarfDB): Promise<number> {
  return homeTotals(await loadCases(db)).owedTotal
}

export async function setCaseFeeRefunded(
  db: SarfDB,
  requestId: number,
  refunded: boolean,
): Promise<void> {
  await db.requests.update(requestId, {
    feeRefunded: refunded,
    feeRefundedAt: refunded ? Date.now() : undefined,
  })
}

// "Close case": give up on whatever is still open, optionally recording that
// the fee was collected, so the case moves to Finished.
export async function closeCase(
  db: SarfDB,
  requestId: number,
  opts: { feeCollected: boolean },
): Promise<void> {
  const items = await db.items.where('requestId').equals(requestId).toArray()
  for (const item of items) {
    if (OPEN_STATUSES.includes(item.status)) await setItemStatus(db, item.id!, 'unavailable')
  }
  const now = Date.now()
  const patch: Partial<Request> = { closedAt: now }
  if (opts.feeCollected) {
    patch.feeRefunded = true
    patch.feeRefundedAt = now
  }
  await db.requests.update(requestId, patch)
}

// Handover: deliver the chosen meds and (optionally) collect the case fee.
export async function handOverCase(
  db: SarfDB,
  requestId: number,
  itemIds: number[],
  opts: { collectFee: boolean },
): Promise<void> {
  for (const itemId of itemIds) {
    const item = await db.items.get(itemId)
    if (item && item.requestId === requestId && item.status !== 'delivered') {
      await setItemStatus(db, itemId, 'delivered', { locationId: item.foundAtLocationId })
    }
  }
  if (opts.collectFee) await setCaseFeeRefunded(db, requestId, true)
}

// Remembered pharmacies — see knownLocationsByProduct() in repo.ts.
export async function knownLocationFor(
  db: SarfDB,
  presentationId: number,
  status: 'found' | 'transferred',
): Promise<number | undefined> {
  const pres = await db.presentations.get(presentationId)
  if (!pres) return undefined
  const known = (await knownLocationsByProduct(db)).get(pres.productId)
  return status === 'found' ? known?.foundAt : known?.transferTo
}

// Marks every Searching/Transferred med in the case Found at its remembered
// pharmacy (a transferred med counts as found where it was transferred to).
// Returns the meds with no known location so the caller can ask once for all.
export async function markAllFound(db: SarfDB, requestId: number): Promise<number[]> {
  const items = await db.items.where('requestId').equals(requestId).toArray()
  const known = await knownLocationsByProduct(db)
  const presentations = await db.presentations.bulkGet(items.map((i) => i.presentationId))
  const productByPresentation = new Map<number, number>()
  for (const p of presentations) if (p) productByPresentation.set(p.id!, p.productId)

  const unknown: number[] = []
  for (const item of items) {
    if (item.status !== 'searching' && item.status !== 'transferred') continue
    const productId = productByPresentation.get(item.presentationId)
    const locationId =
      item.status === 'transferred' && item.transferToLocationId != null
        ? item.transferToLocationId
        : productId !== undefined
          ? known.get(productId)?.foundAt
          : undefined
    if (locationId == null) unknown.push(item.id!)
    else await setItemStatus(db, item.id!, 'found', { locationId })
  }
  return unknown
}

export interface DeletedCase {
  request: Request
  items: Item[]
}

// Permanently removes a case and all of its meds. The person (card, name,
// rank) is kept for next time. Returns what was deleted so it can be undone.
export async function deleteCase(db: SarfDB, requestId: number): Promise<DeletedCase | null> {
  return db.transaction('rw', db.requests, db.items, async () => {
    const request = await db.requests.get(requestId)
    if (!request) return null
    const items = await db.items.where('requestId').equals(requestId).toArray()
    await db.items.bulkDelete(items.map((i) => i.id!))
    await db.requests.delete(requestId)
    return { request, items }
  })
}

export async function restoreCase(db: SarfDB, deleted: DeletedCase): Promise<void> {
  await db.transaction('rw', db.requests, db.items, async () => {
    await db.requests.put(deleted.request)
    await db.items.bulkPut(deleted.items)
  })
}
